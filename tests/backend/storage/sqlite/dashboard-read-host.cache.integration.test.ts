import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { afterEach, it } from "vitest";
import { z } from "zod";
import { createNoteTimelineWriter } from "../../../../src/backend/storage/events/note-timeline-writer.js";
import { createDashboardReadHost, type DashboardReadReply } from "../../../../src/backend/storage/sqlite/dashboard-read-host.js";
import { manualClock, systemClock } from "../../../../src/rules/time/clock.js";
import { LANE_READS_ENTRY, lanePool, lanePoolExpiring } from "../../../support/fixtures/backend/dashboard-lane-reads.js";
import { openBoundDatabaseFixture } from "../../../support/helpers/admission-fixture.js";

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

const WORKFLOW = "person-lookup";
const PoolBodySchema = z.strictObject({ run: z.number().int(), desiredWorkers: z.number().int() });
const body = (reply: DashboardReadReply) => PoolBodySchema.parse(JSON.parse(reply.body));

async function cacheHost() {
  const fixture = await openBoundDatabaseFixture("read-lane-cache");
  cleanups.push(() => fixture.close());
  const clock = manualClock(new Date("2026-11-25T12:00:00.000Z"));
  const lanes = createDashboardReadHost({ admission: fixture.profile.admission, database: fixture.database, clock, lanes: ["navigation"], entry: LANE_READS_ENTRY });
  cleanups.push(() => lanes.close());
  const peer = new DatabaseSync(fixture.path);
  cleanups.push(() => { peer.close(); });
  const database = fixture.database;
  const note = (message: string) => createNoteTimelineWriter({ repository: database.authority.timelineEvents, clock: systemClock })
    .emitNote({ workflow: WORKFLOW, address: { workerId: "worker-1", spanPath: "worker-1" }, level: "step", message });
  const plan = (desiredWorkers: number) => {
    const current = database.authority.workerPools.get(WORKFLOW);
    assert.equal(database.authority.workerPools.plan({ workflow: WORKFLOW, desiredWorkers, expectedVersion: current?.version ?? 0,
      requestedBy: "local-operator", now: systemClock.now().toISOString() }).state, "applied");
  };
  return { lanes, clock, peer, note, plan };
}

it("reuses an entry across a write to an undeclared table, re-stamped at the new change-log position", async () => {
  const { lanes, note } = await cacheHost();
  const first = await lanes.read(lanePool, { workflow: WORKFLOW });
  assert.equal(first.cached, false);
  note("undeclared");
  const reused = await lanes.read(lanePool, { workflow: WORKFLOW });
  assert.equal(reused.cached, true);
  assert.equal(reused.body, first.body);
  assert.ok(reused.position.changeLogSeq > first.position.changeLogSeq);
  assert.ok(reused.position.authorityGeneration > first.position.authorityGeneration);
  // The re-stamped entry serves the next dispatch from its new position.
  const again = await lanes.read(lanePool, { workflow: WORKFLOW });
  assert.equal(again.cached, true);
  assert.deepEqual(again.position, reused.position);
  assert.deepEqual(body(again), { run: 1, desiredWorkers: 0 });
});

it("rebuilds an entry after a write to a declared table", async () => {
  const { lanes, plan } = await cacheHost();
  assert.deepEqual(body(await lanes.read(lanePool, { workflow: WORKFLOW })), { run: 1, desiredWorkers: 0 });
  plan(2);
  const rebuilt = await lanes.read(lanePool, { workflow: WORKFLOW });
  assert.equal(rebuilt.cached, false);
  assert.deepEqual(body(rebuilt), { run: 2, desiredWorkers: 2 });
});

it("rebuilds an entry whose change-log interval was pruned", async () => {
  const { lanes, note, peer } = await cacheHost();
  const first = await lanes.read(lanePool, { workflow: WORKFLOW });
  note("before prune");
  note("pruned away");
  peer.prepare("DELETE FROM authority_changes WHERE seq<=?").run(first.position.changeLogSeq + 1);
  const rebuilt = await lanes.read(lanePool, { workflow: WORKFLOW });
  assert.equal(rebuilt.cached, false);
  assert.equal(body(rebuilt).run, 2);
});

it("rebuilds an entry whose change-log interval runs backwards", async () => {
  const { lanes, note, peer } = await cacheHost();
  note("first");
  const first = await lanes.read(lanePool, { workflow: WORKFLOW });
  assert.ok(first.position.changeLogSeq > 0);
  peer.prepare("DELETE FROM authority_changes WHERE seq>=?").run(first.position.changeLogSeq);
  peer.prepare("UPDATE sqlite_sequence SET seq=? WHERE name='authority_changes'").run(first.position.changeLogSeq - 1);
  const rebuilt = await lanes.read(lanePool, { workflow: WORKFLOW });
  assert.equal(rebuilt.cached, false);
  assert.ok(rebuilt.position.changeLogSeq < first.position.changeLogSeq);
  assert.equal(body(rebuilt).run, 2);
});

it("rebuilds an expired entry", async () => {
  const { lanes, clock } = await cacheHost();
  const first = await lanes.read(lanePoolExpiring, { workflow: WORKFLOW });
  assert.equal(first.position.validUntil, clock.nowMs() + 1_000);
  clock.advanceWall(999);
  assert.equal((await lanes.read(lanePoolExpiring, { workflow: WORKFLOW })).cached, true);
  clock.advanceWall(1);
  const expired = await lanes.read(lanePoolExpiring, { workflow: WORKFLOW });
  assert.equal(expired.cached, false);
  assert.equal(body(expired).run, 2);
});
