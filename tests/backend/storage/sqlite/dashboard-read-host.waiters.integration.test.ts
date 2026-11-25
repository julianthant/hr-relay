import assert from "node:assert/strict";
import { afterEach, it } from "vitest";
import { z } from "zod";
import { createDashboardReadHost, ReadLaneRestartedError, ReadSupersededError, type DashboardReadLanes } from "../../../../src/backend/storage/sqlite/dashboard-read-host.js";
import { systemClock } from "../../../../src/rules/time/clock.js";
import { LANE_READS_ENTRY, laneFacts, laneMismatchedReply, laneOwnSnapshot, laneSleep } from "../../../support/fixtures/backend/dashboard-lane-reads.js";
import { openBoundDatabaseFixture } from "../../../support/helpers/admission-fixture.js";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

const RunSchema = z.object({ tag: z.string(), run: z.number().int() });
const run = async (reply: ReturnType<DashboardReadLanes["read"]>) => RunSchema.parse(JSON.parse((await reply).body));

async function host(lanes: ("navigation" | "search")[] = ["navigation"]) {
  const fixture = await openBoundDatabaseFixture("read-lane-waiters");
  cleanups.push(() => fixture.close());
  const readLanes = createDashboardReadHost({ admission: fixture.profile.admission, database: fixture.database, clock: systemClock, lanes, entry: LANE_READS_ENTRY });
  cleanups.push(() => readLanes.close());
  await readLanes.ready;
  return readLanes;
}

it("settles a superseded running waiter of one tab while the other tab's running waiter keeps its reply", async () => {
  const lanes = await host();
  const tabA = { subscriberId: "tab-a", slot: "queue.day" }, tabB = { subscriberId: "tab-b", slot: "queue.day" };
  const blocker = lanes.read(laneSleep, { tag: "blocker", ms: 100 });
  // Both tabs join one queued read, which starts when the blocker replies.
  const first = lanes.read(laneSleep, { tag: "day", ms: 300 }, { slot: tabA });
  const second = lanes.read(laneSleep, { tag: "day", ms: 300 }, { slot: tabB });
  assert.equal((await run(blocker)).run, 1);
  // Tab A asks for another day while the shared read runs: only its own waiter is superseded.
  const next = lanes.read(laneSleep, { tag: "next-day", ms: 0 }, { slot: tabA });
  await assert.rejects(first, (error: unknown) => error instanceof ReadSupersededError && error.code === "READ_SUPERSEDED");
  assert.deepEqual(await run(second), { tag: "day", run: 2 });
  assert.deepEqual(await run(next), { tag: "next-day", run: 3 });
});

it("settles a superseded queued waiter and drops a queued read nobody waits for", async () => {
  const lanes = await host();
  const slot = { subscriberId: "tab-a", slot: "run.detail" };
  const blocking = lanes.read(laneSleep, { tag: "blocking", ms: 200 });
  const queued = lanes.read(laneSleep, { tag: "stale", ms: 0 }, { slot });
  const latest = lanes.read(laneSleep, { tag: "latest", ms: 0 }, { slot });
  await assert.rejects(queued, ReadSupersededError);
  assert.equal((await run(blocking)).run, 1);
  // The superseded queued read never ran: the latest one is the lane's second run.
  assert.deepEqual(await run(latest), { tag: "latest", run: 2 });
});

it("detaches an aborted waiter alone and keeps the joined waiter's read", async () => {
  const lanes = await host();
  const controller = new AbortController();
  const blocker = lanes.read(laneSleep, { tag: "blocker", ms: 100 });
  const aborted = lanes.read(laneSleep, { tag: "shared", ms: 0 }, { signal: controller.signal });
  const joined = lanes.read(laneSleep, { tag: "shared", ms: 0 });
  controller.abort(new Error("tab-closed"));
  await assert.rejects(aborted, /tab-closed/u);
  assert.equal((await run(blocker)).run, 1);
  assert.deepEqual(await run(joined), { tag: "shared", run: 2 });
  await assert.rejects(lanes.read(laneSleep, { tag: "pre-aborted", ms: 0 }, { signal: AbortSignal.abort(new Error("already")) }), /already/u);
});

it("joins only an equal read key dispatched no later than the running read began, with an equal process revision", async () => {
  const lanes = await host();
  // Every "join" read has the complete key of the running one, so only the begin-position guard keeps them apart.
  const join = { tag: "join", ms: 250 };
  const running = lanes.read(laneSleep, join);
  await new Promise(resolve => setTimeout(resolve, 50));
  // Dispatched after the running read began: it must not share that read's begin position.
  const late = lanes.read(laneSleep, { ...join });
  const otherKey = lanes.read(laneSleep, { tag: "other", ms: 0 });
  const lateTwin = lanes.read(laneSleep, { ...join });
  assert.deepEqual(await run(running), { tag: "join", run: 1 });
  const [lateRun, otherRun, twinRun] = await Promise.all([run(late), run(otherKey), run(lateTwin)]);
  assert.equal(lateRun.run, 2);
  assert.equal(otherRun.run, 3);
  assert.equal(twinRun.run, lateRun.run, "an equal key still queued joins the queued read");

  // All three queue behind a blocker with equal arguments, so only the process revision keeps A apart from B and C.
  const blocker = lanes.read(laneSleep, { tag: "facts-blocker", ms: 100 });
  const factsA = lanes.read(laneFacts, { tag: "facts", ms: 0 }, { processFacts: { revision: 1, facts: { revision: 1 } } });
  const factsB = lanes.read(laneFacts, { tag: "facts", ms: 0 }, { processFacts: { revision: 2, facts: { revision: 2 } } });
  const factsC = lanes.read(laneFacts, { tag: "facts", ms: 0 }, { processFacts: { revision: 2, facts: { revision: 2 } } });
  await blocker;
  const FactsSchema = RunSchema.extend({ facts: z.strictObject({ revision: z.number() }) });
  const [a, b, c] = (await Promise.all([factsA, factsB, factsC])).map(reply => FactsSchema.parse(JSON.parse(reply.body)));
  assert.deepEqual(a.facts, { revision: 1 });
  assert.deepEqual(b.facts, { revision: 2 });
  assert.notEqual(a.run, b.run);
  assert.equal(b.run, c.run);
  assert.equal((await Promise.all([factsB, factsC]))[0].position.processRevision, 2);
  await assert.rejects(lanes.read(laneFacts, { tag: "facts", ms: 0 }), /read-lane-process-facts-required/u);
});

it("restarts the lane on a reply for a read it never sent and settles the running waiter", async () => {
  const lanes = await host();
  await assert.rejects(lanes.read(laneMismatchedReply, {}), (error: unknown) => error instanceof ReadLaneRestartedError);
  assert.equal(lanes.status().restarts, 1);
  assert.deepEqual(await run(lanes.read(laneSleep, { tag: "after", ms: 0 })), { tag: "after", run: 1 });
});

it("carries the position a read reports from its own snapshot", async () => {
  const lanes = await host();
  const reply = await lanes.read(laneOwnSnapshot, { authorityGeneration: 424_242, changeLogSeq: 4_242 });
  assert.equal(reply.position.authorityGeneration, 424_242);
  assert.equal(reply.position.changeLogSeq, 4_242);
});

it("fails only the waiters of a request the lane cannot be sent and keeps the lane serving", async () => {
  const lanes = await host();
  const unsendable = { revision: 1, facts: { compute: () => 1 } };
  await assert.rejects(lanes.read(laneFacts, { tag: "unsendable", ms: 0 }, { processFacts: unsendable }), (error: unknown) => error instanceof Error && error.name === "DataCloneError");
  assert.deepEqual(await run(lanes.read(laneSleep, { tag: "after", ms: 0 })), { tag: "after", run: 1 });
  assert.equal(lanes.status().restarts, 0);
});
