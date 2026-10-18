import { createDashboardStreamHub } from "../../../../src/backend/transports/http/subscriptions/dashboard-stream.js";
import { RunRecordSchema } from "../../../../src/models/run/record.js";
import { composeQueueSummaries } from "../../../../src/backend/app/composition/dashboard/queue-summaries.js";
import { summaryFixture } from "../../../support/helpers/backend/served-database-surfaces-fixtures.js";
import { personLookupDescriptor } from "../../../support/helpers/registered-workflows.js";
import assert from "node:assert/strict";
import { afterEach, it } from "vitest";
import { createRunQueueProjectionTestWorld } from "../../../support/helpers/backend/run-queue-projection-world.js";
import { seedPersonLookupPresentation } from "../../../support/fixtures/person-lookup-presentation.js";
import { groupQueueAttempts } from "../../../../src/dashboard/surfaces/queue/queue-model.js";
import { uuidOf } from "../../../support/helpers/backend/dashboard-harness.js";

const { world, cleanup } = createRunQueueProjectionTestWorld();
afterEach(cleanup);
it("presents every served same-person attempt across days as one row with an ascending menu", () => {
  const w = world({ descriptors: { resolve: () => personLookupDescriptor } });
  for (let attempt = 1; attempt <= 7; attempt++) seedPersonLookupPresentation(w, {
    seed: 80 + attempt, attempt, itemId: uuidOf(5081),
    enqueuedAt: attempt <= 2 ? `2026-07-31T17:0${attempt}:00.000Z` : `2026-08-03T17:0${attempt}:00.000Z`,
  });
  const day = w.projection.buildDashboardDayWire("2026-08-03");
  assert.equal(day.queueSurfaces.length, 5);
  assert.deepEqual(day.attemptHistory?.map(entry => entry.partitionDay), ["2026-07-31", "2026-07-31"]);
  assert.ok(day.attemptHistory);
  const rows = [...day.queueSurfaces, ...day.attemptHistory.map(entry => entry.surface)];
  assert.equal(rows.length, 7);
  const groups = groupQueueAttempts(rows);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].representative.attempt, 7);
  assert.deepEqual(groups[0].attempts.toReversed().map(row => row.attempt), [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(groups[0].attempts.filter(row => row.attempt <= 2).map(row => row.startedAt.slice(0, 10)), ["2026-07-31", "2026-07-31"]);
});

it("acquires scoped cross-month history through the production batch summary port without whole-history reads", () => {
  const f = summaryFixture();
  try {
    const item = uuidOf(5500);
    for (const [seed, attempt, day, itemId, workflow] of [
      [5511, 1, "2026-07-31", item, "person-lookup"],
      [5512, 2, "2026-08-03", item, "person-lookup"],
      [5513, 3, "2026-09-01", item, "person-lookup"],
      [5514, 1, "2026-07-31", uuidOf(5501), "person-lookup"],
      [5515, 1, "2026-07-31", item, "separations"],
    ] as const) {
      const at = `${day}T17:00:00.000Z`;
      f.db.authority.runs.enqueue(RunRecordSchema.parse({ ...f.run,
        envelope: { ...f.run.envelope, runId: uuidOf(seed), itemId, workflow, attempt, enqueuedAt: at },
        lifecycle: { state: "queued" }, claimGeneration: 0, version: 1, createdAt: at, updatedAt: at,
      }));
    }
    const port = composeQueueSummaries(f.db);
    assert.deepEqual(port.itemAttempts([{ workflowId: "person-lookup", itemId: item, maxAttempt: 2 },
      { workflowId: "separations", itemId: item, maxAttempt: 1 }]).map(run => run.envelope.runId),
    [uuidOf(5511), uuidOf(5512), uuidOf(5515)]);
    f.servedReader.list = () => { throw new Error("whole-history-read-forbidden"); };
    const day = f.projection.buildDashboardDayWire("2026-08-03");
    assert.deepEqual(day.queueSurfaces.map(row => row.runId), [uuidOf(5512)]);
    assert.deepEqual(day.attemptHistory?.map(entry => [entry.surface.runId, entry.partitionDay]), [[uuidOf(5511), "2026-07-31"]]);
    assert.equal(day.workflowCounts.find(count => count.workflowId === "person-lookup")?.count, 1);
    assert.deepEqual(f.projection.buildDashboardDayWire("2026-07-31").attemptHistory, []);
    f.summaries.itemAttempts = () => { throw new Error("synthetic-history-read-failed"); };
    assert.throws(() => f.projection.buildDashboardDayWire("2026-08-03"), /synthetic-history-read-failed/u);
  } finally { f.dispose(); }
});

it("refreshes later-day history after an earlier attempt changes without changing selected-day counts", async () => {
  const w = world({ descriptors: { resolve: () => personLookupDescriptor } });
  const first = seedPersonLookupPresentation(w, { seed: 611, itemId: uuidOf(5600), enqueuedAt: "2026-07-31T17:00:00.000Z" });
  seedPersonLookupPresentation(w, { seed: 612, attempt: 2, itemId: uuidOf(5600), enqueuedAt: "2026-08-03T17:00:00.000Z" });
  const before = w.projection.buildDashboardDayWire("2026-08-03");
  const hub = createDashboardStreamHub({ projection: w.projection, backfillGaps: { detected: async () => { throw new Error("unexpected-backfill-gap"); } } });
  const connection = await hub.connect({ day: "2026-08-03" });
  const publications: string[] = [];
  const unsubscribe = w.projection.onChange(change => publications.push(change.kind));
  try {
    w.authority.put(RunRecordSchema.parse({ ...first.run, completion: undefined, version: first.run.version + 1,
      lifecycle: { state: "terminal", outcome: "cancelled", endedAt: "2026-07-31T17:01:00.000Z" } }));
    w.projection.refreshRun(first.run.envelope.runId);
    assert.ok(publications.includes("snapshot"));
    assert.equal(connection.pending, 1);
    const publication = await connection.next();
    assert.ok(publication?.type === "snapshot" && publication.topic === "dashboard-day");
    assert.equal(publication.payload.attemptHistory?.[0]?.surface.status, "cancelled");
    assert.equal(publication.payload.attemptHistory?.[0]?.surface.rowRevision, first.run.version + 1);
    assert.equal(publication.payload.projectionGeneration, w.projection.generation());
    assert.equal(publication.cursor, w.projection.cursor());
    const next = w.projection.buildDashboardDayWire("2026-08-03");
    assert.equal(next.attemptHistory?.[0]?.surface.status, "cancelled");
    assert.deepEqual(next.workflowCounts, before.workflowCounts);
    assert.deepEqual(next.monthCounts, before.monthCounts);
    assert.deepEqual(next.queueSurfaces, before.queueSurfaces);
  } finally { unsubscribe(); connection.close(); hub.close(); }
});
