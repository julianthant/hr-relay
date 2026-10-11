import { z } from "zod";
import { DatabaseSync } from "node:sqlite";
import { requireRuntimeAdmission, type RuntimeAdmission } from "../admission/admission.js";
import { requireDatabaseSourcePath } from "./recovery-admission.js";
import { closeSync, constants, existsSync, statSync, fstatSync, lstatSync, mkdtempSync, openSync, readSync, rmSync, writeSync, type BigIntStats } from "node:fs";
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

export function createReadonlyAuthoritySnapshot(sourcePath: string) {
  const directory = mkdtempSync(join(tmpdir(), "relay-readonly-authority-"));
  const path = join(directory, "authority.sqlite");
  const sources: Array<{ path: string; suffix: string; stats: BigIntStats | undefined; descriptor?: number }> = [];
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    try {
      for (const source of sources) if (source.descriptor !== undefined) closeSync(source.descriptor);
    } finally { rmSync(directory, { recursive: true }); }
  };
  const assertUnchanged = () => {
    if (disposed) throw new Error("authority-readonly-snapshot-closed");
    for (const source of sources) {
      const current = inspect(source.path);
      if ((current === undefined) !== (source.stats === undefined)
        || current !== undefined && source.stats !== undefined && identity(current) !== identity(source.stats)
        || source.descriptor !== undefined && source.stats !== undefined
          && identity(fstatSync(source.descriptor, { bigint: true })) !== identity(source.stats)) {
        throw new Error("authority-readonly-source-changed");
      }
    }
  };
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
      source.descriptor = openSync(source.path, constants.O_RDONLY | constants.O_NOFOLLOW);
      if (identity(fstatSync(source.descriptor, { bigint: true })) !== identity(source.stats)) {
        throw new Error("authority-readonly-source-changed");
      }
    }
    assertUnchanged();
    const chunk = Buffer.alloc(64 * 1024);
    for (const source of sources) {
      if (source.descriptor === undefined || source.suffix === "-shm" || source.suffix === "-journal") continue;
      const destination = openSync(`${path}${source.suffix}`, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
      try {
        let total = 0n;
        for (;;) {
          const length = readSync(source.descriptor, chunk, 0, chunk.length, null);
          if (length === 0) break;
          total += BigInt(length);
          if (source.stats === undefined || total > source.stats.size) throw new Error("authority-readonly-source-changed");
          let offset = 0;
          while (offset < length) {
            const written = writeSync(destination, chunk, offset, length - offset);
            if (written === 0) throw new Error("authority-readonly-snapshot-write-stalled");
            offset += written;
          }
        }
      } finally { closeSync(destination); }
    }
    assertUnchanged();
    return Object.freeze({ path, assertUnchanged, dispose });
  } catch (error) {
    dispose();
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
 let database:DatabaseSync;
 try {database=openReadOnlyDatabase(snapshot.path,busyTimeoutMs);} catch(error){snapshot.dispose();throw error;}
 let open=false;
 try { database.exec("PRAGMA query_only=ON; BEGIN");open=true;const result=read(database);database.exec("COMMIT");open=false;return result; }
 finally {try{if(open)database.exec("ROLLBACK");}finally{try{database.close();}finally{try{snapshot.assertUnchanged();}finally{snapshot.dispose();}}} }
}
