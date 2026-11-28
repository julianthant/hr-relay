import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { afterEach, it } from "vitest";
import { z } from "zod";
import { createNoteTimelineWriter } from "../../../../src/backend/storage/events/note-timeline-writer.js";
import { createDashboardReadHost, ReadLaneRestartedError, type DashboardReadReply } from "../../../../src/backend/storage/sqlite/dashboard-read-host.js";
import { workerExecArgv } from "../../../../src/backend/storage/sqlite/backup-inspection-worker.js";
import { prepareReadLaneStart, type ReadLaneName } from "../../../../src/backend/storage/sqlite/read-lane-admission.js";
import { workerBootstrapEnvironment } from "../../../../src/models/config/secrets.js";
import { systemClock } from "../../../../src/rules/time/clock.js";
import { LANE_READS_ENTRY, laneBackground, laneBackgroundBarrier, laneSearch, laneSearchBarrier, laneSleep, laneStuck, laneTimedSleep } from "../../../support/fixtures/backend/dashboard-lane-reads.js";
import { openBoundDatabaseFixture } from "../../../support/helpers/admission-fixture.js";

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

const RunSchema = z.object({ tag: z.string(), run: z.number().int() });
const run = async (reply: Promise<DashboardReadReply>) => RunSchema.parse(JSON.parse((await reply).body)).run;

async function host(options: Partial<Pick<Parameters<typeof createDashboardReadHost>[0], "checkpoint" | "lanes">> = {}) {
  const fixture = await openBoundDatabaseFixture("read-lane-ordering");
  cleanups.push(() => fixture.close());
  const lanes = createDashboardReadHost({ admission: fixture.profile.admission, database: fixture.database, clock: systemClock,
    lanes: ["navigation"], entry: LANE_READS_ENTRY, ...options });
  cleanups.push(() => lanes.close());
  await lanes.ready;
  return { fixture, lanes };
}

/** A directory the barrier read signals `started` in and the test releases it through. */
function barrierDir() {
  const dir = mkdtempSync(join(tmpdir(), "read-lane-barrier-"));
  cleanups.push(() => { rmSync(dir, { recursive: true, force: true }); });
  return { dir, release: () => { writeFileSync(join(dir, "release"), ""); } };
}
const until = async (ready: () => boolean) => {
  const deadline = performance.now() + 10_000;
  while (!ready()) {
    if (performance.now() > deadline) throw new Error("condition never held");
    await new Promise(resolve => setTimeout(resolve, 5));
  }
};

it("dispatches a queued click before the next background message after a background reply", async () => {
  const { lanes } = await host();
  const { dir, release } = barrierDir();
  const scan = lanes.read(laneBackgroundBarrier, { tag: "scan", dir });
  // The lane picks its own next message: the scan is running on its barrier before the others arrive.
  await until(() => existsSync(join(dir, "started")));
  const nextScan = lanes.read(laneBackground, { tag: "next-scan", ms: 0 });
  const click = lanes.read(laneSleep, { tag: "click", ms: 0 });
  release();
  assert.deepEqual(await Promise.all([run(scan), run(click), run(nextScan)]), [1, 2, 3]);
});

it("starts a click queued behind a background read while the main thread is still held, with no host handoff", async () => {
  const { lanes } = await host();
  const { dir, release } = barrierDir();
  const scan = lanes.read(laneBackgroundBarrier, { tag: "scan", dir });
  await until(() => existsSync(join(dir, "started")));
  const click = lanes.read(laneTimedSleep, { tag: "click", ms: 0 });
  // The main thread releases the scan and then stays blocked: it cannot take the scan's reply or post anything until it wakes.
  const heldFrom = systemClock.nowMs();
  release();
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
  const heldTo = systemClock.nowMs();
  const started = z.object({ startedAt: z.number() }).parse(JSON.parse((await click).body)).startedAt;
  assert.equal(await run(scan), 1);
  assert.ok(started >= heldFrom && started < heldTo, `the click started at ${String(started)}, inside the main-thread hold ${String(heldFrom)}–${String(heldTo)}`);
});

it("runs a queued checkpoint first, then the interactive request before the background one", async () => {
  const { fixture, lanes } = await host({ checkpoint: { thresholdBytes: 0 } });
  createNoteTimelineWriter({ repository: fixture.database.authority.timelineEvents, clock: systemClock }).emitNote({ workflow: "person-lookup",
    address: { workerId: "worker-1", spanPath: "worker-1" }, level: "step", message: "grow the write-ahead log" });
  // The WAL is over the threshold, so the first request posts a checkpoint ahead of itself; both reads queue behind it in the lane.
  const scan = lanes.read(laneBackground, { tag: "scan", ms: 0 });
  const click = lanes.read(laneSleep, { tag: "click", ms: 0 });
  assert.deepEqual(await Promise.all([run(click), run(scan)]), [1, 2]);
  const [checkpoint] = lanes.status().checkpoints;
  assert.ok(checkpoint !== undefined);
  assert.equal(checkpoint.busy, 0);
  assert.equal(checkpoint.walBytesAfter, 0);
});

it("fails every read in flight to an exited lane and dispatches the interactive request first after the restart", async () => {
  const { lanes } = await host();
  const stuck = lanes.read(laneStuck, {});
  const queued = lanes.read(laneSleep, { tag: "queued", ms: 0 });
  const restarted = (error: unknown) => error instanceof ReadLaneRestartedError && error.code === "READ_LANE_RESTARTED";
  await assert.rejects(stuck, restarted);
  await assert.rejects(queued, restarted);
  // Both reads arrive while the replacement lane boots: the host holds them and posts the interactive one first.
  const scan = lanes.read(laneBackground, { tag: "scan", ms: 0 });
  const click = lanes.read(laneSleep, { tag: "click", ms: 0 });
  // The restarted lane is a new isolate: its first run is the click.
  assert.deepEqual(await Promise.all([run(click), run(scan)]), [1, 2]);
  assert.equal(lanes.status().restarts, 1);
});

it("holds a checkpoint until the other lane's running read ends, so the checkpoint is never busy on it", async () => {
  const { fixture, lanes } = await host({ lanes: ["navigation", "search"], checkpoint: { thresholdBytes: 0 } });
  await run(lanes.read(laneSleep, { tag: "settle", ms: 0 }));
  const searchStarted = systemClock.nowMs();
  // The search lane holds its read snapshot for 300 ms; a TRUNCATE run beside it would report busy.
  const search = lanes.read(laneSearch, { tag: "search", ms: 300 });
  await new Promise(resolve => setTimeout(resolve, 50));
  createNoteTimelineWriter({ repository: fixture.database.authority.timelineEvents, clock: systemClock }).emitNote({ workflow: "person-lookup",
    address: { workerId: "worker-1", spanPath: "worker-1" }, level: "step", message: "grow the write-ahead log beside a search" });
  const before = lanes.status().checkpoints.length;
  const click = lanes.read(laneSleep, { tag: "click", ms: 0 });
  await Promise.all([run(search), run(click)]);
  const deadline = performance.now() + 2_000;
  while (lanes.status().checkpoints.length === before && performance.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
  const checkpoint = lanes.status().checkpoints[before];
  assert.ok(checkpoint !== undefined, "the grown WAL got a checkpoint");
  assert.equal(checkpoint.busy, 0);
  assert.equal(checkpoint.walBytesAfter, 0);
  assert.ok(checkpoint.finishedAtMs >= searchStarted + 300, "the checkpoint ran only after the search read released its snapshot");
});

it("truncates at the boundary between a running Search read and its queued successor", async () => {
  const fixture = await openBoundDatabaseFixture("read-lane-checkpoint-boundary");
  cleanups.push(() => fixture.close());
  const first = barrierDir(), next = barrierDir();
  const gate = new Int32Array(new SharedArrayBuffer(3 * Int32Array.BYTES_PER_ELEMENT));
  async function launch(name: ReadLaneName) {
    const worker = new Worker(LANE_READS_ENTRY, { workerData: {
      start: prepareReadLaneStart(fixture.profile.admission, fixture.database, name), gate, clock: "host",
    }, execArgv: workerExecArgv(), env: workerBootstrapEnvironment() });
    cleanups.push(async () => { await worker.terminate(); });
    const replies: { kind: string; busy?: number }[] = [];
    worker.on("message", (reply: { kind: string; busy?: number }) => { replies.push(reply); });
    await until(() => replies.some(reply => reply.kind === "ready"));
    return { worker, replies };
  }
  const navigation = await launch("navigation"), search = await launch("search");
  const postSearch = (id: number, dir: string) => search.worker.postMessage({ kind: "read", id, beginSeq: id,
    module: laneSearchBarrier.module, name: laneSearchBarrier.name, key: String(id), args: { tag: String(id), dir },
    priority: laneSearchBarrier.priority, nowMs: systemClock.nowMs(), processRevision: null, processFacts: null });
  postSearch(1, first.dir);
  await until(() => existsSync(join(first.dir, "started")));
  postSearch(2, next.dir);
  createNoteTimelineWriter({ repository: fixture.database.authority.timelineEvents, clock: systemClock }).emitNote({ workflow: "person-lookup",
    address: { workerId: "worker-1", spanPath: "worker-1" }, level: "step", message: "grow the WAL while Search is busy" });
  const wal = `${fixture.path}-wal`;
  assert.ok(statSync(wal).size > 0);

  navigation.worker.postMessage({ kind: "checkpoint", id: 3 });
  await until(() => Atomics.load(gate, 0) === 1 || navigation.replies.length > 1);
  assert.equal(Atomics.load(gate, 0), 1, "the pending checkpoint reserves the next read boundary");
  first.release();
  await until(() => existsSync(join(next.dir, "started")));
  assert.equal(statSync(wal).size, 0, "the queued Search read starts only after truncation");
  await until(() => navigation.replies.some(reply => reply.kind === "checkpoint" && reply.busy === 0));
  next.release();
  await until(() => search.replies.filter(reply => reply.kind === "read").length === 2);
});

it("routes search to the navigation worker in shape A and to its own worker in shape B", async () => {
  const shapeA = await host();
  const blockingA = shapeA.lanes.read(laneSleep, { tag: "navigation", ms: 100 });
  assert.equal(await run(shapeA.lanes.read(laneSearch, { tag: "search", ms: 0 })), 2);
  assert.equal(await run(blockingA), 1);

  const shapeB = await host({ lanes: ["navigation", "search"] });
  const blockingB = shapeB.lanes.read(laneSleep, { tag: "navigation", ms: 300 });
  const started = performance.now();
  assert.equal(await run(shapeB.lanes.read(laneSearch, { tag: "search", ms: 0 })), 1);
  assert.ok(performance.now() - started < 300, "the search lane does not wait for the navigation lane");
  assert.equal(await run(blockingB), 1);
});

it("keeps reads queued and answers a cancel while a checkpoint holds the gate, then runs interactive work first", async () => {
  const fixture = await openBoundDatabaseFixture("read-lane-gate");
  cleanups.push(() => fixture.close());
  // The gate is a checkpoint flag and one reading flag per lane; the raised flag stands in for the navigation lane's checkpoint.
  const gate = new Int32Array(new SharedArrayBuffer(3 * Int32Array.BYTES_PER_ELEMENT));
  const SEARCH_READING = 2;
  Atomics.store(gate, 0, 1);
  const worker = new Worker(LANE_READS_ENTRY, { workerData: { start: prepareReadLaneStart(fixture.profile.admission, fixture.database, "search"),
    gate, clock: "host" }, execArgv: workerExecArgv(), env: workerBootstrapEnvironment() });
  cleanups.push(async () => { await worker.terminate(); });
  const replies: { kind: string; id?: number; ids?: number[]; body?: string }[] = [];
  worker.on("message", (reply: { kind: string }) => { replies.push(reply); });
  await until(() => replies.some(reply => reply.kind === "ready"));
  const read = (id: number, definition: typeof laneSleep, tag: string) => {
    const args = { tag, ms: 0 };
    worker.postMessage({ kind: "read", id, beginSeq: id, module: definition.module, name: definition.name, key: `${definition.name}:${tag}`,
      args, priority: definition.priority, nowMs: systemClock.nowMs(), processRevision: null, processFacts: null });
  };
  // A background read arrives first; the interactive ones arrive while the gate is still held.
  read(1, laneBackground, "scan");
  read(2, laneSleep, "click");
  read(3, laneSleep, "stale");
  worker.postMessage({ kind: "cancel", id: 3 });
  await until(() => replies.some(reply => reply.kind === "cancelled"));
  // The lane answered the cancel while the gate was held, and never marked itself reading or replied to a read.
  assert.deepEqual(replies.filter(reply => reply.kind !== "ready"), [{ kind: "cancelled", id: 3 }]);
  assert.equal(Atomics.load(gate, SEARCH_READING), 0);
  Atomics.store(gate, 0, 0);
  Atomics.notify(gate, 0);
  await until(() => replies.filter(reply => reply.kind === "read").length === 2);
  const reads = replies.filter(reply => reply.kind === "read").map(reply => ({ ids: reply.ids, ...RunSchema.parse(JSON.parse(reply.body ?? "")) }));
  assert.deepEqual(reads, [{ ids: [2], tag: "click", run: 1 }, { ids: [1], tag: "scan", run: 2 }]);
  assert.equal(Atomics.load(gate, SEARCH_READING), 0);
});
