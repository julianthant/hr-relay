import { AuthoritySourceClosureUnprovedError, retainAuthoritySourceClosure } from "../source-closure.js";

import { randomUUID, createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  readSync,
  existsSync,
  fsyncSync,
  linkSync,
  mkdirSync,
  openSync,
  opendirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import type { Clock } from "../../../rules/time/clock.js";
import { systemClock } from "../../../rules/time/clock.js";
import {
  FingerprintSchema,
  IsoInstantSchema,
  PositiveIntSchema,
  WorkerIdSchema,
  type WorkerId,
} from "../../../rules/identity/ids.js";
import type { RecoveryRuntimeLockSnapshot } from "./recovery-contracts.js";
import { RecoveryRuntimeLockSnapshotSchema } from "./recovery-contracts.js";
import { AUTHORITY_APPLICATION_ID } from "./migrations.js";



export const RuntimeProcessLockNameSchema = z.enum(["server", "workers", "live-smoke", "geocode"]);
export type RuntimeProcessLockName = z.infer<typeof RuntimeProcessLockNameSchema>;


export const RUNTIME_PROCESS_LOCK_NAMES: readonly RuntimeProcessLockName[] = RuntimeProcessLockNameSchema.options;

export const ProcessStartIdentitySchema = z.strictObject({
  platform: z.enum(["linux", "darwin", "win32"]),
  startToken: z.string().min(1),
});
export type ProcessStartIdentity = z.infer<typeof ProcessStartIdentitySchema>;

const CurrentRuntimeProcessLockFileSchema = z.strictObject({
  schemaVersion: z.literal(2),
  name: z.enum(["server", "live-smoke", "geocode"]),
  pid: PositiveIntSchema,
  processIdentity: ProcessStartIdentitySchema,
  acquisitionId: z.uuid(),
  generation: PositiveIntSchema,
  acquiredAt: IsoInstantSchema,
  releasedAt: IsoInstantSchema.nullable(),
});

export const RuntimeProcessLockFileSchema = CurrentRuntimeProcessLockFileSchema;
export type RuntimeProcessLockFile = z.infer<typeof RuntimeProcessLockFileSchema>;

const CurrentWorkerProcessLockFileSchema = z.strictObject({
  schemaVersion: z.literal(3),
  name: z.literal("workers"),
  workerId: WorkerIdSchema,
  pid: PositiveIntSchema,
  processIdentity: ProcessStartIdentitySchema,
  acquisitionId: z.uuid(),
  acquiredAt: IsoInstantSchema,
  releasedAt: IsoInstantSchema.nullable(),
});

const WorkerAdmissionFileSchema = z.strictObject({
  schemaVersion: z.literal(3), name: z.literal("workers"),
  admission: z.strictObject({ kind: z.literal("unbound-worker"), authorityPath: z.string().min(1), processLockRoot: z.string().min(1) }),
  pid: PositiveIntSchema, processIdentity: ProcessStartIdentitySchema, acquisitionId: z.uuid(),
  acquiredAt: IsoInstantSchema, releasedAt: IsoInstantSchema.nullable(),
});
export const WorkerProcessLockFileSchema = z.union([
  WorkerAdmissionFileSchema,
  CurrentWorkerProcessLockFileSchema,
]);
export type WorkerProcessLockFile = z.infer<typeof WorkerProcessLockFileSchema>;

const CurrentRestoreAdmissionFileSchema = z.strictObject({
  schemaVersion: z.literal(2),
  pid: PositiveIntSchema,
  processIdentity: ProcessStartIdentitySchema,
  admissionId: z.uuid(),
  acquiredAt: IsoInstantSchema,
});

export const RestoreAdmissionFileSchema = CurrentRestoreAdmissionFileSchema;
export type RestoreAdmissionFile = z.infer<typeof RestoreAdmissionFileSchema>;

const SingletonRuntimeProcessLockOptionsSchema = z.strictObject({
  processLockRoot: z.string().min(1),
  name: z.enum(["server", "live-smoke", "geocode"]),
  pid: PositiveIntSchema,
});

const WorkerRuntimeProcessLockOptionsSchema = z.strictObject({
  processLockRoot: z.string().min(1),
  name: z.literal("workers"),
  workerId: WorkerIdSchema,
  pid: PositiveIntSchema,
});

const WorkerAdmissionOptionsSchema = z.strictObject({
  processLockRoot: z.string().min(1), name: z.literal("workers"), pid: PositiveIntSchema,
  admission: z.strictObject({ kind: z.literal("unbound-worker"), authorityPath: z.string().min(1) }),
});
export const RuntimeProcessLockOptionsSchema = z.union([
  WorkerAdmissionOptionsSchema,
  SingletonRuntimeProcessLockOptionsSchema,
  WorkerRuntimeProcessLockOptionsSchema,
]);

export const RuntimeLockObservationOptionsSchema = z.strictObject({
  processLockRoot: z.string().min(1),
  sourceDatabaseIdentity: FingerprintSchema,
});

export interface RuntimeProcessLockHandle {
  readonly name: RuntimeProcessLockName;
  readonly generation: number;
  readonly acquisitionId?: string;
  /** Records the release. Calling it twice is a no-op, so a `finally` is safe. */
  release(): void;
}

export interface RestoreAdmissionHandle {
  readonly admissionId: string;
  release(): void;
}

export interface RuntimeProcessLockAcquisitionHooks {
  /** Test-only race seam after the first admission check and before the process record write. */
  readonly afterInitialAdmissionCheck?: () => void;
  /** Test-only interleaving seam before the immutable geocode generation claim. */
  readonly afterGeocodeGenerationRead?: () => void;
  readonly afterSingletonGenerationRead?: () => void;
  /** Test-only OS observation seam for deterministic PID-reuse cases. */
  readonly observeProcessIdentity?: ProcessIdentityObserver;
}

export interface RuntimeLockObservationHooks {
  readonly observeProcessIdentity?: ProcessIdentityObserver;
}

export interface RuntimeProcessOrphanInspection {
  readonly staleServerRecords: number;
  readonly staleWorkerRecords: number;
}

// EPERM proves that the PID exists even when this process cannot signal it.
export type PidObservation =
  | Readonly<{ state: "alive" }>
  | Readonly<{ state: "gone" }>;

export type ProcessIdentityObservation =
  | Readonly<{ state: "alive"; identity: ProcessStartIdentity }>
  | Readonly<{ state: "gone" }>;

export type ProcessIdentityObserver = (pid: number) => ProcessIdentityObservation;

function errnoOf(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const code: unknown = Reflect.get(error, "code");
  return typeof code === "string" ? code : undefined;
}

export function observePid(pid: number): PidObservation {
  const failure = signalProcess(pid);
  if (failure === undefined) return { state: "alive" };
  const code = errnoOf(failure);
  if (code === "EPERM") return { state: "alive" };
  if (code === "ESRCH") return { state: "gone" };
  throw new Error(
    `could not observe whether pid ${String(pid)} is still running (${code ?? "no errno"})`,
    { cause: failure },
  );
}

// Observe OS birth identity as well as PID occupancy to detect PID reuse.
export function observeProcessIdentity(pid: number): ProcessIdentityObservation {
  const parsedPid = PositiveIntSchema.parse(pid);
  if (parsedPid === process.pid && selfProcessIdentity !== undefined) return selfProcessIdentity;
  const observed = observeUncachedProcessIdentity(parsedPid);
  if (parsedPid === process.pid) selfProcessIdentity = observed;
  return observed;
}

// This process's birth identity cannot change while it is alive. Other pids are observed every time.
let selfProcessIdentity: ProcessIdentityObservation | undefined;

function observeUncachedProcessIdentity(parsedPid: number): ProcessIdentityObservation {
  if (observePid(parsedPid).state === "gone") return { state: "gone" };
  if (process.platform === "linux") {
    try {
      const bootId = readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
      const stat = readFileSync(`/proc/${String(parsedPid)}/stat`, "utf8");
      const closeParen = stat.lastIndexOf(")");
      if (closeParen === -1) throw new Error("process stat has no closing command delimiter");
      const fieldsAfterCommand = stat.slice(closeParen + 2).trim().split(/\s+/u);
      const startTicks = fieldsAfterCommand[19];
      if (bootId.length === 0 || startTicks === undefined || !/^\d+$/u.test(startTicks)) {
        throw new Error("process stat has no valid start-time ticks or boot identity");
      }
      return {
        state: "alive",
        identity: ProcessStartIdentitySchema.parse({
          platform: "linux",
          startToken: `${bootId}:${startTicks}`,
        }),
      };
    } catch (error) {
      if (errnoOf(error) === "ENOENT" && observePid(parsedPid).state === "gone") {
        return { state: "gone" };
      }
      throw new Error(`could not observe Linux start identity for pid ${String(parsedPid)}`, {
        cause: error,
      });
    }
  }
  if (process.platform === "darwin") {
    const result = spawnSync("/bin/ps", ["-o", "lstart=", "-p", String(parsedPid)], {
      encoding: "utf8",
      env: { LANG: "C", LC_ALL: "C", TZ: "UTC" },
    });
    const rawStart = result.stdout.trim();
    const startTimeMs = Date.parse(`${rawStart} UTC`);
    if (result.status === 0 && rawStart.length > 0 && Number.isFinite(startTimeMs)) {
      return {
        state: "alive",
        identity: ProcessStartIdentitySchema.parse({
          platform: "darwin",
          startToken: String(Math.floor(startTimeMs / 1000)),
        }),
      };
    }
    if (observePid(parsedPid).state === "gone") return { state: "gone" };
    throw new Error(
      `could not observe Darwin start identity for pid ${String(parsedPid)}: `
      + `${result.stderr.trim() || `ps exited ${String(result.status)}`}`,
      { cause: result.error },
    );
  }
  if (process.platform === "win32") {
    const script = `(Get-Process -Id ${String(parsedPid)} -ErrorAction Stop).StartTime.ToUniversalTime().Ticks`;
    const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
      encoding: "utf8",
    });
    const token = result.stdout.trim();
    if (result.status === 0 && /^\d+$/u.test(token)) {
      return {
        state: "alive",
        identity: ProcessStartIdentitySchema.parse({ platform: "win32", startToken: token }),
      };
    }
    if (observePid(parsedPid).state === "gone") return { state: "gone" };
    throw new Error(
      `could not observe Windows start identity for pid ${String(parsedPid)}: `
      + `${result.stderr.trim() || `PowerShell exited ${String(result.status)}`}`,
      { cause: result.error },
    );
  }
  throw new Error(`runtime process identity is unsupported on platform ${process.platform}`);
}

function processIdentityEquals(left: ProcessStartIdentity, right: ProcessStartIdentity): boolean {
  return left.platform === right.platform && left.startToken === right.startToken;
}

function captureProcessIdentity(pid: number, observer: ProcessIdentityObserver): ProcessStartIdentity {
  const observation = observer(pid);
  if (observation.state === "gone") {
    throw new Error(`cannot acquire a runtime process lock for non-running pid ${String(pid)}`);
  }
  return ProcessStartIdentitySchema.parse(observation.identity);
}

function recordOwnerIsAlive(
  record: RuntimeProcessLockFile | WorkerProcessLockFile | RestoreAdmissionFile,
  observer: ProcessIdentityObserver,
): boolean {
  const observation = observer(record.pid);
  if (observation.state === "gone") return false;
  return processIdentityEquals(record.processIdentity, observation.identity);
}

function signalProcess(pid: number): unknown {
  try {
    process.kill(pid, 0);
  } catch (error) {
    return error;
  }
  return undefined;
}

function lockPath(root: string, name: RuntimeProcessLockName): string {
  return join(root, `${name}.lock.json`);
}

const WORKER_PROCESS_LOCK_DIRECTORY = "workers";
const RESTORE_ADMISSION_FILE = "restore-admission.lock.json";
const RESTORE_ADMISSION_HISTORY_DIRECTORY = "restore-admission-history";

function workerProcessLockPath(root: string, acquisitionId: string): string {
  return join(root, WORKER_PROCESS_LOCK_DIRECTORY, `${acquisitionId}.lock.json`);
}

function restoreAdmissionPath(root: string): string {
  return join(root, RESTORE_ADMISSION_FILE);
}

function fsyncPath(path: string): void {
  const descriptor = openSync(path, "r");
  let primary: { error: unknown } | undefined;
  let descriptorIdentity: ReturnType<typeof fstatSync> | undefined;
  try { descriptorIdentity = fstatSync(descriptor); fsyncSync(descriptor); }
  catch (error) { primary = { error }; }
  try { closeSync(descriptor); }
  catch (error) { throw retainAuthoritySourceClosure(primary === undefined ? [error] : [primary.error, error],
    { descriptor: { descriptor, ...(descriptorIdentity === undefined ? {} : { identity: descriptorIdentity }) } }); }
  if (primary !== undefined) throw primary.error;
}

type SingletonRole = "server" | "live-smoke" | "geocode";
const GeocodeReleaseSchema = z.strictObject({ generation: PositiveIntSchema, acquisitionId: z.uuid(), releasedAt: IsoInstantSchema });
export interface GeocodeFileCustody { readonly dev: number; readonly ino: number; readonly size: number; readonly mtimeMs: number }

function claimDirectory(root: string, role: SingletonRole, create = false): string {
  if (create) mkdirSync(root, { recursive: true, mode: 0o700 });
  const parent = lstatSync(root);
  if (!parent.isDirectory() || parent.isSymbolicLink() || (parent.mode & 0o077) !== 0 || (process.getuid !== undefined && parent.uid !== process.getuid())) throw new Error(`${role}-root-unsafe`);
  const directory = join(root, `${role}-claims`);
  if (create) mkdirSync(directory, { mode: 0o700, recursive: true });
  const stat = lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 || (process.getuid !== undefined && stat.uid !== process.getuid())) throw new Error(`${role}-directory-unsafe`);
  return directory;
}
function claimFilePath(root: string, role: SingletonRole, name: string): string {
  if (!/^[a-zA-Z0-9.-]+$/u.test(name) || name.startsWith(".")) throw new Error(`${role}-file-name-invalid`);
  return join(claimDirectory(root, role), name);
}
function privateClaimFile(fd: number, role: SingletonRole): GeocodeFileCustody {
  const stat = fstatSync(fd);
  if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o077) !== 0 || (stat.mode & 0o600) !== 0o600 || (process.getuid !== undefined && stat.uid !== process.getuid()) || stat.size > 65_536) throw new Error(`${role}-file-unsafe`);
  return { dev: stat.dev, ino: stat.ino, size: stat.size, mtimeMs: stat.mtimeMs };
}
function custodyEquals(a: GeocodeFileCustody, b: GeocodeFileCustody): boolean { return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs; }

/** Descriptor reads never follow custody links. */
function readClaimRuntimeFile(root: string, role: SingletonRole, name: string): Readonly<{ text: string; custody: GeocodeFileCustody }> {
  const fd = openSync(claimFilePath(root, role, name), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  let descriptorIdentity: object | undefined;
  const read = () => {
    const custody = privateClaimFile(fd, role); descriptorIdentity = custody;
    const bytes = Buffer.alloc(65_537); let length = 0;
    for (;;) { const count = readSync(fd, bytes, length, bytes.length - length, null); length += count; if (length > 65_536) throw new Error(`${role}-file-oversize`); if (count === 0) break; }
    if (!custodyEquals(custody, privateClaimFile(fd, role)) || length !== custody.size) throw new Error(`${role}-file-changed`);
    return { text: bytes.subarray(0, length).toString("utf8"), custody };
  };
  let result: ReturnType<typeof read> | undefined, primary: { error: unknown } | undefined;
  try { result = read(); } catch (error) { primary = { error }; }
  try { closeSync(fd); }
  catch (error) { throw retainAuthoritySourceClosure(primary === undefined ? [error] : [primary.error, error],
    { descriptor: { descriptor: fd, ...(descriptorIdentity === undefined ? {} : { identity: descriptorIdentity }) } }); }
  if (primary !== undefined) throw primary.error;
  if (result === undefined) throw new Error("runtime-claim-read-result-missing");
  return result;
}
function writeClaimRuntimeFileExclusive(root: string, role: SingletonRole, name: string, text: string): GeocodeFileCustody {
  claimDirectory(root, role, true);
  const fd = openSync(claimFilePath(root, role, name), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  let result: GeocodeFileCustody | undefined, primary: { error: unknown } | undefined;
  try { writeFileSync(fd, text, "utf8"); fsyncSync(fd); result = privateClaimFile(fd, role); }
  catch (error) { primary = { error }; }
  try { closeSync(fd); }
  catch (error) { throw retainAuthoritySourceClosure(primary === undefined ? [error] : [primary.error, error],
    { descriptor: { descriptor: fd, ...(result === undefined ? {} : { identity: result }) } }); }
  let directoryFailure: { error: unknown } | undefined;
  try { fsyncPath(claimDirectory(root, role)); }
  catch (error) { directoryFailure = { error }; }
  if (directoryFailure !== undefined) {
    if (directoryFailure.error instanceof AuthoritySourceClosureUnprovedError) throw retainAuthoritySourceClosure(primary === undefined ? [directoryFailure.error] : [primary.error, directoryFailure.error], {});
    if (primary !== undefined) throw new AggregateError([primary.error, directoryFailure.error], "runtime-claim-write-failed", { cause: primary.error });
    throw directoryFailure.error;
  }
  if (primary !== undefined) throw primary.error;
  if (result === undefined) throw new Error("runtime-claim-write-result-missing");
  return result;
}
function removeOwnedClaimRuntimeFile(root: string, role: SingletonRole, name: string, custody: GeocodeFileCustody): void {
  const current = readClaimRuntimeFile(root, role, name);
  if (!custodyEquals(current.custody, custody)) throw new Error(`${role}-file-custody-lost`);
  unlinkSync(claimFilePath(root, role, name)); fsyncPath(claimDirectory(root, role));
}
function readSingletonClaims(root: string, role: SingletonRole): readonly z.output<typeof CurrentRuntimeProcessLockFileSchema>[] {
  if (lstatSync(lockPath(root, role), { throwIfNoEntry: false }) !== undefined) throw new Error(`${role}-mutable-lock-unsupported`);
  const parent = lstatSync(root, { throwIfNoEntry: false });
  if (parent === undefined) return [];
  if (!parent.isDirectory() || parent.isSymbolicLink() || (parent.mode & 0o077) !== 0 || (process.getuid !== undefined && parent.uid !== process.getuid())) throw new Error(`${role}-root-unsafe`);
  if (lstatSync(join(root, `${role}-claims`), { throwIfNoEntry: false }) === undefined) return [];
  const directory = claimDirectory(root, role);
  {
    const names = readdirSync(directory).filter(name => !name.startsWith("."));
    const claims: z.output<typeof CurrentRuntimeProcessLockFileSchema>[] = [];
    for (const name of names) {
      if (/^\d+-[a-f0-9-]+\.tmp$/u.test(name) || role === "geocode" && /^\d+-[a-f0-9-]+\.channel\.json$/u.test(name)) continue;
      if (/^\d+-[a-f0-9-]+\.release\.json$/u.test(name)) continue;
      if (!/^\d+\.claim\.json$/u.test(name)) throw new Error(`${role}-claim-entry-invalid`);
      const claim = CurrentRuntimeProcessLockFileSchema.parse(JSON.parse(readClaimRuntimeFile(root, role, name).text));
      if (claim.name !== role || claim.releasedAt !== null || name !== `${claim.generation}.claim.json`) throw new Error(`${role}-claim-identity-invalid`);
      const releaseName = `${claim.generation}-${claim.acquisitionId}.release.json`;
      try {
        const release = GeocodeReleaseSchema.parse(JSON.parse(readClaimRuntimeFile(root, role, releaseName).text));
        if (release.generation !== claim.generation || release.acquisitionId !== claim.acquisitionId) throw new Error(`${role}-release-identity-invalid`);
        claims.push({ ...claim, releasedAt: release.releasedAt });
      } catch (error) { if (errnoOf(error) !== "ENOENT") throw error; claims.push(claim); }
    }
    for (const name of names.filter(name => name.endsWith(".release.json"))) if (!claims.some(claim => name === `${claim.generation}-${claim.acquisitionId}.release.json`)) throw new Error(`${role}-release-unbound`);
    return claims.sort((a, b) => a.generation - b.generation);
  }
}
function activeSingletonClaims(root: string, role: SingletonRole, observer: ProcessIdentityObserver) {
  const claims = readSingletonClaims(root, role);
  if (claims.filter(claim => claim.releasedAt === null && recordOwnerIsAlive(claim, observer)).length > 1) throw new Error(`${role}-owner-conflict`);
  return { claims, active: claims.filter(claim => claim.releasedAt === null && recordOwnerIsAlive(claim, observer)), generation: Math.max(1, ...claims.map(claim => claim.generation)) };
}
function acquireSingletonClaim(root: string, role: SingletonRole, pid: number, processIdentity: ProcessStartIdentity, clock: Clock, observer: ProcessIdentityObserver, hooks: RuntimeProcessLockAcquisitionHooks): RuntimeProcessLockHandle {
  const initial = activeSingletonClaims(root, role, observer);
  if (initial.active.length > 0 && role === "geocode") throw new Error("geocode-owner-active");
  if (initial.active.length > 0) throw new Error(`rebuild ${role} process lock is held by live pid ${String(initial.active[0]?.pid)}; stop it before starting another`);
  const generation = initial.generation + 1;
  if (role === "geocode") hooks.afterGeocodeGenerationRead?.();
  else hooks.afterSingletonGenerationRead?.();
  const claim = CurrentRuntimeProcessLockFileSchema.parse({ schemaVersion: 2, name: role, pid, processIdentity, acquisitionId: randomUUID(), generation, acquiredAt: clock.now().toISOString(), releasedAt: null });
  const temporary = `${generation}-${claim.acquisitionId}.tmp`;
  writeClaimRuntimeFileExclusive(root, role, temporary, `${canonicalJsonStringify(claim)}\n`);
  try { linkSync(claimFilePath(root, role, temporary), claimFilePath(root, role, `${generation}.claim.json`)); }
  finally { unlinkSync(claimFilePath(root, role, temporary)); fsyncPath(claimDirectory(root, role)); }
  let released = false;
  const handle: RuntimeProcessLockHandle = Object.freeze({ name: role, generation, acquisitionId: claim.acquisitionId, release() {
    if (released) return;
    const stored = CurrentRuntimeProcessLockFileSchema.parse(JSON.parse(readClaimRuntimeFile(root, role, `${generation}.claim.json`).text));
    if (canonicalJsonStringify(stored) !== canonicalJsonStringify(claim)) throw new Error(`${role}-claim-custody-lost`);
    writeClaimRuntimeFileExclusive(root, role, `${generation}-${claim.acquisitionId}.release.json`, `${canonicalJsonStringify({ generation, acquisitionId: claim.acquisitionId, releasedAt: clock.now().toISOString() })}\n`);
    released = true;
  } });
  try {
    const current = activeSingletonClaims(root, role, observer);
    if (current.active.some(owner => owner.acquisitionId !== claim.acquisitionId) || !current.active.some(owner => owner.acquisitionId === claim.acquisitionId)) throw new Error(`${role}-owner-conflict`);
    assertRestoreAdmissionOpen(root, observer);
  } catch (error) { handle.release(); throw error; }
  return handle;
}

export function readGeocodeRuntimeFile(root: string, name: string): Readonly<{ text: string; custody: GeocodeFileCustody }> {
  return readClaimRuntimeFile(root, "geocode", name);
}
export function writeGeocodeRuntimeFileExclusive(root: string, name: string, text: string): GeocodeFileCustody {
  return writeClaimRuntimeFileExclusive(root, "geocode", name, text);
}
export function removeOwnedGeocodeRuntimeFile(root: string, name: string, custody: GeocodeFileCustody): void {
  removeOwnedClaimRuntimeFile(root, "geocode", name, custody);
}

export function readLiveSmokeRuntimeFile(root: string, name: string): Readonly<{ text: string; custody: GeocodeFileCustody }> {
  return readClaimRuntimeFile(root, "live-smoke", name);
}
export function writeLiveSmokeRuntimeFileExclusive(root: string, name: string, text: string): GeocodeFileCustody {
  return writeClaimRuntimeFileExclusive(root, "live-smoke", name, text);
}
export function removeOwnedLiveSmokeRuntimeFile(root: string, name: string, custody: GeocodeFileCustody): void {
  removeOwnedClaimRuntimeFile(root, "live-smoke", name, custody);
}

function writeWorkerProcessLockFile(root: string, record: WorkerProcessLockFile): void {
  const directory = join(root, WORKER_PROCESS_LOCK_DIRECTORY);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  for (const path of [root, directory]) {
    const stat = lstatSync(path);
    if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(path) !== resolve(path)
      || (stat.mode & 0o077) !== 0 || process.getuid !== undefined && stat.uid !== process.getuid()) throw new Error("worker-process-custody-directory-unsafe");
  }
  const temporaryPath = join(directory, `.${record.acquisitionId}-${randomUUID()}.tmp`);
  const finalPath = workerProcessLockPath(root, record.acquisitionId);
  try {
    writeFileSync(temporaryPath, `${canonicalJsonStringify(record)}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    fsyncPath(temporaryPath);
    renameSync(temporaryPath, finalPath);
    fsyncPath(directory);
  } finally {
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
  }
}

function readRestoreAdmission(root: string): RestoreAdmissionFile | undefined {
  const path = restoreAdmissionPath(root);
  if (!existsSync(path)) return undefined;
  try {
    return RestoreAdmissionFileSchema.parse(JSON.parse(readFileSync(path, "utf8")));
  } catch (error) {
    throw new Error(`restore admission record ${path} is malformed`, { cause: error });
  }
}

function archiveRestoreAdmission(root: string, record: RestoreAdmissionFile): void {
  const history = join(root, RESTORE_ADMISSION_HISTORY_DIRECTORY);
  mkdirSync(history, { recursive: true, mode: 0o700 });
  renameSync(restoreAdmissionPath(root), join(history, `${record.admissionId}.lock.json`));
  fsyncPath(history);
  fsyncPath(root);
}

function assertRestoreAdmissionOpen(
  root: string,
  observer: ProcessIdentityObserver = observeProcessIdentity,
): void {
  const held = readRestoreAdmission(root);
  if (held === undefined) return;
  if (recordOwnerIsAlive(held, observer)) {
    throw new Error(
      `rebuild restore admission ${held.admissionId} is held by live pid ${String(held.pid)}; `
      + "runtime process start refused until restore exits",
    );
  }
  archiveRestoreAdmission(root, held);
}

function createRestoreAdmissionAtomically(root: string, record: RestoreAdmissionFile): boolean {
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const temporaryPath = join(root, `.restore-admission-${record.admissionId}.tmp`);
  let result: boolean | undefined, primary: { error: unknown } | undefined;
  try {
    writeFileSync(temporaryPath, `${canonicalJsonStringify(record)}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    fsyncPath(temporaryPath);
    const linkFailure = tryLink(temporaryPath, restoreAdmissionPath(root));
    if (linkFailure !== undefined) {
      if (errnoOf(linkFailure) === "EEXIST") result = false;
      else if (linkFailure instanceof Error) throw linkFailure;
      else throw new Error("restore admission atomic link failed with a non-Error value", {
        cause: linkFailure,
      });
    } else {
      fsyncPath(root);
      result = true;
    }
  } catch (error) { primary = { error }; }
  if (primary?.error instanceof AuthoritySourceClosureUnprovedError) throw retainAuthoritySourceClosure([primary.error],
    { restoreCreation: { temporaryPath, restorePath: restoreAdmissionPath(root), record } });
  let cleanupFailure: { error: unknown } | undefined;
  try { if (existsSync(temporaryPath)) unlinkSync(temporaryPath); }
  catch (error) { cleanupFailure = { error }; }
  if (cleanupFailure !== undefined) {
    if (primary !== undefined) throw new AggregateError([primary.error, cleanupFailure.error], "restore-admission-cleanup-failed", { cause: primary.error });
    throw cleanupFailure.error;
  }
  if (primary !== undefined) throw primary.error;
  if (result === undefined) throw new Error("restore-admission-result-missing");
  return result;
}

function tryLink(source: string, destination: string): unknown {
  try {
    linkSync(source, destination);
  } catch (error) {
    return error;
  }
  return undefined;
}

const restoreCustodyHandles = new WeakMap<RestoreAdmissionHandle, { root: string; assertHeld(): void }>();

export function assertRuntimeRestoreAdmission(handle: RestoreAdmissionHandle, processLockRoot: string): void {
  const custody = restoreCustodyHandles.get(handle);
  if (custody === undefined || custody.root !== resolve(processLockRoot)) throw new Error("restore-admission-handle-mismatch");
  custody.assertHeld();
}

/** Atomically exclude new runtime admission while offline restore owns the live authority path. */
export function acquireRuntimeRestoreAdmission(
  input: Readonly<{ processLockRoot: string; pid: number }>,
  clock: Clock = systemClock,
  hooks: RuntimeLockObservationHooks = {},
): RestoreAdmissionHandle {
  const root = resolve(input.processLockRoot);
  const pid = PositiveIntSchema.parse(input.pid);
  const observer = hooks.observeProcessIdentity ?? observeProcessIdentity;
  const processIdentity = captureProcessIdentity(pid, observer);
  for (;;) {
    assertRestoreAdmissionOpen(root, observer);
    const record = RestoreAdmissionFileSchema.parse({
      schemaVersion: 2,
      pid,
      processIdentity,
      admissionId: randomUUID(),
      acquiredAt: clock.now().toISOString(),
    });
    if (!createRestoreAdmissionAtomically(root, record)) continue;
    let released = false;
    const handle: RestoreAdmissionHandle = Object.freeze({
      admissionId: record.admissionId,
      release: (): void => {
        if (released) return;
        const current = readRestoreAdmission(root);
        if (current === undefined || current.admissionId !== record.admissionId) {
          throw new Error(`restore admission ${record.admissionId} is no longer the current owner`);
        }
        archiveRestoreAdmission(root, current);
        released = true;
      },
    });
    const lockPath = restoreAdmissionPath(root), before = lstatSync(lockPath);
    restoreCustodyHandles.set(handle, { root, assertHeld: () => {
      if (released) throw new Error("restore-admission-handle-released");
      if (realpathSync(root) !== root) throw new Error("restore-admission-root-unsafe");
      const directory = lstatSync(root), file = lstatSync(lockPath), current = readRestoreAdmission(root);
      const observed = observeProcessIdentity(process.pid);
      if (!directory.isDirectory() || directory.isSymbolicLink() || (directory.mode & 0o077) !== 0
        || !file.isFile() || file.isSymbolicLink() || file.nlink !== 1 || (file.mode & 0o777) !== 0o600
        || process.getuid !== undefined && (file.uid !== process.getuid() || directory.uid !== process.getuid())
        || file.dev !== before.dev || file.ino !== before.ino
        || canonicalJsonStringify(current) !== canonicalJsonStringify(record)
        || record.pid !== process.pid || observed.state !== "alive" || record.processIdentity.platform !== observed.identity.platform
        || record.processIdentity.startToken !== observed.identity.startToken) throw new Error("restore-admission-custody-mismatch");
    } });
    return handle;
  }
}

function readWorkerProcessLockRecord(directory: string, name: string): WorkerProcessLockFile {
  let descriptor: number | undefined;
  let result: WorkerProcessLockFile | undefined, primary: { error: unknown } | undefined;
  let descriptorIdentity: object | undefined;
  try {
    const root = resolve(directory, "..");
    if (realpathSync(directory) !== resolve(directory) || !lstatSync(directory).isDirectory()) throw new Error("worker-process-custody-directory-unsafe");
    const path = join(directory, name), before = lstatSync(path);
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size > 16_384
      || (before.mode & 0o077) !== 0 || process.getuid !== undefined && before.uid !== process.getuid()) throw new Error("worker-process-custody-file-unsafe");
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const opened = fstatSync(descriptor); descriptorIdentity = opened;
    if (!opened.isFile() || opened.nlink !== 1 || opened.dev !== before.dev || opened.ino !== before.ino) throw new Error("worker-process-custody-file-changed");
    const record = WorkerProcessLockFileSchema.parse(JSON.parse(readFileSync(descriptor, "utf8")));
    const after = lstatSync(path);
    if (after.dev !== opened.dev || after.ino !== opened.ino || after.size !== opened.size
      || name !== `${record.acquisitionId}.lock.json`) throw new Error("worker-process-custody-file-binding-mismatch");
    if ("admission" in record && (record.admission.processLockRoot !== root
      || record.admission.authorityPath !== resolve(record.admission.authorityPath))) throw new Error("worker-process-admission-root-mismatch");
    result = record;
  } catch (error) {
    primary = { error: new Error(`worker process-lock record ${name} is malformed or unsafe`, { cause: error }) };
  }
  if (descriptor !== undefined) {
    try { closeSync(descriptor); }
    catch (error) { throw retainAuthoritySourceClosure(primary === undefined ? [error] : [primary.error, error],
      { descriptor: { descriptor, ...(descriptorIdentity === undefined ? {} : { identity: descriptorIdentity }) } }); }
  }
  if (primary !== undefined) throw primary.error;
  if (result === undefined) throw new Error("worker-process-lock-result-missing");
  return result;
}

function readWorkerProcessLocks(root: string): readonly WorkerProcessLockFile[] {
  const directory = join(root, WORKER_PROCESS_LOCK_DIRECTORY);
  if (!existsSync(directory)) return [];
  const entries = readdirSync(directory, { withFileTypes: true })
    .filter(({ name }) => !name.startsWith("."))
    .sort((left, right) => left.name.localeCompare(right.name));
  return Object.freeze(entries.map((entry) => {
    if (!entry.isFile() || !entry.name.endsWith(".lock.json")) {
      throw new Error(`workers process-lock directory contains unexpected entry ${entry.name}`);
    }
    return readWorkerProcessLockRecord(directory, entry.name);
  }));
}

/** Optional diagnostics need every record's validity, but neither an array nor history order. */
function* iterateWorkerProcessLocks(root: string): Generator<WorkerProcessLockFile> {
  const directoryPath = join(root, WORKER_PROCESS_LOCK_DIRECTORY);
  if (!existsSync(directoryPath)) return;
  const directory = opendirSync(directoryPath);
  let primary: { error: unknown } | undefined;
  const close = () => {
    try { directory.closeSync(); }
    catch (error) { throw retainAuthoritySourceClosure(primary === undefined ? [error] : [primary.error, error], { directory }); }
  };
  try {
    for (let entry = directory.readSync(); entry !== null; entry = directory.readSync()) {
      if (entry.name.startsWith(".")) continue;
      if (!entry.isFile() || !entry.name.endsWith(".lock.json")) {
        throw new Error(`workers process-lock directory contains unexpected entry ${entry.name}`);
      }
      yield readWorkerProcessLockRecord(directoryPath, entry.name);
    }
  } catch (error) { primary = { error }; throw error; }
  finally { close(); }
}


export function readRuntimeProcessLock(
  processLockRoot: string,
  name: RuntimeProcessLockName,
): RuntimeProcessLockFile | undefined {
  if (name !== "workers") {
    const state = activeSingletonClaims(resolve(processLockRoot), name, observeProcessIdentity);
    return state.active[0] ?? state.claims.at(-1);
  }
  const path = lockPath(resolve(processLockRoot), name);
  if (!existsSync(path)) return undefined;
  throw new Error(`workers process-lock record ${path} is malformed or unsupported`);

}


export function acquireRuntimeProcessLock(
  input: unknown,
  clock: Clock = systemClock,
  hooks: RuntimeProcessLockAcquisitionHooks = {},
): RuntimeProcessLockHandle {
  const options = RuntimeProcessLockOptionsSchema.parse(input);
  const root = resolve(options.processLockRoot);
  const observer = hooks.observeProcessIdentity ?? observeProcessIdentity;
  const processIdentity = captureProcessIdentity(options.pid, observer);
  assertRestoreAdmissionOpen(root, observer);
  hooks.afterInitialAdmissionCheck?.();
  if (options.name !== "workers") return acquireSingletonClaim(root, options.name, options.pid, processIdentity, clock, observer, hooks);

  readRuntimeProcessLock(root, "workers");
  const existingRecords = readWorkerProcessLocks(root);
  const acquisitionId = randomUUID();
  const record = WorkerProcessLockFileSchema.parse({
    schemaVersion: 3,
    name: "workers",
    ...("workerId" in options ? { workerId: options.workerId } : { admission: { ...options.admission, authorityPath: resolve(options.admission.authorityPath), processLockRoot: root } }),
    pid: options.pid,
    processIdentity,
    acquisitionId,
    acquiredAt: clock.now().toISOString(),
    releasedAt: null,
  });
  writeWorkerProcessLockFile(root, record);
  const generation = existingRecords.length + 2;
  let released = false;
  const handle = Object.freeze({
    name: "workers",
    generation,
    acquisitionId,
    release: (): void => {
      if (released) return;
      const retained = readWorkerProcessLockRecord(join(root, WORKER_PROCESS_LOCK_DIRECTORY), `${record.acquisitionId}.lock.json`);
      if (canonicalJsonStringify(retained) !== canonicalJsonStringify(record)) throw new Error("worker-process-custody-changed-before-release");
      writeWorkerProcessLockFile(root, WorkerProcessLockFileSchema.parse({
        ...record,
        releasedAt: clock.now().toISOString(),
      }));
      released = true;
    },
  });
  try {
    assertRestoreAdmissionOpen(root, observer);
  } catch (admissionError) {
    try {
      handle.release();
    } catch (releaseError) {
      throw new AggregateError(
        [admissionError, releaseError],
        `worker process acquisition ${record.acquisitionId} lost restore admission and its process record could not release`,
        { cause: releaseError },
      );
    }
    throw admissionError;
  }
  workerCustodyHandles.set(handle, { root, record, observer });
  return handle;
}



export function authoritySourceDatabaseIdentity(path: string): string {
  return createHash("sha256").update(`${String(AUTHORITY_APPLICATION_ID)}:${resolve(z.string().min(1).parse(path))}`).digest("hex");
}

export function observeRuntimeLockSnapshot(
  input: unknown,
  clock: Clock = systemClock,
  hooks: RuntimeLockObservationHooks = {},
): RecoveryRuntimeLockSnapshot {
  const options = RuntimeLockObservationOptionsSchema.parse(input);
  const root = resolve(options.processLockRoot);
  const observer = hooks.observeProcessIdentity ?? observeProcessIdentity;
  const processLocks: Record<string, unknown> = {};
  let runtimeGeneration = 0;
  for (const name of RUNTIME_PROCESS_LOCK_NAMES) {
    if (name !== "workers") {
      const state = activeSingletonClaims(root, name, observer); const active = state.active[0];
      processLocks[name] = active === undefined ? { state: "stopped", generation: state.generation } : { state: "active", generation: state.generation, pid: active.pid };
      runtimeGeneration += state.generation; continue;
    }
    if (name === "workers") {
      readRuntimeProcessLock(root, "workers");
      const records = readWorkerProcessLocks(root);
      const generation = records.length + 1;
      runtimeGeneration += generation;
      const activePids: number[] = [];
      for (const record of records) {
        if (record.releasedAt === null && recordOwnerIsAlive(record, observer)) {
          activePids.push(record.pid);
        }
      }
      activePids.sort((left, right) => left - right);
      const activePid = activePids[0];
      processLocks.workers = activePid === undefined
        ? { state: "stopped", generation }
        : { state: "active", generation, pid: activePid };
      continue;
    }

  }
  return RecoveryRuntimeLockSnapshotSchema.parse({
    schemaVersion: 1,
    runtimeNamespace: "hrauto-rebuild",
    runtimeGeneration,
    sourceDatabaseIdentity: options.sourceDatabaseIdentity,
    recordedAt: clock.now().toISOString(),
    processLocks,
  });
}

/** Read-only stale-owner diagnosis for the optional `process.orphans` preflight check. */
export function inspectRuntimeProcessOrphans(
  processLockRoot: string,
  hooks: RuntimeLockObservationHooks = {},
): RuntimeProcessOrphanInspection {
  const root = resolve(z.string().min(1).parse(processLockRoot));
  const observer = hooks.observeProcessIdentity ?? observeProcessIdentity;
  const server = readRuntimeProcessLock(root, "server");
  const staleServerRecords = server !== undefined
    && server.releasedAt === null
    && !recordOwnerIsAlive(server, observer)
    ? 1
    : 0;
  readRuntimeProcessLock(root, "workers");
  let staleWorkerRecords = 0;
  for (const record of iterateWorkerProcessLocks(root)) {
    if (record.releasedAt === null && !recordOwnerIsAlive(record, observer)) staleWorkerRecords += 1;
  }
  return Object.freeze({ staleServerRecords, staleWorkerRecords });
}

export function inspectStoppedDeviceRecertificationCustody(processLockRoot: string) {
  if (process.platform !== "darwin") throw new Error("device-recertification-boot-unproved");
  const boot = spawnSync("/usr/sbin/sysctl", ["-n", "kern.boottime"], { encoding: "utf8" });
  const seconds = /^\{\s*sec = (\d+),/u.exec(boot.stdout)?.[1];
  if (boot.error !== undefined || boot.status !== 0 || seconds === undefined) throw new Error("device-recertification-boot-unproved");
  const bootStartedAt = Number(seconds) * 1000;
  if (!Number.isSafeInteger(bootStartedAt) || bootStartedAt <= 0) throw new Error("device-recertification-boot-unproved");
  const root = resolve(processLockRoot);
  for (const role of ["server", "live-smoke", "geocode"] as const) {
    if (existsSync(join(root, `${role}-claims`)) && readdirSync(claimDirectory(root, role)).some(name => name.startsWith(".") || name.endsWith(".tmp") || name.endsWith(".channel.json"))) throw new Error("device-recertification-process-custody-unproved");
  }
  const workerDirectory = join(root, WORKER_PROCESS_LOCK_DIRECTORY), workerStat = lstatSync(workerDirectory, { throwIfNoEntry: false });
  if (workerStat !== undefined && (!workerStat.isDirectory() || workerStat.isSymbolicLink() || (workerStat.mode & 0o077) !== 0
    || process.getuid !== undefined && workerStat.uid !== process.getuid() || readdirSync(workerDirectory).some(name => name.startsWith(".")))) throw new Error("device-recertification-worker-custody-unproved");
  const singletons = (["server", "live-smoke", "geocode"] as const).flatMap(role => readSingletonClaims(root, role));
  readRuntimeProcessLock(root, "workers");
  const workers = [...iterateWorkerProcessLocks(root)];
  if (workers.some(record => record.releasedAt === null)) throw new Error("device-recertification-worker-custody-unproved");
  const retained = singletons.filter(record => record.releasedAt === null);
  for (const record of retained) {
    const startedAt = Number(record.processIdentity.startToken) * 1000;
    if (record.name !== "server" || record.processIdentity.platform !== "darwin" || !/^\d+$/u.test(record.processIdentity.startToken)
      || !Number.isSafeInteger(startedAt) || startedAt <= 0 || startedAt >= bootStartedAt
      || Date.parse(record.acquiredAt) >= bootStartedAt || Date.parse(record.acquiredAt) < startedAt
      || observeProcessIdentity(record.pid).state !== "gone") throw new Error("device-recertification-server-custody-unproved");
  }
  const files = ["server-claims", "live-smoke-claims", "geocode-claims", WORKER_PROCESS_LOCK_DIRECTORY].flatMap(name => {
    const directory = join(root, name);
    if (!existsSync(directory)) return [];
    return ["", ...readdirSync(directory).sort()].map(child => {
      const info = lstatSync(join(directory, child));
      return { path: `${name}/${child}`, device: info.dev, inode: info.ino, mode: info.mode, owner: info.uid,
        links: info.nlink, size: info.size, modified: info.mtimeMs, changed: info.ctimeMs };
    });
  });
  return { bootStartedAt, singletons, workers, files };
}

export function runtimeProcessLockIsActive(processLockRoot: string, name: RuntimeProcessLockName): boolean {
  if (name !== "workers") return activeSingletonClaims(resolve(processLockRoot), name, observeProcessIdentity).active.length > 0;
  if (name === "workers") {
    readRuntimeProcessLock(processLockRoot, name);
    return readWorkerProcessLocks(resolve(processLockRoot)).some(record => record.releasedAt === null && recordOwnerIsAlive(record, observeProcessIdentity));
  }
  return false;
}

export function assertWorkerProcessStopped(processLockRoot: string, workerId: string, hooks: RuntimeLockObservationHooks = {}): void {
  const root = resolve(z.string().min(1).parse(processLockRoot));
  const identity = WorkerIdSchema.parse(workerId);
  const observer = hooks.observeProcessIdentity ?? observeProcessIdentity;
  const aggregate = readRuntimeProcessLock(root, "workers");
  if (aggregate !== undefined && aggregate.releasedAt === null && recordOwnerIsAlive(aggregate, observer)) throw new Error("worker-process-ownership-unavailable");
  for (const record of iterateWorkerProcessLocks(root)) {
    if (record.releasedAt === null && recordOwnerIsAlive(record, observer)
      && (!("workerId" in record) || record.workerId === identity)) throw new Error("worker-process-still-active");
  }
}

const workerCustodyHandles = new WeakMap<RuntimeProcessLockHandle, Readonly<{
  root: string; record: WorkerProcessLockFile; observer: ProcessIdentityObserver; authorityPath?: string; startupFresh?: boolean;
}>>();

export function authenticateWorkerBirthCustody(handle: RuntimeProcessLockHandle, workerId: string, pid: number, authorityPath: string, requireFresh = false) {
  const held = workerCustodyHandles.get(handle);
  if (held === undefined || requireFresh && held.startupFresh !== true || held.authorityPath !== resolve(authorityPath) || !("workerId" in held.record) || held.record.workerId !== workerId
    || held.record.pid !== pid) throw new Error("worker-birth-custody-unavailable");
  const record = readWorkerProcessLockRecord(join(held.root, WORKER_PROCESS_LOCK_DIRECTORY), `${held.record.acquisitionId}.lock.json`);
  if (record.releasedAt !== null || canonicalJsonStringify(record) !== canonicalJsonStringify(held.record)
    || !recordOwnerIsAlive(record, held.observer)) throw new Error("worker-birth-custody-unavailable");
  return Object.freeze({ processLockRoot: held.root, owner: record });
}

export function retireWorkerStartupCustody(handle: RuntimeProcessLockHandle): void {
  const held = workerCustodyHandles.get(handle);
  if (held === undefined || held.authorityPath === undefined) throw new Error("worker-birth-custody-unavailable");
  workerCustodyHandles.set(handle, { ...held, startupFresh: false });
}

export function authenticateRetainedWorkerCustody(input: Readonly<{
  processLockRoot: string; owner: WorkerProcessLockFile;
}>, hooks: RuntimeLockObservationHooks = {}): "alive" | "released-alive" | "released" | "dead" {
  if (!("workerId" in input.owner) || input.owner.releasedAt !== null) throw new Error("worker-birth-custody-unavailable");
  const retained = readWorkerProcessLockRecord(join(resolve(input.processLockRoot), WORKER_PROCESS_LOCK_DIRECTORY), `${input.owner.acquisitionId}.lock.json`);
  if (canonicalJsonStringify({ ...retained, releasedAt: null }) !== canonicalJsonStringify(input.owner)) throw new Error("worker-birth-custody-changed");
  const observed = (hooks.observeProcessIdentity ?? observeProcessIdentity)(retained.pid);
  if (observed.state === "alive") {
    if (canonicalJsonStringify(observed.identity) !== canonicalJsonStringify(retained.processIdentity)) throw new Error("worker-birth-process-identity-changed");
    return retained.releasedAt === null ? "alive" : "released-alive";
  }
  if (observed.state !== "gone") throw new Error("worker-birth-process-identity-unavailable");
  return retained.releasedAt === null ? "dead" : "released";
}

export function assertWorkerProcessCustody(input: Readonly<{ processLockRoot: string; acquisitionId: string; pid: number; workerId?: string; authorityPath?: string }>, hooks: RuntimeLockObservationHooks = {}): void {
  const root = resolve(input.processLockRoot);
  const record = readWorkerProcessLockRecord(join(root, WORKER_PROCESS_LOCK_DIRECTORY), `${z.uuid().parse(input.acquisitionId)}.lock.json`);
  if (record.pid !== input.pid || record.releasedAt !== null
    || !recordOwnerIsAlive(record, hooks.observeProcessIdentity ?? observeProcessIdentity)
    || (input.workerId === undefined ? !("admission" in record) || record.admission.authorityPath !== resolve(z.string().min(1).parse(input.authorityPath))
      : !("workerId" in record) || record.workerId !== input.workerId)) throw new Error("worker-process-custody-not-held");
}

export class WorkerProcessCustodyUncertainError extends AggregateError {
  constructor(causes: readonly unknown[]) {
    super(causes, "worker process admission custody is uncertain", { cause: causes[0] });
    this.name = "WorkerProcessCustodyUncertainError";
  }
}

export function bindWorkerProcessAdmission<T>(input: Readonly<{
  processLockRoot: string; authorityPath: string; pid: number; workerId?: string;
  clock: Clock; hooks?: RuntimeProcessLockAcquisitionHooks;
  initialCustody?: RuntimeProcessLockHandle;
  open(): T; admit(value: T, acquisitionId: string): WorkerId; close(value: T): void;
  releaseStorageCustody?(): void;
}>): Readonly<{ value: T; workerId: WorkerId; processLock: RuntimeProcessLockHandle }> {
  const initial = input.initialCustody ?? acquireRuntimeProcessLock({ processLockRoot: input.processLockRoot, name: "workers", pid: input.pid,
    ...(input.workerId === undefined ? { admission: { kind: "unbound-worker", authorityPath: input.authorityPath } }
      : { workerId: input.workerId }) }, input.clock, input.hooks);
  let opened: { value: T } | undefined;
  let stable: RuntimeProcessLockHandle | undefined;
  let initialReleased = false;
  let handoffUncertain = false;
  try {
    const acquisitionId = z.uuid().parse(initial.acquisitionId);
    assertWorkerProcessCustody({ processLockRoot: input.processLockRoot, acquisitionId, pid: input.pid,
      ...(input.initialCustody !== undefined || input.workerId === undefined ? { authorityPath: input.authorityPath } : { workerId: input.workerId }) }, input.hooks);
    opened = { value: input.open() };
    const workerId = WorkerIdSchema.parse(input.admit(opened.value, acquisitionId));
    if (input.workerId !== undefined && workerId !== input.workerId) throw new Error("worker-admission-stable-identity-mismatch");
    stable = input.initialCustody !== undefined || input.workerId === undefined ? acquireRuntimeProcessLock({ processLockRoot: input.processLockRoot,
      name: "workers", pid: input.pid, workerId }, input.clock, input.hooks) : initial;
    assertWorkerProcessCustody({ processLockRoot: input.processLockRoot,
      acquisitionId: z.uuid().parse(stable.acquisitionId), pid: input.pid, workerId }, input.hooks);
    if (stable !== initial) {
      try { initial.release(); initialReleased = true; }
      catch (error) { handoffUncertain = true; throw error; }
    }
    const custody = workerCustodyHandles.get(stable);
    if (custody === undefined || custody.root !== resolve(input.processLockRoot)) throw new Error("worker-birth-custody-unavailable");
    workerCustodyHandles.set(stable, { ...custody, authorityPath: resolve(input.authorityPath), startupFresh: true });
    return Object.freeze({ value: opened.value, workerId, processLock: stable });
  } catch (error) {
    const failures: unknown[] = [error];
    let closed = opened === undefined;
    if (opened !== undefined) {
      try { input.close(opened.value); closed = true; } catch (closeError) { failures.push(closeError); }
    }
    if (closed) {
      try { input.releaseStorageCustody?.(); }
      catch (releaseError) { throw new WorkerProcessCustodyUncertainError([...failures, releaseError]); }
      if (handoffUncertain) throw new WorkerProcessCustodyUncertainError(failures);
      if (stable !== undefined && stable !== initial) {
        try { stable.release(); }
        catch (releaseError) { throw new WorkerProcessCustodyUncertainError([...failures, releaseError]); }
      }
      if (!initialReleased) {
        try { initial.release(); }
        catch (releaseError) { throw new WorkerProcessCustodyUncertainError([...failures, releaseError]); }
      }
    }
    if (failures.length > 1) throw new WorkerProcessCustodyUncertainError(failures);
    throw error;
  }
}
