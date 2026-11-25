import { DatabaseSync } from "node:sqlite";
import { isMainThread, parentPort, Worker, workerData, type MessagePort } from "node:worker_threads";
import { z } from "zod";
import type { AuthorityTableName } from "../../../models/config/authority.js";
import { workerBootstrapEnvironment } from "../../../models/config/secrets.js";
import type { Clock } from "../../../rules/time/clock.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { requireRuntimeAdmission } from "../admission/admission-identity.js";
import type { RuntimeAdmission } from "../admission/admission.js";
import { fileStatus, sameDirectory } from "../file-identity.js";
import { existingDatabaseLocation } from "./authority-connection.js";
import type { AuthorityDatabase } from "./authority-database.js";
import { workerExecArgv } from "./backup-inspection-worker.js";
import { admitReadLane, openReadLane, prepareReadLaneStart, READ_LANE_PROTOCOL, readLaneSourceIdentity, type ReadLaneName, type ReadLaneStart } from "./read-lane-admission.js";

/** Which worker serves each logical lane. Shape B runs both; shape A maps search to navigation. */
const LANE_ROUTES: Readonly<Record<ReadLaneName, ReadLaneName>> = Object.freeze({ navigation: "navigation", search: "search" });

const LANE_BUSY_TIMEOUT_MS = 250;
const LANE_TRANSACTION_EXIT_CODE = 70;
const LANE_FAILURE_EXIT_CODE = 71;
const LANE_RESTART_LIMIT = 3;
export const WAL_CHECKPOINT_DEFAULTS = Object.freeze({ thresholdBytes: 4 * 1024 * 1024, minRetryMs: 250, maxRetryMs: 2_000 });

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
  /** Lane-local resources a read keeps between messages: closed with the lane, and checked after every read for an open transaction. */
  retain(resource: Readonly<{ close(): void; inTransaction(): boolean }>): void;
}

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
}

const definitions = new Map<string, LaneReadDefinition<unknown, unknown>>();
const laneReadId = (module: string, name: string) => `${module}#${name}`;

/** Declares a read a lane can run. The lane entry module imports every defining module, so the lane knows the read by id. */
export function defineLaneRead<Args, Result>(module: string, name: string, spec: Readonly<{
  lane: ReadLaneName; priority: "interactive" | "background"; args: z.ZodType<Args>; tables?: readonly AuthorityTableName[];
  timeline?: boolean; processFacts?: boolean; cacheMs?: number; run(context: LaneReadContext, args: Args): Result;
}>): LaneReadDefinition<Args, Result> {
  const id = laneReadId(module, name);
  if (definitions.has(id)) throw new Error(`read-lane-read-duplicate: ${name}`);
  const definition: LaneReadDefinition<Args, Result> = Object.freeze({ id, module, name, lane: spec.lane, priority: spec.priority,
    tables: Object.freeze([...spec.tables ?? []]), timeline: spec.timeline ?? false, processFacts: spec.processFacts ?? false,
    cacheMs: spec.cacheMs, args: spec.args, run: spec.run });
  definitions.set(id, definition);
  return definition;
}

export class ReadSupersededError extends Error {
  readonly code = "READ_SUPERSEDED";
  constructor() { super("read-superseded"); this.name = "ReadSupersededError"; }
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

const RequestSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("read"), id: z.number().int().positive(), beginSeq: z.number().int().nonnegative(), module: z.string().min(1),
    name: z.string().min(1), key: z.string().min(1), args: z.unknown(), nowMs: z.number().int(),
    processRevision: z.number().int().nonnegative().nullable(), processFacts: z.unknown() }),
  z.strictObject({ kind: z.literal("checkpoint"), id: z.number().int().positive() }),
  z.strictObject({ kind: z.literal("close") }),
]);
type LaneRequest = z.infer<typeof RequestSchema>;
const CheckpointRowSchema = z.strictObject({ busy: z.number().int(), log: z.number().int(), checkpointed: z.number().int() });
const ReplySchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("ready") }),
  z.strictObject({ kind: z.literal("read"), id: z.number().int().positive(), body: z.string(), position: ReadPositionSchema, cached: z.boolean() }),
  z.strictObject({ kind: z.literal("read-failed"), id: z.number().int().positive(), message: z.string().min(1) }),
  z.strictObject({ kind: z.literal("checkpoint"), id: z.number().int().positive(), ...CheckpointRowSchema.shape }),
  z.strictObject({ kind: z.literal("checkpoint-failed"), id: z.number().int().positive(), message: z.string().min(1) }),
]);
type LaneReply = z.infer<typeof ReplySchema>;

export interface DashboardReadReply {
  readonly body: string;
  readonly position: ReadPosition;
  readonly cached: boolean;
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
}

export interface DashboardReadLanes {
  /** Settles when every lane has opened once; reads queue until their lane is ready. */
  readonly ready: Promise<void>;
  read<Args>(definition: LaneReadDefinition<Args, unknown>, args: Args, options?: DashboardReadOptions): Promise<DashboardReadReply>;
  status(): Readonly<{ walPeakBytes: number; checkpoints: readonly WalCheckpointAttempt[]; restarts: number; retryPending: boolean }>;
  close(): Promise<void>;
}

interface Waiter {
  readonly dispatchSeq: number;
  readonly slot: string | undefined;
  readonly settle: PromiseWithResolvers<DashboardReadReply>;
  read: PendingRead | undefined;
  readonly release: () => void;
}

interface PendingRead {
  readonly key: string;
  readonly definition: LaneReadDefinition<unknown, unknown>;
  readonly args: unknown;
  readonly processRevision: number | null;
  readonly processFacts: unknown;
  readonly waiters: Set<Waiter>;
  state: "queued" | "running";
  beginSeq: number | undefined;
  id: number | undefined;
}

interface Lane {
  readonly name: ReadLaneName;
  worker: Worker | undefined;
  ready: boolean;
  readonly interactive: PendingRead[];
  readonly background: PendingRead[];
  running: PendingRead | "checkpoint" | undefined;
  consecutiveFailures: number;
  failure: Error | undefined;
  exited: Promise<void>;
}

/**
 * The main thread's side of the read lanes: per-lane interactive and background queues, waiters with latest-wins slots and
 * read-key sharing, lane restarts, and the WAL checkpoint window. The main thread runs no SQLite for a lane read.
 */
export function createDashboardReadHost(input: Readonly<{ admission: RuntimeAdmission; database: AuthorityDatabase; clock: Clock;
  /** The lanes to start; a read routed to a lane not started is refused. Every routed lane by default. */
  lanes?: readonly ReadLaneName[]; checkpoint?: Partial<typeof WAL_CHECKPOINT_DEFAULTS>;
  /** The module each lane worker runs: it imports its read modules and calls runReadLaneWorker. Relay's lane entry by default. */
  entry?: URL }>): DashboardReadLanes {
  const owner = requireRuntimeAdmission(input.admission);
  const { database, clock } = input;
  const policy = { ...WAL_CHECKPOINT_DEFAULTS, ...input.checkpoint };
  const entry = input.entry ?? new URL("./dashboard-read-lane.js", import.meta.url);
  const names = [...new Set(input.lanes ?? Object.values(LANE_ROUTES))];
  const starts = new Map(names.map(name => [name, prepareReadLaneStart(owner, database, name)] as const));
  const navigationStart = starts.get("navigation");
  if (navigationStart === undefined) throw new Error("read-lane-navigation-required");
  const walPath = `${navigationStart.path}-wal`;
  const slots = new Map<string, Waiter>();
  const lanes = new Map<ReadLaneName, Lane>();
  const checkpoints: WalCheckpointAttempt[] = [];
  let dispatchSeq = 0, messageId = 0, restarts = 0, walPeakBytes = 0;
  let paused = false, closing = false;
  let checkpointState: "idle" | "draining" | "running" = "idle";
  let retryTimer: ReturnType<typeof setTimeout> | undefined, retryDelayMs = policy.minRetryMs;
  const readyWaits: Promise<void>[] = [];

  const admit = (start: ReadLaneStart) => {
    owner.assertProfileRuntime();
    owner.assertReadOnlyAuthorityDatabase(start.path);
    if (!sameDirectory(readLaneSourceIdentity(start.path), start.identity)) throw new Error("profile-database-open-source-changed");
  };
  const walBytes = () => {
    const size = Number(fileStatus(walPath, true)?.size ?? 0);
    walPeakBytes = Math.max(walPeakBytes, size);
    return size;
  };

  const settleWaiter = (waiter: Waiter, outcome: { reply: DashboardReadReply } | { error: Error }) => {
    waiter.read?.waiters.delete(waiter);
    waiter.read = undefined;
    if (waiter.slot !== undefined && slots.get(waiter.slot) === waiter) slots.delete(waiter.slot);
    waiter.release();
    if ("reply" in outcome) waiter.settle.resolve(outcome.reply);
    else waiter.settle.reject(outcome.error);
  };
  const dropIfUnwanted = (read: PendingRead) => {
    if (read.waiters.size > 0 || read.state !== "queued") return;
    const lane = laneOf(read.definition);
    for (const queue of [lane.interactive, lane.background]) {
      const index = queue.indexOf(read);
      if (index !== -1) queue.splice(index, 1);
    }
  };
  /** A waiter detaches by itself; a queued read nobody waits for is removed, a running one only fills the lane's cache. */
  const detach = (waiter: Waiter, error: Error) => {
    const read = waiter.read;
    settleWaiter(waiter, { error });
    if (read !== undefined) dropIfUnwanted(read);
  };
  const laneOf = (definition: LaneReadDefinition<unknown, unknown>): Lane => {
    const lane = lanes.get(LANE_ROUTES[definition.lane]);
    if (lane === undefined) throw new Error("read-lane-unrouted");
    return lane;
  };

  const pump = (lane: Lane) => {
    if (closing || paused || !lane.ready || lane.running !== undefined || lane.worker === undefined) return;
    const read = lane.interactive.shift() ?? lane.background.shift();
    if (read === undefined) return;
    read.state = "running";
    read.beginSeq = dispatchSeq;
    read.id = ++messageId;
    lane.running = read;
    const message: LaneRequest = { kind: "read", id: read.id, beginSeq: read.beginSeq, module: read.definition.module, name: read.definition.name,
      key: read.key, args: read.args, nowMs: clock.nowMs(), processRevision: read.processRevision, processFacts: read.processFacts };
    lane.worker.postMessage(message);
  };
  const pumpAll = () => { for (const lane of lanes.values()) pump(lane); };

  const startCheckpointWhenIdle = () => {
    if (checkpointState !== "draining" || closing) return;
    if ([...lanes.values()].some(lane => lane.running !== undefined)) return;
    const lane = lanes.get("navigation");
    if (lane?.worker === undefined || !lane.ready) { checkpointState = "idle"; paused = false; scheduleRetry(); return; }
    checkpointState = "running";
    lane.running = "checkpoint";
    const message: LaneRequest = { kind: "checkpoint", id: ++messageId };
    lane.worker.postMessage(message);
  };
  const beginCheckpoint = () => {
    if (checkpointState !== "idle" || closing) return;
    checkpointState = "draining";
    paused = true;
    startCheckpointWhenIdle();
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
    if (checkpointState === "idle" && retryTimer === undefined && walBytes() > policy.thresholdBytes) beginCheckpoint();
  };
  const finishCheckpoint = (row: z.infer<typeof CheckpointRowSchema> | undefined) => {
    checkpointState = "idle";
    paused = false;
    const after = walBytes();
    if (row !== undefined) checkpoints.push(Object.freeze({ atMs: clock.nowMs(), ...row, walBytesAfter: after }));
    if (row === undefined || row.busy !== 0 || after > 0) scheduleRetry();
    else retryDelayMs = policy.minRetryMs;
  };

  const onReply = (lane: Lane, start: ReadLaneStart, message: unknown) => {
    const reply: LaneReply = ReplySchema.parse(message);
    if (reply.kind === "ready") {
      lane.ready = true;
      pumpAll();
      return;
    }
    const running = lane.running;
    lane.running = undefined;
    if (reply.kind === "checkpoint" || reply.kind === "checkpoint-failed") {
      if (running !== "checkpoint") throw new Error("read-lane-reply-unexpected");
      finishCheckpoint(reply.kind === "checkpoint" ? { busy: reply.busy, log: reply.log, checkpointed: reply.checkpointed } : undefined);
    } else {
      if (running === undefined || running === "checkpoint" || running.id !== reply.id) throw new Error("read-lane-reply-unexpected");
      lane.consecutiveFailures = 0;
      let outcome: { reply: DashboardReadReply } | { error: Error };
      try {
        admit(start);
        outcome = reply.kind === "read" ? { reply: Object.freeze({ body: reply.body, position: reply.position, cached: reply.cached }) }
          : { error: new ReadLaneReadError(reply.message) };
      } catch (error) { outcome = { error: error instanceof Error ? error : new Error("read-lane-admission-failed", { cause: error }) }; }
      for (const waiter of [...running.waiters]) settleWaiter(waiter, outcome);
      observeWal();
    }
    startCheckpointWhenIdle();
    pumpAll();
  };

  const launch = (lane: Lane) => {
    const start = prepareReadLaneStart(owner, database, lane.name);
    const original = starts.get(lane.name);
    if (original === undefined || !sameDirectory(original.identity, start.identity)) throw new Error("profile-database-open-source-changed");
    const releaseSource = database.retainDashboardReadSource(owner, start.identity);
    let worker: Worker;
    try {
      worker = new Worker(entry, { name: `relay-dashboard-read-${lane.name}`, workerData: start,
        execArgv: workerExecArgv(), env: workerBootstrapEnvironment() });
    } catch (error) { releaseSource(); throw error; }
    lane.worker = worker;
    lane.ready = false;
    const ready = Promise.withResolvers<void>();
    let failure: Error | undefined;
    worker.on("message", (message: unknown) => {
      try {
        onReply(lane, start, message);
        if (lane.ready) ready.resolve();
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
      const running = lane.running;
      lane.running = undefined;
      if (running === "checkpoint") finishCheckpoint(undefined);
      else if (running !== undefined) for (const waiter of [...running.waiters]) settleWaiter(waiter, { error: closing ? new ReadLaneClosedError() : new ReadLaneRestartedError(cause) });
      resolve();
      if (closing) return;
      lane.consecutiveFailures += 1;
      if (lane.consecutiveFailures > LANE_RESTART_LIMIT) {
        lane.failure = cause;
        for (const read of [...lane.interactive.splice(0), ...lane.background.splice(0)]) {
          for (const waiter of [...read.waiters]) settleWaiter(waiter, { error: cause });
        }
        startCheckpointWhenIdle();
        pumpAll();
        return;
      }
      restarts += 1;
      try { launch(lane); }
      catch (error) { lane.failure = error instanceof Error ? error : new Error("read-lane-restart-failed", { cause: error }); }
      startCheckpointWhenIdle();
      pumpAll();
    }));
    ready.promise.catch(() => undefined);
    return ready.promise;
  };

  try {
    for (const name of names) {
      const lane: Lane = { name, worker: undefined, ready: false, interactive: [], background: [], running: undefined,
        consecutiveFailures: 0, failure: undefined, exited: Promise.resolve() };
      lanes.set(name, lane);
      readyWaits.push(launch(lane));
    }
  } catch (error) {
    closing = true;
    for (const lane of lanes.values()) void lane.worker?.terminate();
    throw error;
  }

  return Object.freeze({
    ready: Promise.all(readyWaits).then(() => undefined),
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
      const key = canonicalJsonStringify({ lane: LANE_ROUTES[registered.lane], read: registered.id, args: parsed });
      const seq = ++dispatchSeq;
      const settle = Promise.withResolvers<DashboardReadReply>();
      const signal = options.signal;
      const onAbort = () => { detach(waiter, signal?.reason instanceof Error ? signal.reason : new Error("read-aborted")); };
      const slot = options.slot === undefined ? undefined : canonicalJsonStringify(options.slot);
      const waiter: Waiter = { dispatchSeq: seq, slot, settle, read: undefined, release: () => signal?.removeEventListener("abort", onAbort) };
      if (signal?.aborted === true) { onAbort(); return settle.promise; }
      signal?.addEventListener("abort", onAbort, { once: true });
      if (slot !== undefined) {
        const previous = slots.get(slot);
        slots.set(slot, waiter);
        if (previous !== undefined) detach(previous, new ReadSupersededError());
      }
      const candidates = [lane.running, ...lane.interactive, ...lane.background];
      const joined = candidates.find((read): read is PendingRead => read !== undefined && read !== "checkpoint" && read.key === key
        && read.processRevision === processRevision && (read.state === "queued" || (read.beginSeq !== undefined && seq <= read.beginSeq)));
      const read: PendingRead = joined ?? { key, definition: registered, args: parsed, processRevision, processFacts,
        waiters: new Set(), state: "queued", beginSeq: undefined, id: undefined };
      read.waiters.add(waiter);
      waiter.read = read;
      if (joined === undefined) (registered.priority === "interactive" ? lane.interactive : lane.background).push(read);
      observeWal();
      pump(lane);
      return settle.promise;
    },
    status: () => Object.freeze({ walPeakBytes, checkpoints: Object.freeze([...checkpoints]), restarts, retryPending: retryTimer !== undefined }),
    async close(): Promise<void> {
      if (!closing) {
        closing = true;
        if (retryTimer !== undefined) clearTimeout(retryTimer);
        retryTimer = undefined;
        for (const lane of lanes.values()) {
          for (const read of [...lane.interactive.splice(0), ...lane.background.splice(0)]) {
            for (const waiter of [...read.waiters]) settleWaiter(waiter, { error: new ReadLaneClosedError() });
          }
          const worker = lane.worker;
          if (worker === undefined) continue;
          if (lane.running === undefined) {
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

function runReadLane(port: MessagePort, data: unknown) {
  const lane = admitReadLane(data);
  const { start } = lane;
  const { native, history } = openReadLane(lane, LANE_BUSY_TIMEOUT_MS);
  const resources: Readonly<{ close(): void; inTransaction(): boolean }>[] = [];
  let checkpoint: DatabaseSync | undefined;
  try {
    if (start.checkpoint) {
      // Checkpoint-only: read-write so it may checkpoint, query_only so it never writes, and it never begins a transaction.
      lane.admission.assertReadOnlyAuthorityDatabase(start.path);
      checkpoint = new DatabaseSync(existingDatabaseLocation(start.path), { timeout: 0, allowExtension: false, defensive: true,
        enableDoubleQuotedStringLiterals: false, readBigInts: false, returnArrays: false });
      checkpoint.exec("PRAGMA query_only=ON; PRAGMA busy_timeout=0");
      lane.assertSource();
    }
  } catch (error) { checkpoint?.close(); native.close(); throw error; }
  const source = [start.identity, start.historyArchive?.identity].filter(identity => identity !== undefined)
    .map(identity => `${identity.device}:${identity.inode}`).join("+") + `@${String(start.cursorOffset)}`;
  const cache = new Map<string, CacheEntry>();
  const leftInTransaction = () => native.hasOpenTransaction() || history.hasOpenTransaction() || resources.some(resource => resource.inTransaction());
  const close = () => {
    for (const resource of resources.splice(0)) resource.close();
    checkpoint?.close();
    native.close();
    port.close();
  };

  const serve = (definition: LaneReadDefinition<unknown, unknown>, message: Extract<LaneRequest, { kind: "read" }>) => {
    const args = definition.args.parse(message.args);
    const cached = definition.tables.length === 0 ? undefined : cache.get(message.key);
    return history.withAuthorityReadSnapshot(() => {
      lane.assertSource();
      const meta = history.getMeta(), change = history.capturedChangeKey();
      const timelineThrough = definition.timeline ? history.authority.timelineEvents.highWaterMark() : null;
      const base = { source, schemaVersion: meta.schemaVersion, schemaCookie: change.schemaCookie, authorityGeneration: meta.authorityGeneration };
      if (cached !== undefined) {
        const held = cached.position;
        const reusable = held.source === base.source && held.schemaVersion === base.schemaVersion && held.schemaCookie === base.schemaCookie
          && held.authorityGeneration === base.authorityGeneration && (held.validUntil === null || message.nowMs < held.validUntil)
          && held.processRevision === message.processRevision && held.timelineThrough === timelineThrough
          && history.readChangeInterval(held.changeLogSeq, definition.tables).clear;
        if (reusable) {
          cached.position = { ...held, changeLogSeq: change.changeLogSeq };
          cached.beginSeq = message.beginSeq;
          return { body: cached.body, position: cached.position, cached: true };
        }
      }
      const context: LaneReadContext = { start, native, history, nowMs: message.nowMs, processFacts: message.processFacts,
        retain: resource => { resources.push(resource); } };
      const body = JSON.stringify(definition.run(context, args));
      const position: ReadPosition = { ...base, changeLogSeq: change.changeLogSeq, timelineThrough,
        processRevision: message.processRevision, validUntil: definition.cacheMs === undefined ? null : message.nowMs + definition.cacheMs };
      if (definition.tables.length > 0) cache.set(message.key, { body, position, beginSeq: message.beginSeq });
      return { body, position, cached: false };
    });
  };

  const handle = (input: unknown): void => {
    const message = RequestSchema.parse(input);
    if (message.kind === "close") { close(); return; }
    let reply: LaneReply;
    if (message.kind === "checkpoint") {
      try {
        if (checkpoint === undefined) throw new Error("read-lane-checkpoint-unowned");
        lane.assertSource();
        reply = { kind: "checkpoint", id: message.id, ...CheckpointRowSchema.parse(checkpoint.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get()) };
      } catch (error) { reply = { kind: "checkpoint-failed", id: message.id, message: error instanceof Error ? error.message : "read-lane-checkpoint-failed" }; }
    } else {
      try {
        const definition = resolveLaneRead(message.module, message.name);
        reply = { kind: "read", id: message.id, ...serve(definition, message) };
      } catch (error) { reply = { kind: "read-failed", id: message.id, message: error instanceof Error && error.message !== "" ? error.message : "read-lane-read-failed" }; }
    }
    // A failed rollback leaves a transaction that would pin the WAL: exit, which releases the mark, and let the host restart the lane.
    if (leftInTransaction()) process.exit(LANE_TRANSACTION_EXIT_CODE);
    port.postMessage(reply);
  };
  port.on("message", (input: unknown) => {
    // A malformed request or a failed close leaves the lane in an unknown state; the host restarts it from its exit.
    try { handle(input); } catch { process.exit(LANE_FAILURE_EXIT_CODE); }
  });
  const ready: LaneReply = { kind: "ready" };
  port.postMessage(ready);
}

/** A lane entry calls this after importing its read modules; outside a lane worker it does nothing. */
export function runReadLaneWorker(): void {
  if (!isMainThread && parentPort !== null && z.object({ protocol: z.literal(READ_LANE_PROTOCOL) }).safeParse(workerData).success) {
    runReadLane(parentPort, workerData);
  }
}
