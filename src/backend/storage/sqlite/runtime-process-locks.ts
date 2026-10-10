
import { randomUUID } from "node:crypto";
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
} from "../../../rules/identity/ids.js";
import type { RecoveryRuntimeLockSnapshot } from "./recovery-contracts.js";
import { RecoveryRuntimeLockSnapshotSchema } from "./recovery-contracts.js";


export const RuntimeProcessLockNameSchema = z.enum(["server", "workers", "live-smoke", "geocode"]);
export type RuntimeProcessLockName = z.infer<typeof RuntimeProcessLockNameSchema>;


export const RUNTIME_PROCESS_LOCK_NAMES: readonly RuntimeProcessLockName[] = Object.freeze([
  "server",
  "workers",
  "geocode",
]);

const LegacyRuntimeProcessLockFileSchema = z.strictObject({
  schemaVersion: z.literal(1),
  name: RuntimeProcessLockNameSchema,
  pid: PositiveIntSchema,
  generation: PositiveIntSchema,
  acquiredAt: IsoInstantSchema,
  /** `null` while the process holds the lock; the instant it released it otherwise. */
  releasedAt: IsoInstantSchema.nullable(),
});

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

export const RuntimeProcessLockFileSchema = z.union([
  LegacyRuntimeProcessLockFileSchema,
  CurrentRuntimeProcessLockFileSchema,
]);
export type RuntimeProcessLockFile = z.infer<typeof RuntimeProcessLockFileSchema>;

const LegacyWorkerProcessLockFileSchema = z.strictObject({
  schemaVersion: z.literal(2),
  name: z.literal("workers"),
  workerId: WorkerIdSchema,
  pid: PositiveIntSchema,
  acquisitionId: z.uuid(),
  acquiredAt: IsoInstantSchema,
  /** `null` while this exact worker process holds the record. */
  releasedAt: IsoInstantSchema.nullable(),
});

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

export const WorkerProcessLockFileSchema = z.union([
  LegacyWorkerProcessLockFileSchema,
  CurrentWorkerProcessLockFileSchema,
]);
export type WorkerProcessLockFile = z.infer<typeof WorkerProcessLockFileSchema>;

const LegacyRestoreAdmissionFileSchema = z.strictObject({
  schemaVersion: z.literal(1),
  pid: PositiveIntSchema,
  admissionId: z.uuid(),
  acquiredAt: IsoInstantSchema,
});

const CurrentRestoreAdmissionFileSchema = z.strictObject({
  schemaVersion: z.literal(2),
  pid: PositiveIntSchema,
  processIdentity: ProcessStartIdentitySchema,
  admissionId: z.uuid(),
  acquiredAt: IsoInstantSchema,
});

export const RestoreAdmissionFileSchema = z.union([
  LegacyRestoreAdmissionFileSchema,
  CurrentRestoreAdmissionFileSchema,
]);
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

export const RuntimeProcessLockOptionsSchema = z.discriminatedUnion("name", [
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
  if (!("processIdentity" in record)) return true;
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
const SINGLETON_HISTORY_DIRECTORY = "singleton-history";
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
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function writeLockFile(root: string, record: RuntimeProcessLockFile): void {
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const temporaryPath = join(root, `.${record.name}-${randomUUID()}.tmp`);
  const finalPath = lockPath(root, record.name);
  try {
    writeFileSync(temporaryPath, `${canonicalJsonStringify(record)}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    fsyncPath(temporaryPath);
    renameSync(temporaryPath, finalPath);
    fsyncPath(root);
  } finally {
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
  }
}

const GEOCODE_DIRECTORY = "geocode-claims";
const GeocodeReleaseSchema = z.strictObject({ generation: PositiveIntSchema, acquisitionId: z.uuid(), releasedAt: IsoInstantSchema });
export interface GeocodeFileCustody { readonly dev: number; readonly ino: number; readonly size: number; readonly mtimeMs: number }

function geocodeDirectory(root: string, create = false): string {
  if (create) mkdirSync(root, { recursive: true, mode: 0o700 });
  const parent = lstatSync(root);
  if (!parent.isDirectory() || parent.isSymbolicLink() || (parent.mode & 0o077) !== 0 || (process.getuid !== undefined && parent.uid !== process.getuid())) throw new Error("geocode-root-unsafe");
  const directory = join(root, GEOCODE_DIRECTORY);
  if (create) mkdirSync(directory, { mode: 0o700, recursive: true });
  const stat = lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 || (process.getuid !== undefined && stat.uid !== process.getuid())) throw new Error("geocode-directory-unsafe");
  return directory;
}
function geocodeFilePath(root: string, name: string): string {
  if (!/^[a-zA-Z0-9.-]+$/u.test(name) || name.startsWith(".")) throw new Error("geocode-file-name-invalid");
  return join(geocodeDirectory(root), name);
}
function privateGeocodeFile(fd: number): GeocodeFileCustody {
  const stat = fstatSync(fd);
  if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o077) !== 0 || (stat.mode & 0o600) !== 0o600 || (process.getuid !== undefined && stat.uid !== process.getuid()) || stat.size > 65_536) throw new Error("geocode-file-unsafe");
  return { dev: stat.dev, ino: stat.ino, size: stat.size, mtimeMs: stat.mtimeMs };
}
function custodyEquals(a: GeocodeFileCustody, b: GeocodeFileCustody): boolean { return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs; }

/** Geocode lifetime metadata only; descriptor reads never follow endpoint links. */
export function readGeocodeRuntimeFile(root: string, name: string): Readonly<{ text: string; custody: GeocodeFileCustody }> {
  const fd = openSync(geocodeFilePath(root, name), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const custody = privateGeocodeFile(fd);
    const bytes = Buffer.alloc(65_537); let length = 0;
    for (;;) { const count = readSync(fd, bytes, length, bytes.length - length, null); length += count; if (length > 65_536) throw new Error("geocode-file-oversize"); if (count === 0) break; }
    if (!custodyEquals(custody, privateGeocodeFile(fd)) || length !== custody.size) throw new Error("geocode-file-changed");
    return { text: bytes.subarray(0, length).toString("utf8"), custody };
  } finally { closeSync(fd); }
}
export function writeGeocodeRuntimeFileExclusive(root: string, name: string, text: string): GeocodeFileCustody {
  geocodeDirectory(root, true);
  const fd = openSync(geocodeFilePath(root, name), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { writeFileSync(fd, text, "utf8"); fsyncSync(fd); return privateGeocodeFile(fd); }
  finally { closeSync(fd); fsyncPath(geocodeDirectory(root)); }
}
export function removeOwnedGeocodeRuntimeFile(root: string, name: string, custody: GeocodeFileCustody): void {
  const current = readGeocodeRuntimeFile(root, name);
  if (!custodyEquals(current.custody, custody)) throw new Error("geocode-file-custody-lost");
  unlinkSync(geocodeFilePath(root, name)); fsyncPath(geocodeDirectory(root));
}
function readGeocodeClaims(root: string): readonly z.output<typeof CurrentRuntimeProcessLockFileSchema>[] {
  if (lstatSync(lockPath(root, "geocode"), { throwIfNoEntry: false }) !== undefined) throw new Error("geocode-mutable-lock-unsupported");
  const parent = lstatSync(root, { throwIfNoEntry: false });
  if (parent === undefined) return [];
  if (!parent.isDirectory() || parent.isSymbolicLink() || (parent.mode & 0o077) !== 0 || (process.getuid !== undefined && parent.uid !== process.getuid())) throw new Error("geocode-root-unsafe");
  if (lstatSync(join(root, GEOCODE_DIRECTORY), { throwIfNoEntry: false }) === undefined) return [];
  const directory = geocodeDirectory(root);
  {
    const names = readdirSync(directory).filter(name => !name.startsWith("."));
    const claims: z.output<typeof CurrentRuntimeProcessLockFileSchema>[] = [];
    for (const name of names) {
      if (/^\d+-[a-f0-9-]+\.(?:channel\.json|tmp)$/u.test(name)) continue;
      if (/^\d+-[a-f0-9-]+\.release\.json$/u.test(name)) continue;
      if (!/^\d+\.claim\.json$/u.test(name)) throw new Error("geocode-claim-entry-invalid");
      const claim = CurrentRuntimeProcessLockFileSchema.parse(JSON.parse(readGeocodeRuntimeFile(root, name).text));
      if (claim.name !== "geocode" || claim.releasedAt !== null || name !== `${claim.generation}.claim.json`) throw new Error("geocode-claim-identity-invalid");
      const releaseName = `${claim.generation}-${claim.acquisitionId}.release.json`;
      try {
        const release = GeocodeReleaseSchema.parse(JSON.parse(readGeocodeRuntimeFile(root, releaseName).text));
        if (release.generation !== claim.generation || release.acquisitionId !== claim.acquisitionId) throw new Error("geocode-release-identity-invalid");
        claims.push({ ...claim, releasedAt: release.releasedAt });
      } catch (error) { if (errnoOf(error) !== "ENOENT") throw error; claims.push(claim); }
    }
    for (const name of names.filter(name => name.endsWith(".release.json"))) if (!claims.some(claim => name === `${claim.generation}-${claim.acquisitionId}.release.json`)) throw new Error("geocode-release-unbound");
    return claims.sort((a, b) => a.generation - b.generation);
  }
}
function activeGeocodeClaims(root: string, observer: ProcessIdentityObserver) {
  const claims = readGeocodeClaims(root);
  return { claims, active: claims.filter(claim => claim.releasedAt === null && recordOwnerIsAlive(claim, observer)), generation: Math.max(1, ...claims.map(claim => claim.generation)) };
}
function acquireGeocodeClaim(root: string, pid: number, processIdentity: ProcessStartIdentity, clock: Clock, observer: ProcessIdentityObserver, hooks: RuntimeProcessLockAcquisitionHooks): RuntimeProcessLockHandle {
  const initial = activeGeocodeClaims(root, observer);
  if (initial.active.length > 0) throw new Error("geocode-owner-active");
  const generation = initial.generation + 1;
  hooks.afterGeocodeGenerationRead?.();
  const claim = CurrentRuntimeProcessLockFileSchema.parse({ schemaVersion: 2, name: "geocode", pid, processIdentity, acquisitionId: randomUUID(), generation, acquiredAt: clock.now().toISOString(), releasedAt: null });
  const temporary = `${generation}-${claim.acquisitionId}.tmp`;
  writeGeocodeRuntimeFileExclusive(root, temporary, `${canonicalJsonStringify(claim)}\n`);
  try { linkSync(geocodeFilePath(root, temporary), geocodeFilePath(root, `${generation}.claim.json`)); }
  finally { unlinkSync(geocodeFilePath(root, temporary)); fsyncPath(geocodeDirectory(root)); }
  let released = false;
  const handle: RuntimeProcessLockHandle = Object.freeze({ name: "geocode", generation, acquisitionId: claim.acquisitionId, release() {
    if (released) return;
    const stored = CurrentRuntimeProcessLockFileSchema.parse(JSON.parse(readGeocodeRuntimeFile(root, `${generation}.claim.json`).text));
    if (canonicalJsonStringify(stored) !== canonicalJsonStringify(claim)) throw new Error("geocode-claim-custody-lost");
    writeGeocodeRuntimeFileExclusive(root, `${generation}-${claim.acquisitionId}.release.json`, `${canonicalJsonStringify({ generation, acquisitionId: claim.acquisitionId, releasedAt: clock.now().toISOString() })}\n`);
    released = true;
  } });
  try {
    const current = activeGeocodeClaims(root, observer);
    if (current.active.some(owner => owner.acquisitionId !== claim.acquisitionId) || !current.active.some(owner => owner.acquisitionId === claim.acquisitionId)) throw new Error("geocode-owner-conflict");
    assertRestoreAdmissionOpen(root, observer);
  } catch (error) { handle.release(); throw error; }
  return handle;
}

function singletonHistoryDirectory(root: string, name: "server" | "live-smoke" | "geocode"): string {
  return join(root, SINGLETON_HISTORY_DIRECTORY, name);
}

function readSingletonHistory(root: string, name: "server" | "live-smoke" | "geocode"): readonly RuntimeProcessLockFile[] {
  const directory = singletonHistoryDirectory(root, name);
  if (!existsSync(directory)) return [];
  return Object.freeze(readdirSync(directory, { withFileTypes: true })
    .filter(({ name: entryName }) => !entryName.startsWith("."))
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((entry) => {
      if (!entry.isFile() || !entry.name.endsWith(".lock.json")) {
        throw new Error(`${name} process-lock history contains unexpected entry ${entry.name}`);
      }
      const path = join(directory, entry.name);
      try {
        const record = RuntimeProcessLockFileSchema.parse(JSON.parse(readFileSync(path, "utf8")));
        if (record.name !== name) {
          throw new Error(`record names ${record.name}`);
        }
        return record;
      } catch (error) {
        throw new Error(`${name} process-lock history record ${entry.name} is malformed`, {
          cause: error,
        });
      }
    }));
}

function archiveSingletonLock(root: string, record: RuntimeProcessLockFile): void {
  if (record.name === "workers") {
    throw new Error("worker aggregate lock cannot enter singleton history");
  }
  const directory = singletonHistoryDirectory(root, record.name);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const identity = "acquisitionId" in record ? record.acquisitionId : randomUUID();
  renameSync(lockPath(root, record.name), join(
    directory,
    `${String(record.generation).padStart(12, "0")}-${identity}.lock.json`,
  ));
  fsyncPath(directory);
  fsyncPath(root);
}

function singletonGeneration(root: string, name: "server" | "live-smoke" | "geocode"): number {
  return readSingletonHistory(root, name).reduce(
    (maximum, record) => Math.max(maximum, record.generation),
    0,
  );
}

function createSingletonLockAtomically(root: string, record: RuntimeProcessLockFile): boolean {
  if (record.name === "workers") throw new Error("worker aggregate lock is not a singleton");
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const identity = "acquisitionId" in record ? record.acquisitionId : randomUUID();
  const temporaryPath = join(root, `.${record.name}-${identity}.tmp`);
  try {
    writeFileSync(temporaryPath, `${canonicalJsonStringify(record)}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    fsyncPath(temporaryPath);
    const failure = tryLink(temporaryPath, lockPath(root, record.name));
    if (failure !== undefined) {
      if (errnoOf(failure) === "EEXIST") return false;
      if (failure instanceof Error) throw failure;
      throw new Error(`${record.name} atomic process-lock link failed with a non-Error value`, {
        cause: failure,
      });
    }
    fsyncPath(root);
    return true;
  } finally {
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
  }
}

function writeWorkerProcessLockFile(root: string, record: WorkerProcessLockFile): void {
  const directory = join(root, WORKER_PROCESS_LOCK_DIRECTORY);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
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
  try {
    writeFileSync(temporaryPath, `${canonicalJsonStringify(record)}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    fsyncPath(temporaryPath);
    const linkFailure = tryLink(temporaryPath, restoreAdmissionPath(root));
    if (linkFailure !== undefined) {
      if (errnoOf(linkFailure) === "EEXIST") return false;
      if (linkFailure instanceof Error) throw linkFailure;
      throw new Error("restore admission atomic link failed with a non-Error value", {
        cause: linkFailure,
      });
    }
    fsyncPath(root);
    return true;
  } finally {
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
  }
}

function tryLink(source: string, destination: string): unknown {
  try {
    linkSync(source, destination);
  } catch (error) {
    return error;
  }
  return undefined;
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
    return Object.freeze({
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
  }
}

function readWorkerProcessLockRecord(directory: string, name: string): WorkerProcessLockFile {
  try {
    return WorkerProcessLockFileSchema.parse(JSON.parse(readFileSync(join(directory, name), "utf8")));
  } catch (error) {
    throw new Error(`worker process-lock record ${name} is malformed`, { cause: error });
  }
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
  try {
    for (let entry = directory.readSync(); entry !== null; entry = directory.readSync()) {
      if (entry.name.startsWith(".")) continue;
      if (!entry.isFile() || !entry.name.endsWith(".lock.json")) {
        throw new Error(`workers process-lock directory contains unexpected entry ${entry.name}`);
      }
      yield readWorkerProcessLockRecord(directoryPath, entry.name);
    }
  } finally {
    directory.closeSync();
  }
}


export function readRuntimeProcessLock(
  processLockRoot: string,
  name: RuntimeProcessLockName,
): RuntimeProcessLockFile | undefined {
  if (name === "geocode") {
    const state = activeGeocodeClaims(resolve(processLockRoot), observeProcessIdentity);
    if (state.active.length > 1) throw new Error("geocode-owner-conflict");
    return state.active[0] ?? state.claims.at(-1);
  }
  const path = lockPath(resolve(processLockRoot), name);
  if (!existsSync(path)) return undefined;
  try {
    const record = RuntimeProcessLockFileSchema.parse(JSON.parse(readFileSync(path, "utf8")));
    if (record.name !== name) {
      throw new Error(`record names ${record.name}`);
    }
    return record;
  } catch (error) {
    throw new Error(`${name} process-lock record ${path} is malformed`, { cause: error });
  }
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
  if (options.name === "geocode") return acquireGeocodeClaim(root, options.pid, processIdentity, clock, observer, hooks);
  if (options.name === "workers") {

    const legacy = readRuntimeProcessLock(root, "workers");
    const existingRecords = readWorkerProcessLocks(root);
    const acquisitionId = randomUUID();
    const record = WorkerProcessLockFileSchema.parse({
      schemaVersion: 3,
      name: "workers",
      workerId: options.workerId,
      pid: options.pid,
      processIdentity,
      acquisitionId,
      acquiredAt: clock.now().toISOString(),
      releasedAt: null,
    });
    writeWorkerProcessLockFile(root, record);
    const generation = (legacy?.generation ?? 1) + existingRecords.length + 1;
    let released = false;
    const handle = Object.freeze({
      name: "workers",
      generation,
      release: (): void => {
        if (released) return;
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
          `worker ${record.workerId} lost restore admission and its process record could not release`,
          { cause: releaseError },
        );
      }
      throw admissionError;
    }
    return handle;
  }
  for (;;) {
    const held = readRuntimeProcessLock(root, options.name);
    if (held !== undefined) {
      if (held.releasedAt === null && recordOwnerIsAlive(held, observer)) {
        throw new Error(
          `rebuild ${options.name} process lock is held by live pid ${String(held.pid)} `
          + `(generation ${String(held.generation)}, acquired ${held.acquiredAt}); `
          + "stop it before starting another",
        );
      }
      try {
        archiveSingletonLock(root, held);
      } catch (error) {
        if (errnoOf(error) === "ENOENT") continue;
        throw error;
      }
      continue;
    }
    const generation = Math.max(singletonGeneration(root, options.name), 1) + 1;
    const record = RuntimeProcessLockFileSchema.parse({
      schemaVersion: 2,
      name: options.name,
      pid: options.pid,
      processIdentity,
      acquisitionId: randomUUID(),
      generation,
      acquiredAt: clock.now().toISOString(),
      releasedAt: null,
    });
    if (!createSingletonLockAtomically(root, record)) continue;
    let released = false;
    const handle = Object.freeze({
      name: options.name,
      generation,
      release: (): void => {
        if (released) return;
        const current = readRuntimeProcessLock(root, options.name);
        if (current === undefined
          || !("acquisitionId" in current)
          || !("acquisitionId" in record)
          || current.acquisitionId !== record.acquisitionId) {
          throw new Error(`${options.name} process lock ${"acquisitionId" in record ? record.acquisitionId : "legacy"} is no longer the current owner`);
        }
        writeLockFile(root, RuntimeProcessLockFileSchema.parse({
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
          `${record.name} lost restore admission and its process lock could not release`,
          { cause: releaseError },
        );
      }
      throw admissionError;
    }
    return handle;
  }
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
    if (name === "geocode") {
      const state = activeGeocodeClaims(root, observer); const active = state.active[0];
      processLocks.geocode = active === undefined ? { state: "stopped", generation: state.generation } : { state: "active", generation: state.generation, pid: active.pid };
      runtimeGeneration += state.generation; continue;
    }
    if (name === "workers") {
      const legacy = readRuntimeProcessLock(root, "workers");
      const records = readWorkerProcessLocks(root);
      const generation = (legacy?.generation ?? 1) + records.length;
      runtimeGeneration += generation;
      const activePids: number[] = [];
      if (legacy !== undefined && legacy.releasedAt === null && recordOwnerIsAlive(legacy, observer)) {
        activePids.push(legacy.pid);
      }
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
    const historyGeneration = singletonGeneration(root, name);
    const held = readRuntimeProcessLock(root, name);
    if (held === undefined) {
      const generation = Math.max(historyGeneration, 1);
      processLocks[name] = { state: "stopped", generation };
      runtimeGeneration += generation;
      continue;
    }
    runtimeGeneration += held.generation;
    if (held.releasedAt !== null) {
      processLocks[name] = { state: "stopped", generation: held.generation };
      continue;
    }
    processLocks[name] = recordOwnerIsAlive(held, observer)
      ? { state: "active", generation: held.generation, pid: held.pid }
      : { state: "stopped", generation: held.generation };
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
  const legacyWorkers = readRuntimeProcessLock(root, "workers");
  let staleWorkerRecords = legacyWorkers !== undefined
    && legacyWorkers.releasedAt === null
    && !recordOwnerIsAlive(legacyWorkers, observer)
    ? 1
    : 0;
  for (const record of iterateWorkerProcessLocks(root)) {
    if (record.releasedAt === null && !recordOwnerIsAlive(record, observer)) staleWorkerRecords += 1;
  }
  return Object.freeze({ staleServerRecords, staleWorkerRecords });
}

export function runtimeProcessLockIsActive(processLockRoot: string, name: RuntimeProcessLockName): boolean {
  if (name === "geocode") return activeGeocodeClaims(resolve(processLockRoot), observeProcessIdentity).active.length > 0;
  const record = readRuntimeProcessLock(processLockRoot, name);
  return record !== undefined && record.releasedAt === null && recordOwnerIsAlive(record, observeProcessIdentity);
}
