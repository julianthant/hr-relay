import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parentPort } from "node:worker_threads";
import { z } from "zod";
import "../../../../src/backend/storage/sqlite/dashboard-background-read-worker.js";
import { AuthoritySnapshotChangedError } from "../../../../src/backend/storage/sqlite/authority-errors.js";
import { defineLaneRead, runReadLaneWorker, type LaneReadContext } from "../../../../src/backend/storage/sqlite/dashboard-read-host.js";
import { openReadOnlyDatabase } from "../../../../src/backend/storage/sqlite/readonly-authority-snapshot.js";
import { systemClock } from "../../../../src/rules/time/clock.js";

const SleepSchema = z.strictObject({ tag: z.string().min(1), ms: z.number().int().nonnegative() });
const pause = new Int32Array(new SharedArrayBuffer(4));
/** Runs per lane isolate; a restarted lane starts again from zero. */
let runs = 0;

function sleep(args: z.infer<typeof SleepSchema>) {
  runs += 1;
  if (args.ms > 0) Atomics.wait(pause, 0, 0, args.ms);
  return { tag: args.tag, run: runs };
}

/** Interactive navigation read that blocks the lane for `ms`. */
export const laneSleep = defineLaneRead(import.meta.url, "lane-sleep", { lane: "navigation", priority: "interactive", args: SleepSchema,
  run: (_context, args) => sleep(args) });

/** Background navigation read that blocks the lane for `ms`. */
export const laneBackground = defineLaneRead(import.meta.url, "lane-background", { lane: "navigation", priority: "background", args: SleepSchema,
  run: (_context, args) => sleep(args) });

/** Started and finished on the wall clock, which the host and lane threads share. */
const timed = (args: z.infer<typeof SleepSchema>) => {
  const startedAt = systemClock.nowMs();
  return { ...sleep(args), startedAt, finishedAt: systemClock.nowMs() };
};

/** laneSleep that also reports when the lane started and finished it. */
export const laneTimedSleep = defineLaneRead(import.meta.url, "lane-timed-sleep", { lane: "navigation", priority: "interactive", args: SleepSchema,
  run: (_context, args) => timed(args) });

/** laneBackground that also reports when the lane started and finished it. */
export const laneTimedBackground = defineLaneRead(import.meta.url, "lane-timed-background", { lane: "navigation", priority: "background",
  args: SleepSchema, run: (_context, args) => timed(args) });

const BarrierSchema = z.strictObject({ tag: z.string().min(1), dir: z.string().min(1) });
/** Writes `started` in `dir`, then holds the lane until the test writes `release` there. */
function barrier(args: z.infer<typeof BarrierSchema>) {
  runs += 1;
  writeFileSync(join(args.dir, "started"), "");
  const deadline = performance.now() + 10_000;
  while (!existsSync(join(args.dir, "release"))) {
    if (performance.now() > deadline) throw new Error("fixture barrier never released");
    Atomics.wait(pause, 0, 0, 5);
  }
  return { tag: args.tag, run: runs };
}

/** Background navigation read held on an explicit barrier the test releases. */
export const laneBackgroundBarrier = defineLaneRead(import.meta.url, "lane-background-barrier", { lane: "navigation", priority: "background",
  args: BarrierSchema, run: (_context, args) => barrier(args) });

export const laneBackgroundChunks = defineLaneRead(import.meta.url, "lane-background-chunks", { lane: "navigation", priority: "background",
  args: BarrierSchema,
  *chunks(_context, args) {
    barrier(args);
    yield;
    return sleep({ tag: args.tag, ms: 0 });
  },
});

/** Search-lane read; shape A routes it to the navigation worker. */
export const laneSearch = defineLaneRead(import.meta.url, "lane-search", { lane: "search", priority: "interactive", args: SleepSchema,
  run: (_context, args) => sleep(args) });

export const laneSearchBarrier = defineLaneRead(import.meta.url, "lane-search-barrier", { lane: "search", priority: "interactive",
  args: BarrierSchema, run: (_context, args) => barrier(args) });

/** Joins only with an equal process revision. */
export const laneFacts = defineLaneRead(import.meta.url, "lane-facts", { lane: "navigation", priority: "interactive", args: SleepSchema,
  processFacts: true, run: (context, args) => ({ ...sleep(args), facts: context.processFacts }) });

const PoolSchema = z.strictObject({ workflow: z.string().min(1) });
const poolRead = (context: LaneReadContext, args: z.infer<typeof PoolSchema>) => {
  runs += 1;
  return { run: runs, desiredWorkers: context.history.authority.workerPools.get(args.workflow)?.desiredWorkers ?? 0 };
};

/** Cached on worker_pools, without expiry. */
export const lanePool = defineLaneRead(import.meta.url, "lane-pool", { lane: "navigation", priority: "interactive", args: PoolSchema,
  tables: ["worker_pools"], run: poolRead });

/** Cached on worker_pools for one second of the host clock. */
export const lanePoolExpiring = defineLaneRead(import.meta.url, "lane-pool-expiring", { lane: "navigation", priority: "interactive",
  args: PoolSchema, tables: ["worker_pools"], cacheMs: 1_000, run: poolRead });

/** Reads archive and native history through the lane's history reader. */
export const laneHistory = defineLaneRead(import.meta.url, "lane-history", { lane: "navigation", priority: "interactive",
  args: z.strictObject({ after: z.number().int().nonnegative(), limit: z.number().int().positive().max(1000) }),
  run: (context, args) => ({ highWater: context.history.authority.timelineEvents.highWaterMark(), offset: context.history.timelineCursorOffset(),
    records: context.history.authority.timelineEvents.page(args) }) });

/** Tries to write through both lane connections and reports each refusal. */
export const laneWrite = defineLaneRead(import.meta.url, "lane-write", { lane: "navigation", priority: "interactive", args: z.strictObject({}),
  run(context) {
    const attempt = (work: () => void) => {
      try { work(); return "written"; } catch (error) { return error instanceof Error ? error.message : "refused"; }
    };
    const plan = (database: typeof context.native) => () => {
      database.authority.workerPools.plan({ workflow: "person-lookup", desiredWorkers: 9, expectedVersion: 0, requestedBy: "local-operator",
        now: new Date(context.nowMs).toISOString() });
    };
    return { native: attempt(plan(context.native)), history: attempt(plan(context.history)) };
  } });

/** Fails as a read whose paired history and native snapshots kept showing different commits. */
export const laneSnapshotChanged = defineLaneRead(import.meta.url, "lane-snapshot-changed", { lane: "navigation", priority: "background",
  args: z.strictObject({}), run: () => { throw new AuthoritySnapshotChangedError(); } });

/** Pages the run list through the lane's TEMP paging tables. */
export const laneRunPage = defineLaneRead(import.meta.url, "lane-run-page", { lane: "navigation", priority: "interactive",
  args: z.strictObject({ offset: z.number().int().nonnegative(), limit: z.number().int().positive().max(1000) }),
  run: (context, args) => ({ archive: context.start.historyArchive !== undefined,
    runIds: context.history.authority.runs.listPage(args).map(run => run.envelope.runId) }) });

/** A connection left inside a read transaction, as a failed rollback leaves it: the lane must exit and release its mark. */
export const laneStuck = defineLaneRead(import.meta.url, "lane-stuck", { lane: "navigation", priority: "interactive", args: z.strictObject({}),
  run(context) {
    const connection = openReadOnlyDatabase(context.start.path, 250);
    connection.exec("BEGIN; SELECT count(*) FROM sqlite_schema;");
    context.retain({ close: () => { connection.close(); }, inTransaction: () => connection.isOpen && connection.isTransaction });
    return { stuck: true };
  } });

/**
 * A read whose rollback fails on the lane's own connection: the next ROLLBACK in this lane isolate throws without running,
 * so the failed read leaves that connection inside its read transaction.
 */
export const laneRollbackFails = defineLaneRead(import.meta.url, "lane-rollback-fails", { lane: "navigation", priority: "interactive",
  args: z.strictObject({}), run(context) {
    const probe = openReadOnlyDatabase(context.start.path, 250);
    const prototype: unknown = Object.getPrototypeOf(probe);
    probe.close();
    if (typeof prototype !== "object" || prototype === null) throw new Error("fixture connection prototype missing");
    const exec: unknown = Reflect.get(prototype, "exec");
    if (typeof exec !== "function") throw new Error("fixture connection exec missing");
    Reflect.set(prototype, "exec", function (this: unknown, sql: string) {
      if (sql !== "ROLLBACK") { Reflect.apply(exec, this, [sql]); return; }
      Reflect.set(prototype, "exec", exec);
      throw new Error("injected-rollback-failure");
    });
    throw new Error("injected-read-failure");
  } });

/** Posts a reply for a read the host never sent before its real reply: the host must restart the lane. */
export const laneMismatchedReply = defineLaneRead(import.meta.url, "lane-mismatched-reply", { lane: "navigation", priority: "interactive",
  args: z.strictObject({}), run() {
    parentPort?.postMessage({ kind: "read-failed", ids: [2 ** 30], message: "forged-reply" });
    return { forged: true };
  } });

/** Posts a forged body for known in-flight ids at a chosen begin position before its real reply: the host must refuse the batch. */
export const laneForgedBatch = defineLaneRead(import.meta.url, "lane-forged-batch", { lane: "navigation", priority: "interactive",
  args: z.strictObject({ ids: z.array(z.number().int().positive()).min(1), beginSeq: z.number().int().nonnegative() }), run(_context, args) {
    parentPort?.postMessage({ kind: "read", ids: args.ids, body: JSON.stringify({ forged: true }), cached: false, beginSeq: args.beginSeq,
      position: { source: "forged", schemaVersion: 1, schemaCookie: 0, authorityGeneration: 0, changeLogSeq: 0, timelineThrough: null,
        processRevision: null, validUntil: null } });
    return { forged: false };
  } });

/** A read that reports a position from its own snapshot; the reply must carry it. */
export const laneOwnSnapshot = defineLaneRead(import.meta.url, "lane-own-snapshot", { lane: "navigation", priority: "interactive",
  args: z.strictObject({ authorityGeneration: z.number().int().nonnegative(), changeLogSeq: z.number().int().nonnegative() }),
  run(context, args) {
    const meta = context.native.getMeta();
    context.snapshotAt({ schemaVersion: meta.schemaVersion, schemaCookie: context.native.capturedChangeKey().schemaCookie, ...args });
    return {};
  } });

/** The lane entry for hosts that serve these reads alongside Relay's own. */
export const LANE_READS_ENTRY = new URL(import.meta.url);
runReadLaneWorker();
