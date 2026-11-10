import { windowsObserverPolicyPrelude } from "../windows-observer-policy.js";
import { createPrivateDirectory, privatePathRejects } from "../private-path.js";
import { AuthoritySourceClosureUnprovedError, hasUnprovedSourceClosure, retainAuthoritySourceClosure, retainUnprovedSourceOwners } from "../source-closure.js";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { workerBootstrapEnvironment } from "../../../models/config/secrets.js";
import type { RuntimeAdmission } from "../admission/admission.js";
import { requireRuntimeAdmission } from "../admission/admission-identity.js";
import { requireDatabaseSourcePath } from "./recovery-admission.js";
import { outermostOperationProof, withOperationProof } from "../configuration/credential-safe-file.js";
import { existsSync, statSync, lstatSync, mkdtempSync, realpathSync, rmSync, writeFileSync, type BigIntStats } from "node:fs";
import { spawnSync } from "node:child_process";
import { AsyncLocalStorage } from "node:async_hooks";
import { fileStatus, sameDirectory, type DirectoryIdentity } from "../file-identity.js";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";


/** The live authority files changed while a read-only snapshot was copied or read: an observation race, not damage. */
export class AuthoritySourceChangedError extends Error {
  constructor() { super("authority-readonly-source-changed"); this.name = "AuthoritySourceChangedError"; }
}

/** True when the error, or an error in its cause chain, is an observation race. */
export function isAuthoritySourceChanged(error: unknown): boolean {
  return error instanceof AuthoritySourceChangedError || error instanceof Error && error.cause !== undefined && isAuthoritySourceChanged(error.cause);
}

function identity(stats: BigIntStats): string {
  return [stats.dev, stats.ino, stats.mode, stats.size, stats.mtimeNs, stats.ctimeNs].join(":");
}

function inspect(path: string): BigIntStats | undefined {
  try {
    const stats = lstatSync(path, { bigint: true });
    if (!stats.isFile() || stats.nlink !== 1n || privatePathRejects(path, stats, "group-write")) throw new Error("authority-readonly-source-unsafe");
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
    if (!stats.isFile() || ${process.platform === "win32" ? 'stats.nlink !== 1n || privatePathRejects(path, stats, "group-write")' : "stats.isSymbolicLink()"}) throw new Error("authority-readonly-source-unsafe");
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

/** The process that holds the active authority open; its doctor pass reads one image of that connection instead of copying the live files. */
export interface AuthorityImageOwner {
  serializeCommittedImage(): { readonly identity: DirectoryIdentity; readonly image: Uint8Array } | undefined;
}

type ReadonlySnapshot = Readonly<{ path: string; assertUnchanged: () => void; dispose: () => void }>;
type ActiveObservation = { readonly statePath: string; owner: AuthorityImageOwner | undefined; snapshot?: ReadonlySnapshot };
const activeObservation = new AsyncLocalStorage<ActiveObservation>();

/** With an owner, every read of this active authority file in body uses one owner image disposed when body ends; every other path keeps guarded, freshness-checked copies. */
export async function withActiveAuthorityObservation<T>(statePath: string, owner: AuthorityImageOwner | undefined, body: () => Promise<T>): Promise<T> {
  if (owner === undefined) return body();
  const scope: ActiveObservation = { statePath: existsSync(statePath) ? realpathSync(statePath) : resolve(statePath), owner };
  try { return await activeObservation.run(scope, body); }
  finally { scope.snapshot?.dispose(); }
}

function snapshotMarker(sourcePath: string): string {
  return ["", "-wal", "-shm", "-journal"].map(suffix => {
    const stats = inspect(`${sourcePath}${suffix}`);
    return stats === undefined ? "absent" : identity(stats);
  }).join("|");
}

export function createReadonlyAuthoritySnapshot(sourcePath: string) {
  const scope = activeObservation.getStore();
  if (scope?.owner !== undefined && existsSync(sourcePath) && realpathSync(sourcePath) === scope.statePath) {
    scope.snapshot ??= copyReadonlyAuthoritySnapshot(sourcePath, scope.owner);
    // The scope owns the image and disposes it when its pass ends.
    if (scope.snapshot !== undefined) return Object.freeze({ path: scope.snapshot.path, assertUnchanged: scope.snapshot.assertUnchanged, dispose() {} });
    // The file at the path is not the one the owner opened: judge it by today's guarded copy.
    scope.owner = undefined;
  }
  const proof = outermostOperationProof();
  const marker = snapshotMarker(sourcePath);
  const key = `readonly-snapshot:${sourcePath}`;
  const cached = proof?.slots.get(key) as { marker: string; snapshot: ReadonlySnapshot } | undefined;
  if (cached?.marker === marker) {
    cached.snapshot.assertUnchanged();
    return Object.freeze({ path: cached.snapshot.path, assertUnchanged: cached.snapshot.assertUnchanged, dispose() { if (!proof?.active) cached.snapshot.dispose(); } });
  }
  const snapshot = copyReadonlyAuthoritySnapshot(sourcePath);
  if (proof === undefined) return snapshot;
  proof.slots.set(key, { marker, snapshot });
  proof.release.push(() => { snapshot.dispose(); });
  return Object.freeze({ path: snapshot.path, assertUnchanged: () => snapshot.assertUnchanged(), dispose() { if (!proof.active) snapshot.dispose(); } });
}

function copyReadonlyAuthoritySnapshot(sourcePath: string): ReadonlySnapshot;
function copyReadonlyAuthoritySnapshot(sourcePath: string, owner: AuthorityImageOwner): ReadonlySnapshot | undefined;
function copyReadonlyAuthoritySnapshot(sourcePath: string, owner?: AuthorityImageOwner): ReadonlySnapshot | undefined {
  const directory = process.platform === "win32"
    ? join(realpathSync(tmpdir()), `relay-readonly-authority-${randomUUID()}`)
    : mkdtempSync(join(realpathSync(tmpdir()), "relay-readonly-authority-"));
  if (process.platform === "win32") createPrivateDirectory(directory, { mode: 0o700 });
  const path = join(directory, "authority.sqlite");
  const sources: Array<{ path: string; suffix: string; stats: BigIntStats | undefined }> = [];
  let disposed = false;
  let disposalFailure: AuthoritySourceClosureUnprovedError | undefined;
  let ownerImage = false;
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
    // An owner image is the observation itself; later source changes do not make it stale.
    if (ownerImage) return;
    for (const source of sources) {
      const current = inspect(source.path);
      if ((current === undefined) !== (source.stats === undefined)
        || current !== undefined && source.stats !== undefined && identity(current) !== identity(source.stats)) {
        throw new AuthoritySourceChangedError();
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
    if (owner !== undefined) {
      const fileIdentity = () => { const file = fileStatus(sourcePath); return { device: file.dev, inode: file.ino }; };
      let image: ReturnType<AuthorityImageOwner["serializeCommittedImage"]>;
      try {
        const before = fileIdentity();
        image = owner.serializeCommittedImage();
        if (image !== undefined && !(sameDirectory(before, image.identity) && sameDirectory(fileIdentity(), image.identity))) image = undefined;
        if (image !== undefined) writeFileSync(path, image.image, { flag: "wx", mode: 0o600 });
      } catch (error) { throw new Error("authority-readonly-snapshot-copy-failed", { cause: error }); }
      if (image === undefined) { dispose(); return undefined; }
      ownerImage = true;
      return snapshot;
    }
    const copy = spawnSync(process.execPath, ["--input-type=commonjs", "-e", process.platform === "win32" ? windowsObserverPolicyPrelude("snapshot") + copySnapshotScript : copySnapshotScript, path,
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
      if (failure.message === "authority-readonly-source-changed") throw new AuthoritySourceChangedError();
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
 return withOperationProof(() => {
   const path=resolve(pathInput);
   const owner = requireRuntimeAdmission(admission);
   owner.assertReadOnlyAuthorityDatabase(path);
   try { return withReadonlyAuthoritySnapshot(path, read, busyTimeoutMs); }
   catch (error) {
     if (hasUnprovedSourceClosure(error)) { owner.retainSourceClosure(error); retainUnprovedSourceOwners(error, { admission: owner }); }
     throw error;
   }
 });
}

export function withReadonlyAuthoritySnapshot<Result>(pathInput: string, read: (database: DatabaseSync) => Result, busyTimeoutMs = 250): Result {
 const path = resolve(pathInput);
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
