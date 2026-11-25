import assert from "node:assert/strict";
import { afterEach, it } from "vitest";
import { z } from "zod";
import { createNoteTimelineWriter } from "../../../../src/backend/storage/events/note-timeline-writer.js";
import { createDashboardReadHost, ReadLaneRestartedError, type DashboardReadReply } from "../../../../src/backend/storage/sqlite/dashboard-read-host.js";
import { systemClock } from "../../../../src/rules/time/clock.js";
import { LANE_READS_ENTRY, laneBackground, laneSearch, laneSleep, laneStuck } from "../../../support/fixtures/backend/dashboard-lane-reads.js";
import { openBoundDatabaseFixture } from "../../../support/helpers/admission-fixture.js";

const cleanups: (() => Promise<void>)[] = [];
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

it("dispatches a queued click before the next background message after a background reply", async () => {
  const { lanes } = await host();
  const scan = lanes.read(laneBackground, { tag: "scan", ms: 150 });
  // The lane picks its own next message, so the scan must be running before the others arrive for it to go first.
  await new Promise(resolve => setTimeout(resolve, 50));
  const nextScan = lanes.read(laneBackground, { tag: "next-scan", ms: 0 });
  const click = lanes.read(laneSleep, { tag: "click", ms: 0 });
  assert.deepEqual(await Promise.all([run(scan), run(click), run(nextScan)]), [1, 2, 3]);
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
