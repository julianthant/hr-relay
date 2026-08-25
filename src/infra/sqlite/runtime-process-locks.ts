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
 * `.tracker-rebuild/locks` as a distinct resource since D88 and no code wrote
 * there.
 *
 * ## One durable record per process start, composed at observation time
 *
 * The singleton server owns one root-level lock file. Every worker process
 * appends its own immutable-identity record under `workers/` and only rewrites
 * that record to release it. The snapshot the stop-proof store records is
 * COMPOSED into the existing strict `{server, workers}` shape when an operator
 * asks to restore. This admits concurrent workers without a shared
 * read-modify-write and still refuses restore while any recorded worker pid is
 * alive. The old root-level `workers.lock.json` remains part of that aggregate.
 *
 * ## Liveness is observed, never assumed
 *
 * A crashed process leaves a held lock behind. Treating that as "still
 * running" would make restore permanently impossible after any crash — the one
 * moment restore is most needed. So the observation asks the operating system
 * whether the recorded pid still exists (`process.kill(pid, 0)`), and reports
 * `stopped` only for a pid that is genuinely gone. It never rewrites another
 * process's lock file to make a restore possible, and a pid that IS alive
 * refuses by name and number.
 *
 * `runtimeGeneration` is the sum of the two aggregate generations. The worker
 * generation advances for every durable worker-start record, including a
 * restart, so a stopped proof can never survive a later process start.
 */
import { randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";
import { canonicalJsonStringify } from "../../domain/canonical-json.js";
import type { Clock } from "../../domain/clock.js";
import { systemClock } from "../../domain/clock.js";
import {
  FingerprintSchema,
  IsoInstantSchema,
  PositiveIntSchema,
  WorkerIdSchema,
} from "../../domain/ids.js";
import type { RecoveryRuntimeLockSnapshot } from "./recovery-contracts.js";
import { RecoveryRuntimeLockSnapshotSchema } from "./recovery-contracts.js";

/**
 * `server` and `workers` are the two roles the D181 restore snapshot composes
 * (`RecoveryRuntimeLockSnapshotSchema.processLocks` is a strict `{server,
 * workers}` object, and `RUNTIME_PROCESS_LOCK_NAMES` below is exactly those
 * two). `live-smoke` is a THIRD role added for review finding 3
 * (`scripts/live-browser-login-smoke.ts`, ref execution-and-sessions §10): it
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

export const RuntimeProcessLockFileSchema = z.strictObject({
  schemaVersion: z.literal(1),
  name: RuntimeProcessLockNameSchema,
  pid: PositiveIntSchema,
  generation: PositiveIntSchema,
  acquiredAt: IsoInstantSchema,
  /** `null` while the process holds the lock; the instant it released it otherwise. */
  releasedAt: IsoInstantSchema.nullable(),
});
export type RuntimeProcessLockFile = z.infer<typeof RuntimeProcessLockFileSchema>;

export const WorkerProcessLockFileSchema = z.strictObject({
  schemaVersion: z.literal(2),
  name: z.literal("workers"),
  workerId: WorkerIdSchema,
  pid: PositiveIntSchema,
  acquisitionId: z.uuid(),
  acquiredAt: IsoInstantSchema,
  /** `null` while this exact worker process holds the record. */
  releasedAt: IsoInstantSchema.nullable(),
});
export type WorkerProcessLockFile = z.infer<typeof WorkerProcessLockFileSchema>;

export const RestoreAdmissionFileSchema = z.strictObject({
  schemaVersion: z.literal(1),
  pid: PositiveIntSchema,
  admissionId: z.uuid(),
  acquiredAt: IsoInstantSchema,
});
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

function assertRestoreAdmissionOpen(root: string): void {
  const held = readRestoreAdmission(root);
  if (held === undefined) return;
  if (observePid(held.pid).state === "alive") {
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
): RestoreAdmissionHandle {
  const root = resolve(input.processLockRoot);
  const pid = PositiveIntSchema.parse(input.pid);
  for (;;) {
    assertRestoreAdmissionOpen(root);
    const record = RestoreAdmissionFileSchema.parse({
      schemaVersion: 1,
      pid,
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
    const path = join(directory, entry.name);
    try {
      return WorkerProcessLockFileSchema.parse(JSON.parse(readFileSync(path, "utf8")));
    } catch (error) {
      throw new Error(`worker process-lock record ${entry.name} is malformed`, { cause: error });
    }
  }));
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
    return RuntimeProcessLockFileSchema.parse(JSON.parse(readFileSync(path, "utf8")));
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
  assertRestoreAdmissionOpen(root);
  hooks.afterInitialAdmissionCheck?.();
  if (options.name === "workers") {
    // Validate every prior record before writing this process's own. A malformed
    // predecessor must refuse without stranding a new live-PID record whose
    // caller never received a release handle.
    const legacy = readRuntimeProcessLock(root, "workers");
    const existingRecords = readWorkerProcessLocks(root);
    const acquisitionId = randomUUID();
    const record = WorkerProcessLockFileSchema.parse({
      schemaVersion: 2,
      name: "workers",
      workerId: options.workerId,
      pid: options.pid,
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
      assertRestoreAdmissionOpen(root);
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
  const held = readRuntimeProcessLock(root, options.name);
  if (held !== undefined && held.releasedAt === null) {
    const observation = observePid(held.pid);
    if (observation.state === "alive") {
      throw new Error(
        `rebuild ${options.name} process lock is held by live pid ${String(held.pid)} `
        + `(generation ${String(held.generation)}, acquired ${held.acquiredAt}); `
        + "stop it before starting another",
      );
    }
  }
  const generation = (held?.generation ?? 0) + 1;
  const record = RuntimeProcessLockFileSchema.parse({
    schemaVersion: 1,
    name: options.name,
    pid: options.pid,
    generation,
    acquiredAt: clock.now().toISOString(),
    releasedAt: null,
  });
  writeLockFile(root, record);
  let released = false;
  const handle = Object.freeze({
    name: options.name,
    generation,
    release: (): void => {
      if (released) return;
      writeLockFile(root, RuntimeProcessLockFileSchema.parse({
        ...record,
        releasedAt: clock.now().toISOString(),
      }));
      released = true;
    },
  });
  try {
    assertRestoreAdmissionOpen(root);
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
): RecoveryRuntimeLockSnapshot {
  const options = RuntimeLockObservationOptionsSchema.parse(input);
  const root = resolve(options.processLockRoot);
  const processLocks: Record<string, unknown> = {};
  let runtimeGeneration = 0;
  for (const name of RUNTIME_PROCESS_LOCK_NAMES) {
    if (name === "workers") {
      const legacy = readRuntimeProcessLock(root, "workers");
      const records = readWorkerProcessLocks(root);
      const generation = (legacy?.generation ?? 1) + records.length;
      runtimeGeneration += generation;
      const activePids: number[] = [];
      if (legacy !== undefined && legacy.releasedAt === null && observePid(legacy.pid).state === "alive") {
        activePids.push(legacy.pid);
      }
      for (const record of records) {
        if (record.releasedAt === null && observePid(record.pid).state === "alive") {
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
    const held = readRuntimeProcessLock(root, name);
    if (held === undefined) {
      processLocks[name] = { state: "stopped", generation: 1 };
      runtimeGeneration += 1;
      continue;
    }
    runtimeGeneration += held.generation;
    if (held.releasedAt !== null) {
      processLocks[name] = { state: "stopped", generation: held.generation };
      continue;
    }
    const observation = observePid(held.pid);
    processLocks[name] = observation.state === "alive"
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
