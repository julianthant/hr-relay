import { AuthoritySourceClosureUnprovedError, retainAuthoritySourceClosure } from "../source-closure.js";
import { z } from "zod";
import { DatabaseSync } from "node:sqlite";
import { workerBootstrapEnvironment } from "../../../models/config/secrets.js";
import type { RuntimeAdmission } from "../admission/admission.js";
import { requireRuntimeAdmission } from "../admission/admission-identity.js";
import { requireDatabaseSourcePath } from "./recovery-admission.js";
import { existsSync, statSync, lstatSync, mkdtempSync, rmSync, type BigIntStats } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";


function identity(stats: BigIntStats): string {
  return [stats.dev, stats.ino, stats.mode, stats.size, stats.mtimeNs, stats.ctimeNs].join(":");
}

function inspect(path: string): BigIntStats | undefined {
  try {
    const stats = lstatSync(path, { bigint: true });
    if (!stats.isFile() || stats.isSymbolicLink()) throw new Error("authority-readonly-source-unsafe");
    return stats;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
}

// Closing a source descriptor in the SQLite process releases that process's inode locks.
const copySnapshotScript = `
const { closeSync, constants, fstatSync, lstatSync, openSync, readSync, writeSync } = require("node:fs");
const destinationPath = process.argv[1];
const sources = JSON.parse(process.argv[2]);
const identity = stats => [stats.dev, stats.ino, stats.mode, stats.size, stats.mtimeNs, stats.ctimeNs].join(":");
const inspect = path => {
  try {
    const stats = lstatSync(path, { bigint: true });
    if (!stats.isFile() || stats.isSymbolicLink()) throw new Error("authority-readonly-source-unsafe");
    return stats;
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
};
const assertUnchanged = () => {
  for (const source of sources) {
    const current = inspect(source.path);
    if ((current === undefined ? null : identity(current)) !== source.expected
      || source.descriptor !== undefined && identity(fstatSync(source.descriptor, { bigint: true })) !== source.expected) {
      throw new Error("authority-readonly-source-changed");
    }
  }
};
try {
  try {
    assertUnchanged();
    for (const source of sources) {
      if (source.expected === null) continue;
      source.descriptor = openSync(source.path, constants.O_RDONLY | constants.O_NOFOLLOW);
      source.stats = fstatSync(source.descriptor, { bigint: true });
      if (identity(source.stats) !== source.expected) throw new Error("authority-readonly-source-changed");
    }
    assertUnchanged();
    const chunk = Buffer.alloc(64 * 1024);
    for (const source of sources) {
      if (source.descriptor === undefined || source.suffix === "-shm" || source.suffix === "-journal") continue;
      const destination = openSync(destinationPath + source.suffix, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
      try {
        let total = 0n;
        for (;;) {
          const length = readSync(source.descriptor, chunk, 0, chunk.length, null);
          if (length === 0) break;
          total += BigInt(length);
          if (total > source.stats.size) throw new Error("authority-readonly-source-changed");
          let offset = 0;
          while (offset < length) {
            const written = writeSync(destination, chunk, offset, length - offset);
            if (written === 0) throw new Error("authority-readonly-snapshot-write-stalled");
            offset += written;
          }
        }
        if (total !== source.stats.size) throw new Error("authority-readonly-source-changed");
      } finally { closeSync(destination); }
    }
    assertUnchanged();
  } finally {
    for (const source of sources) if (source.descriptor !== undefined) closeSync(source.descriptor);
  }
  process.stdout.write("copied");
} catch (error) {
  process.stdout.write(JSON.stringify({ message: error.message, ...(typeof error.code === "string" ? { code: error.code } : {}) }));
  process.exitCode = 1;
}
`;

export function createReadonlyAuthoritySnapshot(sourcePath: string) {
  const directory = mkdtempSync(join(tmpdir(), "relay-readonly-authority-"));
  const path = join(directory, "authority.sqlite");
  const sources: Array<{ path: string; suffix: string; stats: BigIntStats | undefined }> = [];
  let disposed = false;
  let disposalFailure: AuthoritySourceClosureUnprovedError | undefined;
  const dispose = () => {
    if (disposalFailure !== undefined) throw disposalFailure;
    if (disposed) return;
    try { rmSync(directory, { recursive: true }); }
    catch (error) { disposalFailure = retainAuthoritySourceClosure([error], { snapshot }); throw disposalFailure; }
    disposed = true;
  };
  const assertUnchanged = () => {
    if (disposalFailure !== undefined) throw disposalFailure;
    if (disposed) throw new Error("authority-readonly-snapshot-closed");
    for (const source of sources) {
      const current = inspect(source.path);
      if ((current === undefined) !== (source.stats === undefined)
        || current !== undefined && source.stats !== undefined && identity(current) !== identity(source.stats)) {
        throw new Error("authority-readonly-source-changed");
      }
    }
  };
  const snapshot = Object.freeze({ path, assertUnchanged, dispose });
  try {
    for (const suffix of ["", "-wal", "-shm", "-journal"]) {
      const source: typeof sources[number] = { path: `${sourcePath}${suffix}`, suffix,
        stats: inspect(`${sourcePath}${suffix}`) };
      sources.push(source);
      if (source.stats === undefined) {
        if (suffix === "") throw new Error("authority-readonly-source-missing");
        continue;
      }
      if (suffix === "-journal" && source.stats.size > 0n) throw new Error("authority-readonly-source-journal-unsettled");
    }
    const copy = spawnSync(process.execPath, ["--input-type=commonjs", "-e", copySnapshotScript, path,
      JSON.stringify(sources.map(source => ({ path: source.path, suffix: source.suffix,
        expected: source.stats === undefined ? null : identity(source.stats) })))], { encoding: "utf8", maxBuffer: 64 * 1024, env: workerBootstrapEnvironment() });
    const copyFailed = () => new Error("authority-readonly-snapshot-copy-failed", {
      cause: copy.error ?? { status: copy.status, signal: copy.signal },
    });
    if (copy.error !== undefined || copy.signal !== null) throw copyFailed();
    if (copy.status !== 0) {
      let failure: { message: string; code?: string };
      try {
        failure = z.object({ message: z.string(), code: z.string().optional() }).strict().parse(JSON.parse(copy.stdout));
      } catch { throw copyFailed(); }
      throw Object.assign(new Error(failure.message), failure.code === undefined ? {} : { code: failure.code });
    }
    if (copy.stdout !== "copied") throw copyFailed();
    assertUnchanged();
    return snapshot;
  } catch (error) {
    try { dispose(); }
    catch (cleanup) { throw retainAuthoritySourceClosure([error, cleanup], { snapshot }); }
    throw error;
  }
}

export function openReadOnlyDatabase(path: string, busyTimeoutMs: number): DatabaseSync {
  return new DatabaseSync(path, {
    readOnly: true,
    enableForeignKeyConstraints: true,
    enableDoubleQuotedStringLiterals: false,
    allowExtension: false,
    timeout: z.number().int().positive().parse(busyTimeoutMs),
    readBigInts: false,
    returnArrays: false,
    allowBareNamedParameters: false,
    allowUnknownNamedParameters: false,
    defensive: true,
  });
}


export function withAuthorityDatabaseReadOnly<Result>(admission:RuntimeAdmission,pathInput:string,read:(database:DatabaseSync)=>Result,busyTimeoutMs=250):Result {
 const path=resolve(pathInput);
 requireRuntimeAdmission(admission).assertReadOnlyAuthorityDatabase(path);
 requireDatabaseSourcePath(path);
 if(!existsSync(path)||statSync(path).size===0)throw new Error("authority-backup-source-missing");
 const snapshot=createReadonlyAuthoritySnapshot(path);
 let database: DatabaseSync | undefined;
 let result: { value: Result } | undefined;
 const failures: unknown[] = [];
 let transactionOpen = false;
 try {
   database = openReadOnlyDatabase(snapshot.path, busyTimeoutMs);
   database.exec("PRAGMA query_only=ON; BEGIN"); transactionOpen = true;
   result = { value: read(database) };
   database.exec("COMMIT"); transactionOpen = false;
 } catch (error) { failures.push(error); }
 if (database !== undefined) {
   if (transactionOpen) {
     try { database.exec("ROLLBACK"); } catch (error) { failures.push(error); }
   }
   try { database.close(); }
   catch (error) { throw retainAuthoritySourceClosure([...failures, error], { snapshot, database }); }
 }
 try { snapshot.assertUnchanged(); } catch (error) { failures.push(error); }
 try { snapshot.dispose(); }
 catch (error) { throw retainAuthoritySourceClosure([...failures, error], { snapshot }); }
 if (failures.length === 1) throw failures[0];
 if (failures.some(error => error instanceof AuthoritySourceClosureUnprovedError)) throw retainAuthoritySourceClosure(failures, {});
 if (failures.length > 1) throw new AggregateError(failures, "authority-read-only-failed", { cause: failures[0] });
 if (result === undefined) throw new Error("authority-read-only-result-missing");
 return result.value;
}
