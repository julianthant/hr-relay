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
 * ## One file per role, composed at observation time
 *
 * Each long-lived process (`server`, `workers`) owns ITS OWN lock file and
 * writes only that one. The snapshot the stop-proof store records is COMPOSED
 * from both files at the moment an operator asks to restore. That is
 * deliberate: a single shared snapshot file would need a read-modify-write
 * from two processes, and a lost update there would report a running server as
 * stopped — which is exactly the state the interlock exists to refuse.
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
 * `runtimeGeneration` is the sum of the two lock generations. Both start at 1
 * and advance on every acquire, so the sum strictly increases whenever either
 * process restarts — which is what makes a proof issued before a restart stop
 * matching the runtime it was issued against.
 */
import { randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
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
import { FingerprintSchema, IsoInstantSchema, PositiveIntSchema } from "../../domain/ids.js";
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

export const RuntimeProcessLockOptionsSchema = z.strictObject({
  processLockRoot: z.string().min(1),
  name: RuntimeProcessLockNameSchema,
  pid: PositiveIntSchema,
});

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
  return RuntimeProcessLockFileSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}

/**
 * Take this process's role lock, refusing loudly when a LIVE process already
 * holds it. Two dashboards or two worker supervisors over one authority
 * database is the failure `config/runtime-isolation.json` has always named and
 * nothing has ever prevented.
 */
export function acquireRuntimeProcessLock(
  input: unknown,
  clock: Clock = systemClock,
): RuntimeProcessLockHandle {
  const options = RuntimeProcessLockOptionsSchema.parse(input);
  const root = resolve(options.processLockRoot);
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
  return Object.freeze({
    name: options.name,
    generation,
    release: (): void => {
      if (released) return;
      released = true;
      writeLockFile(root, RuntimeProcessLockFileSchema.parse({
        ...record,
        releasedAt: clock.now().toISOString(),
      }));
    },
  });
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
