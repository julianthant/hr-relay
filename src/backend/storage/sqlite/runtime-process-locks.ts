/**
 * The two runtime process locks ref dashboard-surfaces §2.5's restore interlock needs, and the
 * OBSERVATION that composes them into a `RecoveryRuntimeLockSnapshot` (D181).
 *
 * ## Why this exists
 *
 * `RecoveryStopProofStore` has always required a recorded runtime-lock
 * snapshot before it will issue a stopped-system proof, and nothing in
 * production ever recorded one — so `cli storage restore` could not have
 * worked even once. The missing half was never the proof; it was the fact the
 * proof is about. `config/runtime-isolation.json` has pinned
 * `.tracker/locks` as a distinct resource since D88 and no code wrote
 * there.
 *
 * ## Atomic singleton admission plus one worker record per process start
 *
 * The singleton server claims its root record with an atomic hard link, so two
 * contenders cannot both pass a check-then-replace window. Every worker
 * process appends its own immutable-identity record under `workers/`. The
 * snapshot is COMPOSED into the existing strict `{server, workers}` shape when
 * an operator asks to restore. This admits concurrent workers without a shared
 * read-modify-write and still refuses restore while any recorded worker owner
 * is alive. Old root-level role records remain readable and are never deleted.
 *
 * ## Liveness is observed, never assumed
 *
 * A crashed process leaves a held lock behind. Treating that as "still
 * running" would make restore permanently impossible after any crash — the one
 * moment restore is most needed. So the observation asks the operating system
 * whether the recorded pid still exists (`process.kill(pid, 0)`), and reports
 * `stopped` only for a pid that is genuinely gone. It never rewrites another
 * process's lock file to make a restore possible. New records bind PID to an
 * OS process-start identity, so a recycled PID is not mistaken for its prior
 * owner; legacy PID-only records stay conservative and read forward.
 *
 * `runtimeGeneration` is the sum of the two aggregate generations. The worker
 * generation advances for every durable worker-start record, including a
 * restart, so a stopped proof can never survive a later process start.
 */
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  closeSync,
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

/**
 * `server` and `workers` are the two roles the D181 restore snapshot composes
 * (`RecoveryRuntimeLockSnapshotSchema.processLocks` is a strict `{server,
 * workers}` object, and `RUNTIME_PROCESS_LOCK_NAMES` below is exactly those
 * two). `live-smoke` is a THIRD role added for review finding 3
 * (`scripts/verify/browser-login.ts`, ref execution-and-sessions §10): it
 * reuses this same acquire/release/liveness-refusal discipline so a smoke
 * cannot open the authority database — and potentially migrate it — while
 * another live smoke holds the role, but it is deliberately NOT added to
 * `RUNTIME_PROCESS_LOCK_NAMES` or the snapshot schema, which stay scoped to
 * the two long-lived server roles the stopped-system proof is about.
 */
export const RuntimeProcessLockNameSchema = z.enum(["server", "workers", "live-smoke"]);
export type RuntimeProcessLockName = z.infer<typeof RuntimeProcessLockNameSchema>;

/** The two roles the D181 restore snapshot composes, in the order it records them. */
export const RUNTIME_PROCESS_LOCK_NAMES: readonly RuntimeProcessLockName[] = Object.freeze([
  "server",
  "workers",
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
  name: z.enum(["server", "live-smoke"]),
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
  name: z.enum(["server", "live-smoke"]),
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

/**
 * Whether the recorded pid still names a live process.
 *
 * `EPERM` means the process exists and belongs to somebody else, which is
 * still ALIVE — reporting it gone would let a restore run under a live
 * runtime. Any other errno is unknown and refuses rather than guessing.
 */
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

/**
 * Observe the OS process birth identity, not only PID occupancy.
 *
 * Linux uses boot-id + `/proc/<pid>/stat` start ticks. macOS reads the kernel
 * process start stamp through `ps` under a fixed C/UTC environment and stores
 * epoch seconds; Windows uses `Get-Process.StartTime` ticks. Unsupported
 * platforms refuse. The Darwin stamp has one-second
 * resolution; that narrow same-second PID-recycle limitation is documented in
 * ref dashboard-surfaces §2.5 rather than hidden behind PID-only liveness.
 */
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

function singletonHistoryDirectory(root: string, name: "server" | "live-smoke"): string {
  return join(root, SINGLETON_HISTORY_DIRECTORY, name);
}

function readSingletonHistory(root: string, name: "server" | "live-smoke"): readonly RuntimeProcessLockFile[] {
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

function singletonGeneration(root: string, name: "server" | "live-smoke"): number {
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

/**
 * The lock file as it stands, or `undefined` when this role has never run
 * under this state root. A file that exists but does not parse is a REFUSAL,
 * never an absence: silently treating it as "never ran" would let a restore
 * proceed past a lock it could not read.
 */
export function readRuntimeProcessLock(
  processLockRoot: string,
  name: RuntimeProcessLockName,
): RuntimeProcessLockFile | undefined {
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

/**
 * Take this process's runtime record. Singleton roles refuse a live holder;
 * workers append independent records because identity collision belongs to the
 * authority worker lease, not the restore-safety observation layer.
 */
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
  if (options.name === "workers") {
    // Validate every prior record before writing this process's own. A malformed
    // predecessor must refuse without stranding a new live-PID record whose
    // caller never received a release handle.
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

/**
 * Compose the two role locks into the snapshot `RecoveryStopProofStore`
 * records, observing pid liveness for anything still marked held.
 *
 * A role that has never run reports `stopped` at generation 1 — that is a true
 * statement about a lock nothing has ever taken, not a fabricated release.
 */
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
