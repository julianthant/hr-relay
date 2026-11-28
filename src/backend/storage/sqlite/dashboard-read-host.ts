import { DatabaseSync } from "node:sqlite";
import { isMainThread, parentPort, Worker, workerData, type MessagePort } from "node:worker_threads";
import { z } from "zod";
import type { AuthorityTableName } from "../../../models/config/authority.js";
import { workerBootstrapEnvironment } from "../../../models/config/secrets.js";
import { systemClock, type Clock } from "../../../rules/time/clock.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { requireRuntimeAdmission } from "../admission/admission-identity.js";
import type { RuntimeAdmission } from "../admission/admission.js";
import { withOperationProof } from "../configuration/credential-safe-file.js";
import { fileStatus, sameDirectory } from "../file-identity.js";
import { existingDatabaseLocation } from "./authority-connection.js";
import { AuthoritySnapshotChangedError } from "./authority-errors.js";
import type { AuthorityDatabase } from "./authority-database.js";
import { workerExecArgv } from "./backup-inspection-worker.js";
import { admitReadLane, openReadLane, prepareReadLaneStart, ReadLaneNameSchema, readLaneSourceIdentity, type ReadLaneName, type ReadLaneStart } from "./read-lane-admission.js";


const LANE_BUSY_TIMEOUT_MS = 250;
const LANE_TRANSACTION_EXIT_CODE = 70;
const LANE_FAILURE_EXIT_CODE = 71;
const LANE_RESTART_LIMIT = 3;
export const WAL_CHECKPOINT_DEFAULTS: Readonly<{ thresholdBytes: number; minRetryMs: number; maxRetryMs: number }> = Object.freeze({ thresholdBytes: 4 * 1024 * 1024, minRetryMs: 250, maxRetryMs: 2_000 });

export const ReadPositionSchema = z.strictObject({
  source: z.string().min(1),
  schemaVersion: z.number().int().positive(),
  schemaCookie: z.number().int(),
  authorityGeneration: z.number().int().nonnegative(),
  changeLogSeq: z.number().int().nonnegative(),
  timelineThrough: z.number().int().nonnegative().nullable(),
  processRevision: z.number().int().nonnegative().nullable(),
  validUntil: z.number().int().nullable(),
});
/** Where a lane built a body: the store, its change log and the process facts it was given. */
export type ReadPosition = z.infer<typeof ReadPositionSchema>;

export interface LaneReadContext {
  readonly start: ReadLaneStart;
  /** The lane's native read-only connection; it validates peer commits for history. */
  readonly native: AuthorityDatabase;
  /** Both histories when the host admitted an archive, otherwise native itself. The read runs inside its snapshot. */
  readonly history: AuthorityDatabase;
  readonly nowMs: number;
  readonly processFacts: unknown;
  /** A read that builds its body in its own snapshot reports that snapshot's position, which the reply then carries. */
  snapshotAt(position: Readonly<Pick<ReadPosition, "schemaVersion" | "schemaCookie" | "authorityGeneration" | "changeLogSeq">>): void;
  /** Lane-local resources a read keeps between messages: closed with the lane, and checked after every read for an open transaction. */
  retain(resource: Readonly<{ close(): void; inTransaction(): boolean }>): void;
}

/** What a read's warm step sees at lane boot: no request, so no process facts and no position to report. */
export type LaneWarmContext = Pick<LaneReadContext, "start" | "native" | "history" | "nowMs" | "retain">;

export interface LaneReadDefinition<Args, Result> {
  readonly id: string;
  readonly module: string;
  readonly name: string;
  readonly lane: ReadLaneName;
  readonly priority: "interactive" | "background";
  /** A cached body is reused while the change log proves none of these tables changed; empty disables the cache. */
  readonly tables: readonly AuthorityTableName[];
  readonly timeline: boolean;
  readonly processFacts: boolean;
  readonly cacheMs: number | undefined;
  readonly args: z.ZodType<Args>;
  run(context: LaneReadContext, args: Args): Result;
  /** Runs once in its lane's read snapshot before the lane reports ready; a throw fails the lane's boot. */
  readonly warm: ((context: LaneWarmContext) => void) | undefined;
  /** Runs once after the lane reports ready, before its first read, in its own read snapshot; a refusal of that snapshot or a throw only skips it. */
  readonly prebuild: ((context: LaneWarmContext) => void) | undefined;
  /** per-statement (the default) proves the store's source on every statement; per-read, once at the snapshot and once before the result. */
  readonly sourceProof: "per-statement" | "per-read";
}

const definitions = new Map<string, LaneReadDefinition<unknown, unknown>>();
const laneReadId = (module: string, name: string) => `${module}#${name}`;

/** Declares a read a lane can run. The lane entry module imports every defining module, so the lane knows the read by id. */
export function defineLaneRead<Args, Result>(module: string, name: string, spec: Readonly<{
  lane: ReadLaneName; priority: "interactive" | "background"; args: z.ZodType<Args>; tables?: readonly AuthorityTableName[];
  timeline?: boolean; processFacts?: boolean; cacheMs?: number; run(context: LaneReadContext, args: Args): Result;
  warm?(context: LaneWarmContext): void; prebuild?(context: LaneWarmContext): void; sourceProof?: "per-statement" | "per-read";
}>): LaneReadDefinition<Args, Result> {
  const id = laneReadId(module, name);
  if (definitions.has(id)) throw new Error(`read-lane-read-duplicate: ${name}`);
  const definition: LaneReadDefinition<Args, Result> = Object.freeze({ id, module, name, lane: spec.lane, priority: spec.priority,
    tables: Object.freeze([...spec.tables ?? []]), timeline: spec.timeline ?? false, processFacts: spec.processFacts ?? false,
    cacheMs: spec.cacheMs, args: spec.args, run: spec.run, warm: spec.warm, prebuild: spec.prebuild,
    sourceProof: spec.sourceProof ?? "per-statement" });
  definitions.set(id, definition);
  return definition;
}

export class ReadSupersededError extends Error {
  readonly code = "READ_SUPERSEDED";
  constructor() { super("read-superseded"); this.name = "ReadSupersededError"; }
}
/**
 * A host that could not start every lane. The lanes it did start are terminating and still hold the store they read:
 * the caller's unwind awaits exited before it closes that store.
 */
export class ReadLaneStartError extends Error {
  constructor(cause: unknown, readonly exited: Promise<void>) {
    super(cause instanceof Error ? cause.message : "read-lane-start-failed", { cause });
    this.name = "ReadLaneStartError";
  }
}

export class ReadLaneRestartedError extends Error {
  readonly code = "READ_LANE_RESTARTED";
  constructor(cause?: unknown) { super("read-lane-restarted", { cause }); this.name = "ReadLaneRestartedError"; }
}
export class ReadLaneClosedError extends Error {
  readonly code = "read-lane-closed";
  constructor() { super("read-lane-closed"); this.name = "ReadLaneClosedError"; }
}
/** The lane's own refusal; the message is the read's error message. */
export class ReadLaneReadError extends Error {
  constructor(message: string) { super(message); this.name = "ReadLaneReadError"; }
}

const LANE_COUNT = ReadLaneNameSchema.options.length;
/** The gate the host and every lane share: a checkpoint flag and one reading flag per lane, so a checkpoint pauses the other lanes itself. */
const GATE_FLAG = 0;
const GATE_LENGTH = 1 + LANE_COUNT;
const laneIndex = (name: ReadLaneName) => ReadLaneNameSchema.options.indexOf(name);
const readingAt = (lane: number) => 1 + lane;

const RequestSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("read"), id: z.number().int().positive(), beginSeq: z.number().int().nonnegative(), module: z.string().min(1), name: z.string().min(1), key: z.string().min(1), args: z.unknown(),
    nowMs: z.number().int(), processRevision: z.number().int().nonnegative().nullable(), processFacts: z.unknown() }),
  z.strictObject({ kind: z.literal("cancel"), id: z.number().int().positive() }),
  z.strictObject({ kind: z.literal("checkpoint"), id: z.number().int().positive() }),
  z.strictObject({ kind: z.literal("close") }),
]);
type LaneRequest = z.infer<typeof RequestSchema>;
type LaneReadMessage = Extract<LaneRequest, { kind: "read" }>;
/** clock: "system" when the host runs on the system clock, so the lane reads the time itself as a snapshot starts; "host" keeps the host's clock sample from the post. */
const LaneDataSchema = z.strictObject({ start: z.unknown(), gate: z.instanceof(Int32Array), clock: z.enum(["system", "host"]) });
const CheckpointRowSchema = z.strictObject({ busy: z.number().int(), log: z.number().int(), checkpointed: z.number().int() });
/** When the lane started and finished the checkpoint, on the wall clock both threads share. */
const CheckpointSpanSchema = z.strictObject({ startedAtMs: z.number(), finishedAtMs: z.number() });
const ReadIdsSchema = z.array(z.number().int().positive()).min(1);
const ReplySchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("ready") }),
  z.strictObject({ kind: z.literal("read"), ids: ReadIdsSchema, body: z.string(), position: ReadPositionSchema, cached: z.boolean(),
    beginSeq: z.number().int().nonnegative() }),
  z.strictObject({ kind: z.literal("read-failed"), ids: ReadIdsSchema, message: z.string().min(1),
    code: z.literal("STORAGE_SNAPSHOT_CHANGED").optional() }),
  z.strictObject({ kind: z.literal("cancelled"), id: z.number().int().positive() }),
  z.strictObject({ kind: z.literal("checkpoint"), id: z.number().int().positive(), ...CheckpointRowSchema.shape, ...CheckpointSpanSchema.shape }),
  z.strictObject({ kind: z.literal("checkpoint-failed"), id: z.number().int().positive(), message: z.string().min(1) }),
]);
type LaneReply = z.infer<typeof ReplySchema>;

export interface DashboardReadReply {
  readonly body: string;
  readonly position: ReadPosition;
  readonly cached: boolean;
  /** The latest dispatch sequence among the messages this body answered; the lane validated or built it after all of them. */
  readonly beginSeq: number;
}

export interface DashboardReadOptions {
  /** Latest-wins identity: a newer read in the same slot settles the older one with read-superseded. */
  readonly slot?: Readonly<{ subscriberId: string; slot: string }>;
  readonly processFacts?: Readonly<{ revision: number; facts: unknown }>;
  readonly signal?: AbortSignal;
}

export interface WalCheckpointAttempt {
  readonly atMs: number;
  readonly busy: number;
  /** Frames in the WAL, and frames copied: a busy TRUNCATE can still copy frames passively. */
  readonly log: number;
  readonly checkpointed: number;
  readonly walBytesAfter: number;
  /** When the navigation lane ran the checkpoint, in wall-clock milliseconds. */
  readonly startedAtMs: number;
  readonly finishedAtMs: number;
}

export interface DashboardReadLanes {
  /** Settles when every lane has opened once; reads queue until their lane is ready. */
  readonly ready: Promise<void>;
  read<Args>(definition: LaneReadDefinition<Args, unknown>, args: Args, options?: DashboardReadOptions): Promise<DashboardReadReply>;
  /** bootMs: each lane start, first or restart, from creating its worker to its ready reply. */
  status(): Readonly<{ walPeakBytes: number; checkpoints: readonly WalCheckpointAttempt[]; restarts: number; retryPending: boolean; bootMs: readonly number[] }>;
  close(): Promise<void>;
}

/** One waiter's read: held on the host while its lane boots, then in flight in the lane until its reply. */
interface LaneReadRequest {
  readonly id: number;
  readonly dispatchSeq: number;
  readonly lane: Lane;
  readonly key: string;
  readonly definition: LaneReadDefinition<unknown, unknown>;
  readonly args: unknown;
  readonly processRevision: number | null;
  readonly processFacts: unknown;
  readonly slot: string | undefined;
  readonly settle: PromiseWithResolvers<DashboardReadReply>;
  readonly release: () => void;
  waiting: boolean;
  /** The dispatch sequence its lane message carried; a body built before it never answers this waiter. */
  postedSeq: number | undefined;
}

interface Lane {
  readonly name: ReadLaneName;
  readonly index: number;
  worker: Worker | undefined;
  ready: boolean;
  readonly held: LaneReadRequest[];
  readonly sent: Map<number, LaneReadRequest>;
  checkpoint: number | undefined;
  consecutiveFailures: number;
  failure: Error | undefined;
  exited: Promise<void>;
}

/**
 * The main thread's side of the read lanes: waiters with latest-wins slots, posting reads to their lane as soon as it can
 * take them, lane restarts, and the WAL checkpoint window. Each lane orders its own messages (checkpoint, then interactive,
 * then background), so no handoff between two lane messages waits on the main thread. The main thread runs no SQLite for a
 * lane read.
 */
export function createDashboardReadHost(input: Readonly<{ admission: RuntimeAdmission; database: AuthorityDatabase; clock: Clock;
  /** The workers to start; a read whose lane has no worker runs on navigation (shape A). Both lanes by default (shape B). */
  lanes?: readonly ReadLaneName[]; checkpoint?: Partial<typeof WAL_CHECKPOINT_DEFAULTS>;
  /** The module each lane worker runs: it imports its read modules and calls runReadLaneWorker. Relay's lane entry by default. */
  entry?: URL;
  /** staggered (the default) boots the other lanes once navigation is first ready, so lane boots never compete for CPU. */
  start?: "staggered" | "parallel" }>): DashboardReadLanes {
  const owner = requireRuntimeAdmission(input.admission);
  const { database, clock } = input;
  const policy = { ...WAL_CHECKPOINT_DEFAULTS, ...input.checkpoint };
  const entry = input.entry ?? new URL("./dashboard-read-lane.js", import.meta.url);
  const names = [...new Set(input.lanes ?? ReadLaneNameSchema.options)];
  const starts = new Map(names.map(name => [name, prepareReadLaneStart(owner, database, name)] as const));
  const navigationStart = starts.get("navigation");
  if (navigationStart === undefined) throw new Error("read-lane-navigation-required");
  const walPath = `${navigationStart.path}-wal`;
  const gate = new Int32Array(new SharedArrayBuffer(GATE_LENGTH * Int32Array.BYTES_PER_ELEMENT));
  const slots = new Map<string, LaneReadRequest>();
  const lanes = new Map<ReadLaneName, Lane>();
  const checkpoints: WalCheckpointAttempt[] = [];
  let dispatchSeq = 0, messageId = 0, restarts = 0, walPeakBytes = 0;
  const bootMs: number[] = [];
  let closing = false, checkpointing = false;
  let retryTimer: ReturnType<typeof setTimeout> | undefined, retryDelayMs = policy.minRetryMs;
  const readyWaits: Promise<void>[] = [];
  let releaseCustody: (() => void) | undefined, walWatch: ReturnType<typeof setInterval> | undefined;
  const deferred = new Map<Lane, PromiseWithResolvers<void>>();

  const admit = (start: ReadLaneStart) => withOperationProof(() => {
    owner.assertProfileRuntime();
    owner.assertReadOnlyAuthorityDatabase(start.path);
    if (!sameDirectory(readLaneSourceIdentity(start.path), start.identity)) throw new Error("profile-database-open-source-changed");
  });
  const walBytes = () => {
    const size = Number(fileStatus(walPath, true)?.size ?? 0);
    walPeakBytes = Math.max(walPeakBytes, size);
    return size;
  };

  const settleRequest = (request: LaneReadRequest, outcome: { reply: DashboardReadReply } | { error: Error }) => {
    if (!request.waiting) return;
    request.waiting = false;
    if (request.slot !== undefined && slots.get(request.slot) === request) slots.delete(request.slot);
    request.release();
    if ("reply" in outcome) request.settle.resolve(outcome.reply);
    else request.settle.reject(outcome.error);
  };
  /** A waiter detaches by itself: a held read is dropped, a queued lane message is cancelled, a started one only fills the lane's cache. */
  const detach = (request: LaneReadRequest, error: Error) => {
    if (!request.waiting) return;
    settleRequest(request, { error });
    const { lane } = request;
    const held = lane.held.indexOf(request);
    if (held !== -1) lane.held.splice(held, 1);
    else if (lane.sent.has(request.id)) {
      const message: LaneRequest = { kind: "cancel", id: request.id };
      lane.worker?.postMessage(message);
    }
  };
  const laneOf = (definition: LaneReadDefinition<unknown, unknown>): Lane => {
    const lane = lanes.get(definition.lane) ?? lanes.get("navigation");
    if (lane === undefined) throw new Error("read-lane-unrouted");
    return lane;
  };

  const canPost = (lane: Lane) => !closing && lane.ready && lane.worker !== undefined;
  /** An unsendable request never reaches the lane: only its own waiter fails, and the lane keeps serving. */
  const post = (lane: Lane, request: LaneReadRequest) => {
    if (lane.worker === undefined) throw new Error("read-lane-post-unready");
    const message: LaneRequest = { kind: "read", id: request.id, beginSeq: dispatchSeq, module: request.definition.module,
      name: request.definition.name, key: request.key, args: request.args, nowMs: clock.nowMs(), processRevision: request.processRevision,
      processFacts: request.processFacts };
    try { lane.worker.postMessage(message); }
    catch (error) {
      settleRequest(request, { error: error instanceof Error ? error : new Error("read-lane-send-failed", { cause: error }) });
      return;
    }
    request.postedSeq = message.beginSeq;
    lane.sent.set(request.id, request);
  };
  /** Reads held while the lane booted go out interactive first, in arrival order within each class. */
  const flush = (lane: Lane) => {
    const held = lane.held.splice(0);
    for (const request of [...held.filter(request => request.definition.priority === "interactive"),
      ...held.filter(request => request.definition.priority !== "interactive")]) post(lane, request);
  };

  const beginCheckpoint = () => {
    if (checkpointing || closing) return;
    const lane = lanes.get("navigation");
    if (lane?.worker === undefined || !lane.ready) { scheduleRetry(); return; }
    checkpointing = true;
    const id = ++messageId;
    const message: LaneRequest = { kind: "checkpoint", id };
    try { lane.worker.postMessage(message); }
    catch { finishCheckpoint(undefined); return; }
    lane.checkpoint = id;
  };
  /** One pending retry on a host timer, spaced by a bounded backoff, until the WAL resets or the host closes. */
  function scheduleRetry() {
    if (closing || retryTimer !== undefined) return;
    retryTimer = setTimeout(() => {
      retryTimer = undefined;
      if (closing) return;
      if (walBytes() === 0) { retryDelayMs = policy.minRetryMs; return; }
      beginCheckpoint();
    }, retryDelayMs);
    retryTimer.unref();
    retryDelayMs = Math.min(retryDelayMs * 2, policy.maxRetryMs);
  }
  const observeWal = () => {
    if (!checkpointing && retryTimer === undefined && walBytes() > policy.thresholdBytes) beginCheckpoint();
  };
  function finishCheckpoint(row: (z.infer<typeof CheckpointRowSchema> & z.infer<typeof CheckpointSpanSchema>) | undefined) {
    checkpointing = false;
    const after = walBytes();
    if (row !== undefined) checkpoints.push(Object.freeze({ atMs: clock.nowMs(), ...row, walBytesAfter: after }));
    if (row === undefined || row.busy !== 0 || after > 0) scheduleRetry();
    else retryDelayMs = policy.minRetryMs;
  }

  /** The navigation lane checkpoints for the writer; with no automatic checkpoints, a watch checks the WAL between reads. */
  const takeCheckpointCustody = () => {
    if (releaseCustody !== undefined || closing) return;
    releaseCustody = database.holdCheckpointCustody();
    walWatch = setInterval(observeWal, policy.minRetryMs);
    walWatch.unref();
  };
  const returnCheckpointCustody = () => {
    if (walWatch !== undefined) clearInterval(walWatch);
    walWatch = undefined;
    releaseCustody?.();
    releaseCustody = undefined;
  };

  const onReply = (lane: Lane, proveCustody: () => void, message: unknown) => {
    const reply: LaneReply = ReplySchema.parse(message);
    if (reply.kind === "ready") {
      lane.ready = true;
      if (lane.name === "navigation") { takeCheckpointCustody(); startDeferredLanes(); }
      flush(lane);
      return;
    }
    // A mismatched reply changes nothing here, so the restart its exit triggers settles the lane's in-flight waiters.
    if (reply.kind === "checkpoint" || reply.kind === "checkpoint-failed") {
      if (lane.checkpoint !== reply.id) throw new Error("read-lane-reply-unexpected");
      lane.checkpoint = undefined;
      finishCheckpoint(reply.kind === "checkpoint" ? { busy: reply.busy, log: reply.log, checkpointed: reply.checkpointed,
        startedAtMs: reply.startedAtMs, finishedAtMs: reply.finishedAtMs } : undefined);
      return;
    }
    if (reply.kind === "cancelled") {
      const request = lane.sent.get(reply.id);
      if (request === undefined || request.waiting) throw new Error("read-lane-reply-unexpected");
      lane.sent.delete(reply.id);
      return;
    }
    // The whole batch is checked before any waiter settles: one read key and process revision, and for a body, a begin
    // position no earlier than any message it answers.
    const batch = reply.ids.map(id => lane.sent.get(id));
    const [first] = batch;
    if (first === undefined || !batch.every(request => request !== undefined && request.key === first.key
      && request.processRevision === first.processRevision
      && (reply.kind === "read-failed" || (request.postedSeq !== undefined && request.postedSeq <= reply.beginSeq && reply.beginSeq <= dispatchSeq)))
      || (reply.kind === "read" && reply.position.processRevision !== first.processRevision)) throw new Error("read-lane-reply-unexpected");
    lane.consecutiveFailures = 0;
    let outcome: { reply: DashboardReadReply } | { error: Error };
    try {
      proveCustody();
      outcome = reply.kind === "read"
        ? { reply: Object.freeze({ body: reply.body, position: reply.position, cached: reply.cached, beginSeq: reply.beginSeq }) }
        // A typed refusal crosses the lane boundary as its code, so routes and pollers still see the retryable error.
        : { error: reply.code === undefined ? new ReadLaneReadError(reply.message) : new AuthoritySnapshotChangedError() };
    } catch (error) { outcome = { error: error instanceof Error ? error : new Error("read-lane-admission-failed", { cause: error }) }; }
    for (const request of batch) {
      if (request === undefined) continue;
      lane.sent.delete(request.id);
      settleRequest(request, outcome);
    }
    observeWal();
  };

  function startDeferredLanes() {
    for (const [lane, started] of deferred) {
      deferred.delete(lane);
      if (closing) { started.reject(new ReadLaneClosedError()); continue; }
      try { started.resolve(launch(lane)); }
      catch (error) { failDeferredLane(lane, started, error); }
    }
  }
  function failDeferredLane(lane: Lane, started: PromiseWithResolvers<void>, error: unknown) {
    const failure = error instanceof Error ? error : new Error("read-lane-start-failed", { cause: error });
    failLane(lane, failure);
    started.reject(failure);
  }
  /** A navigation lane that never comes up takes the lanes waiting to boot after it down with it. */
  function failDeferredLanes(failure: Error) {
    for (const [lane, started] of deferred) {
      deferred.delete(lane);
      failLane(lane, failure);
      started.reject(failure);
    }
  }
  const failLane = (lane: Lane, failure: Error) => {
    lane.failure = failure;
    if (lane.name === "navigation") { returnCheckpointCustody(); failDeferredLanes(failure); }
    for (const request of lane.held.splice(0)) settleRequest(request, { error: failure });
  };

  /** An exited lane leaves the gate clear for the others, and every read in flight to it fails. */
  const recoverExited = (lane: Lane, cause: Error) => {
    Atomics.store(gate, readingAt(lane.index), 0);
    Atomics.notify(gate, readingAt(lane.index));
    if (lane.name === "navigation") {
      Atomics.store(gate, GATE_FLAG, 0);
      Atomics.notify(gate, GATE_FLAG);
    }
    if (lane.checkpoint !== undefined) { lane.checkpoint = undefined; finishCheckpoint(undefined); }
    const sent = [...lane.sent.values()];
    lane.sent.clear();
    for (const request of sent) settleRequest(request, { error: closing ? new ReadLaneClosedError() : new ReadLaneRestartedError(cause) });
  };

  const launch = (lane: Lane) => {
    const start = prepareReadLaneStart(owner, database, lane.name);
    const original = starts.get(lane.name);
    if (original === undefined || !sameDirectory(original.identity, start.identity)) throw new Error("profile-database-open-source-changed");
    let custodyUnchanged: (() => boolean) | undefined;
    const proveCustody = () => {
      const previous = custodyUnchanged;
      custodyUnchanged = undefined;
      if (previous?.()) { custodyUnchanged = previous; return; }
      const unchanged = owner.observeDashboardReadCustody(start.path);
      admit(start);
      if (unchanged?.()) custodyUnchanged = unchanged;
    };
    const releaseSource = database.retainDashboardReadSource(owner, start.identity);
    let worker: Worker;
    try {
      worker = new Worker(entry, { name: `relay-dashboard-read-${lane.name}`, workerData: { start, gate, clock: clock === systemClock ? "system" : "host" },
        execArgv: workerExecArgv(), env: workerBootstrapEnvironment() });
    } catch (error) { releaseSource(); throw error; }
    lane.worker = worker;
    lane.ready = false;
    const ready = Promise.withResolvers<void>();
    const bootStartedAt = clock.nowMs();
    let booted = false;
    let failure: Error | undefined;
    worker.on("message", (message: unknown) => {
      // A lane that sent one invalid reply is terminating; nothing it sends after that settles a waiter.
      if (failure !== undefined) return;
      try {
        onReply(lane, proveCustody, message);
        if (lane.ready && !booted) {
          booted = true;
          bootMs.push(clock.nowMs() - bootStartedAt);
          ready.resolve();
        }
      } catch (error) {
        failure ??= error instanceof Error ? error : new Error("read-lane-reply-invalid", { cause: error });
        void worker.terminate();
      }
    });
    worker.on("error", (error: unknown) => { failure ??= error instanceof Error ? error : new Error("read-lane-worker-failed", { cause: error }); });
    worker.on("messageerror", (error: Error) => { failure ??= error; void worker.terminate(); });
    lane.exited = new Promise<void>(resolve => worker.once("exit", code => {
      releaseSource();
      lane.worker = undefined;
      lane.ready = false;
      const cause = failure ?? new Error(`read-lane-exited: ${String(code)}`);
      ready.reject(cause);
      recoverExited(lane, cause);
      resolve();
      if (closing) return;
      lane.consecutiveFailures += 1;
      if (lane.consecutiveFailures > LANE_RESTART_LIMIT) { failLane(lane, cause); return; }
      restarts += 1;
      try { void launch(lane); }
      catch (error) { failLane(lane, error instanceof Error ? error : new Error("read-lane-restart-failed", { cause: error })); }
    }));
    // A restarted lane's readiness has no awaiting caller; its failure reaches waiters through the lane.
    ready.promise.catch(() => {});
    return ready.promise;
  };

  const abandonStart = (error: unknown): never => {
    closing = true;
    for (const lane of lanes.values()) void lane.worker?.terminate();
    throw new ReadLaneStartError(error, Promise.all([...lanes.values()].map(lane => lane.exited)).then(() => undefined));
  };
  try {
    for (const name of names) {
      const lane: Lane = { name, index: laneIndex(name), worker: undefined, ready: false, held: [], sent: new Map(), checkpoint: undefined,
        consecutiveFailures: 0, failure: undefined, exited: Promise.resolve() };
      lanes.set(name, lane);
    }
    const startNow = (lane: Lane) => lane.name === "navigation" || input.start === "parallel";
    for (const lane of lanes.values()) {
      if (startNow(lane)) { readyWaits.push(launch(lane)); continue; }
      const started = Promise.withResolvers<void>();
      deferred.set(lane, started);
      readyWaits.push(started.promise);
    }
  } catch (error) { abandonStart(error); }

  const ready = Promise.all(readyWaits).then(() => undefined);
  // A lane that never boots fails its reads through lane.failure; ready only reports it to a caller that awaits it.
  ready.catch(() => {});
  return Object.freeze({
    ready,
    read<Args>(definition: LaneReadDefinition<Args, unknown>, args: Args, options: DashboardReadOptions = {}): Promise<DashboardReadReply> {
      if (closing) return Promise.reject(new ReadLaneClosedError());
      const registered = definitions.get(definition.id);
      if (registered === undefined) return Promise.reject(new Error("read-lane-read-unknown"));
      const lane = laneOf(registered);
      if (lane.failure !== undefined) return Promise.reject(lane.failure);
      const admitted = registered.args.safeParse(args);
      if (!admitted.success) return Promise.reject(admitted.error);
      const parsed: unknown = admitted.data;
      if (registered.processFacts && options.processFacts === undefined) return Promise.reject(new Error("read-lane-process-facts-required"));
      const processRevision = registered.processFacts ? options.processFacts?.revision ?? null : null;
      const processFacts = registered.processFacts ? options.processFacts?.facts ?? null : null;
      const signal = options.signal;
      const onAbort = () => { detach(request, signal?.reason instanceof Error ? signal.reason : new Error("read-aborted")); };
      const request: LaneReadRequest = { id: ++messageId, dispatchSeq: ++dispatchSeq, lane, definition: registered, args: parsed,
        key: canonicalJsonStringify({ lane: lane.name, read: registered.id, args: parsed }), processRevision, processFacts,
        slot: options.slot === undefined ? undefined : canonicalJsonStringify(options.slot), settle: Promise.withResolvers(),
        release: () => signal?.removeEventListener("abort", onAbort), waiting: true, postedSeq: undefined };
      if (signal?.aborted === true) { onAbort(); return request.settle.promise; }
      signal?.addEventListener("abort", onAbort, { once: true });
      if (request.slot !== undefined) {
        const previous = slots.get(request.slot);
        slots.set(request.slot, request);
        if (previous !== undefined) detach(previous, new ReadSupersededError());
      }
      observeWal();
      if (canPost(lane)) post(lane, request);
      else lane.held.push(request);
      return request.settle.promise;
    },
    status: () => Object.freeze({ walPeakBytes, checkpoints: Object.freeze([...checkpoints]), restarts, retryPending: retryTimer !== undefined,
      bootMs: Object.freeze([...bootMs]) }),
    async close(): Promise<void> {
      if (!closing) {
        closing = true;
        returnCheckpointCustody();
        for (const started of deferred.values()) started.reject(new ReadLaneClosedError());
        deferred.clear();
        if (retryTimer !== undefined) clearTimeout(retryTimer);
        retryTimer = undefined;
        for (const lane of lanes.values()) {
          for (const request of lane.held.splice(0)) settleRequest(request, { error: new ReadLaneClosedError() });
          const worker = lane.worker;
          if (worker === undefined) continue;
          // An idle lane closes its connections itself; a lane still booting or with messages in flight is terminated rather than awaited.
          if (lane.ready && lane.sent.size === 0 && lane.checkpoint === undefined) {
            const message: LaneRequest = { kind: "close" };
            worker.postMessage(message);
          } else void worker.terminate();
        }
      }
      await Promise.all([...lanes.values()].map(lane => lane.exited));
    },
  });
}

/** The lane loads no module on request: a read its entry did not import is unknown. */
function resolveLaneRead(module: string, name: string): LaneReadDefinition<unknown, unknown> {
  const known = definitions.get(laneReadId(module, name));
  if (known === undefined) throw new Error("read-lane-read-unknown");
  return known;
}

interface CacheEntry {
  readonly body: string;
  position: ReadPosition;
  beginSeq: number;
}

interface QueuedRead {
  readonly message: LaneReadMessage;
  readonly definition: LaneReadDefinition<unknown, unknown>;
}

function runReadLane(port: MessagePort, data: unknown) {
  const { start: record, gate, clock } = LaneDataSchema.parse(data);
  const lane = admitReadLane(record);
  const { start } = lane;
  if (gate.length !== GATE_LENGTH || !(gate.buffer instanceof SharedArrayBuffer)) throw new Error("read-lane-gate-invalid");
  const self = laneIndex(start.lane);
  const { native, history } = openReadLane(lane, LANE_BUSY_TIMEOUT_MS);
  const resources: Readonly<{ close(): void; inTransaction(): boolean }>[] = [];
  let checkpoint: DatabaseSync | undefined;
  try {
    if (start.checkpoint) {
      // Checkpoint-only: read-write so it may checkpoint, query_only so it never writes, and it never begins a transaction.
      lane.admission.assertCheckpointOnlyDatabase(start.path);
      checkpoint = new DatabaseSync(existingDatabaseLocation(start.path), { timeout: 0, allowExtension: false, defensive: true,
        enableDoubleQuotedStringLiterals: false, readBigInts: false, returnArrays: false });
      checkpoint.exec("PRAGMA query_only=ON; PRAGMA busy_timeout=0");
      lane.assertSource();
    }
  } catch (error) { checkpoint?.close(); native.close(); throw error; }
  const source = [start.identity, start.historyArchive?.identity].filter(identity => identity !== undefined)
    .map(identity => `${identity.device}:${identity.inode}`).join("+") + `@${String(start.cursorOffset)}`;
  const cache = new Map<string, CacheEntry>();
  const checkpoints: number[] = [];
  const interactive: QueuedRead[] = [], background: QueuedRead[] = [];
  let scheduled = false, closed = false, gateWait = false, waitingForReaders = false;
  const leftInTransaction = () => native.hasOpenTransaction() || history.hasOpenTransaction() || resources.some(resource => resource.inTransaction());
  const close = () => {
    closed = true;
    for (const resource of resources.splice(0)) resource.close();
    checkpoint?.close();
    native.close();
    port.close();
  };
  const send = (reply: LaneReply) => { port.postMessage(reply); };
  /** Every statement proves the source, unless the read asks for one proof as its snapshot begins and one before its result returns. */
  const proved = <T>(definition: LaneReadDefinition<unknown, unknown>, read: () => T): T => {
    if (definition.sourceProof === "per-read") return lane.withProvedSource(read);
    lane.assertSource();
    return read();
  };

  const serve = (definition: LaneReadDefinition<unknown, unknown>, message: LaneReadMessage) => {
    const args = definition.args.parse(message.args);
    const cached = definition.tables.length === 0 ? undefined : cache.get(message.key);
    return history.withAuthorityReadSnapshot(() => proved(definition, () => {
      // A read that waited in the lane checks expiry at its own snapshot, not at the host's post.
      const nowMs = clock === "system" ? systemClock.nowMs() : message.nowMs;
      const meta = history.getMeta(), change = history.capturedChangeKey();
      const timelineThrough = definition.timeline ? history.authority.timelineEvents.highWaterMark() : null;
      const base = { source, schemaVersion: meta.schemaVersion, schemaCookie: change.schemaCookie, authorityGeneration: meta.authorityGeneration };
      if (cached !== undefined) {
        const held = cached.position;
        // Every authority commit moves the generation, so the proved change-log interval, not the generation, decides reuse.
        const reusable = held.source === base.source && held.schemaVersion === base.schemaVersion && held.schemaCookie === base.schemaCookie
          && (held.validUntil === null || nowMs < held.validUntil)
          && held.processRevision === message.processRevision && held.timelineThrough === timelineThrough
          && history.readChangeInterval(held.changeLogSeq, definition.tables).clear;
        if (reusable) {
          cached.position = { ...held, authorityGeneration: base.authorityGeneration, changeLogSeq: change.changeLogSeq };
          cached.beginSeq = message.beginSeq;
          return { body: cached.body, position: cached.position, cached: true, beginSeq: cached.beginSeq };
        }
      }
      let own: Parameters<LaneReadContext["snapshotAt"]>[0] | undefined;
      const context: LaneReadContext = { start, native, history, nowMs, processFacts: message.processFacts,
        snapshotAt: position => { own = { schemaVersion: position.schemaVersion, schemaCookie: position.schemaCookie,
          authorityGeneration: position.authorityGeneration, changeLogSeq: position.changeLogSeq }; },
        retain: resource => { resources.push(resource); } };
      const body = JSON.stringify(definition.run(context, args));
      const position: ReadPosition = { ...base, changeLogSeq: change.changeLogSeq, ...own, timelineThrough,
        processRevision: message.processRevision, validUntil: definition.cacheMs === undefined ? null : nowMs + definition.cacheMs };
      if (definition.tables.length > 0) cache.set(message.key, { body, position, beginSeq: message.beginSeq });
      return { body, position, cached: false, beginSeq: message.beginSeq };
    }));
  };

  /** A lane marks itself reading before it picks a read, then respects any other lane's checkpoint reservation. */
  const tryEnterRead = () => {
    Atomics.store(gate, readingAt(self), 1);
    if (Atomics.load(gate, GATE_FLAG) === 0 || checkpoints.length > 0) return true;
    Atomics.store(gate, readingAt(self), 0);
    Atomics.notify(gate, readingAt(self));
    return false;
  };
  /** The lane waits for the gate without blocking, so cancels and new messages still reach its queues before it picks. */
  const waitForGate = () => {
    gateWait = true;
    const resume = () => { gateWait = false; schedule(); };
    const wait = Atomics.waitAsync(gate, GATE_FLAG, 1);
    if (wait.async) void wait.value.then(resume);
    else resume();
  };
  const leaveRead = () => {
    Atomics.store(gate, readingAt(self), 0);
    Atomics.notify(gate, readingAt(self));
  };

  /** Reserve the other lanes' next read boundary while navigation keeps serving its own reads. */
  const reserveCheckpoint = () => {
    if (waitingForReaders) return false;
    Atomics.store(gate, GATE_FLAG, 1);
    for (let other = 0; other < LANE_COUNT; other++) {
      if (other === self) continue;
      const wait = Atomics.waitAsync(gate, readingAt(other), 1);
      if (!wait.async) continue;
      waitingForReaders = true;
      void wait.value.then(() => { waitingForReaders = false; schedule(); });
      return false;
    }
    return true;
  };

  const runCheckpoint = (id: number): LaneReply => {
    const startedAtMs = systemClock.nowMs();
    try {
      if (checkpoint === undefined) throw new Error("read-lane-checkpoint-unowned");
      lane.assertSource();
      const row = CheckpointRowSchema.parse(checkpoint.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get());
      return { kind: "checkpoint", id, ...row, startedAtMs, finishedAtMs: systemClock.nowMs() };
    } catch (error) {
      return { kind: "checkpoint-failed", id, message: error instanceof Error ? error.message : "read-lane-checkpoint-failed" };
    } finally {
      Atomics.store(gate, GATE_FLAG, 0);
      Atomics.notify(gate, GATE_FLAG);
    }
  };

  /**
   * Runs the next read, under the lane's reading mark, with every queued twin of it: same key and process revision. None of them had started, so one run
   * after all of their dispatches answers each. The latest message carries the run's clock and begin position.
   */
  const runRead = (picked: QueuedRead) => {
    const queue = picked.definition.priority === "interactive" ? interactive : background;
    const twins = [picked];
    for (let index = 0; index < queue.length;) {
      const queued = queue[index];
      if (queued.message.key === picked.message.key && queued.message.processRevision === picked.message.processRevision) {
        twins.push(queued);
        queue.splice(index, 1);
      } else index += 1;
    }
    const ids = twins.map(twin => twin.message.id);
    const latest = twins.reduce((last, twin) => twin.message.beginSeq > last.message.beginSeq ? twin : last).message;
    let reply: LaneReply;
    try { reply = { kind: "read", ids, ...serve(picked.definition, latest) }; }
    catch (error) {
      reply = { kind: "read-failed", ids, message: error instanceof Error && error.message !== "" ? error.message : "read-lane-read-failed",
        ...(error instanceof AuthoritySnapshotChangedError ? { code: error.code } : {}) };
    }
    // A failed rollback leaves a transaction that would pin the WAL: exit, which releases the mark, and let the host restart the lane.
    if (leftInTransaction()) process.exit(LANE_TRANSACTION_EXIT_CODE);
    send(reply);
    leaveRead();
  };

  const accept = (input: unknown) => {
    const message = RequestSchema.parse(input);
    if (message.kind === "close") { close(); return; }
    if (message.kind === "checkpoint") {
      if (checkpoint === undefined) throw new Error("read-lane-checkpoint-unowned");
      checkpoints.push(message.id);
      return;
    }
    if (message.kind === "cancel") {
      // A message that already started is not in a queue: its reply answers the host instead.
      for (const queue of [interactive, background]) {
        const index = queue.findIndex(queued => queued.message.id === message.id);
        if (index === -1) continue;
        queue.splice(index, 1);
        send({ kind: "cancelled", id: message.id });
        return;
      }
      return;
    }
    let definition: LaneReadDefinition<unknown, unknown>;
    try { definition = resolveLaneRead(message.module, message.name); }
    catch (error) {
      send({ kind: "read-failed", ids: [message.id], message: error instanceof Error ? error.message : "read-lane-read-unknown" });
      return;
    }
    (definition.priority === "interactive" ? interactive : background).push({ message, definition });
  };
  /** The lane takes its own next message: a checkpoint, then interactive reads, then background ones. */
  const step = () => {
    scheduled = false;
    if (closed) return;
    const id = checkpoints[0];
    if (id !== undefined && reserveCheckpoint()) {
      checkpoints.shift();
      send(runCheckpoint(id));
    } else if (interactive.length + background.length > 0) {
      if (!tryEnterRead()) { waitForGate(); return; }
      // Pick only after admitting the read, so a gated read stays queued and cancelable.
      const picked = interactive.shift() ?? background.shift();
      if (picked !== undefined) runRead(picked);
    }
    schedule();
  };
  // One event-loop turn between messages lets every message that arrived during a read join the queues before the next pick.
  function schedule() {
    const checkpointReady = checkpoints.length > 0 && !waitingForReaders;
    if (scheduled || closed || gateWait || (!checkpointReady && interactive.length + background.length === 0)) return;
    scheduled = true;
    setImmediate(() => {
      // A failed send or close leaves the lane in an unknown state; the host restarts it from its exit.
      try { step(); } catch { process.exit(LANE_FAILURE_EXIT_CODE); }
    });
  }
  port.on("message", (input: unknown) => {
    // A malformed request leaves the lane in an unknown state; the host restarts it from its exit.
    try { accept(input); } catch { process.exit(LANE_FAILURE_EXIT_CODE); }
    schedule();
  });
  // A read that keeps lane state builds it before ready, so no request waits on it; a failed warm exits through the host's restart.
  const warmContext = (): LaneWarmContext => ({ start, native, history, nowMs: systemClock.nowMs(), retain: resource => { resources.push(resource); } });
  const laneDefinitions = [...definitions.values()].filter(definition => definition.lane === start.lane);
  try {
    for (const definition of laneDefinitions) {
      const warm = definition.warm;
      if (warm !== undefined) history.withAuthorityReadSnapshot(() => proved(definition, () => { warm(warmContext()); }));
    }
  } catch (error) { close(); throw error; }
  if (leftInTransaction()) process.exit(LANE_TRANSACTION_EXIT_CODE);
  send({ kind: "ready" });
  // Ready waits only for the warm steps. The optional prebuilds run in this turn, so before any read is accepted.
  for (const definition of laneDefinitions) {
    const prebuild = definition.prebuild;
    if (prebuild === undefined) continue;
    try {
      history.withAuthorityReadSnapshot(() => proved(definition, () => { prebuild(warmContext()); }));
    } catch { /* optional: the read that follows builds its own */ }
  }
  if (leftInTransaction()) process.exit(LANE_TRANSACTION_EXIT_CODE);
}

/** A lane entry calls this after importing its read modules; on the main thread it does nothing. */
export function runReadLaneWorker(): void {
  // Admission, not this guard, refuses a start record with the wrong protocol, so the worker fails by name.
  if (!isMainThread && parentPort !== null) runReadLane(parentPort, workerData);
}
