import assert from "node:assert/strict";
import { afterAll, afterEach, describe, it } from "vitest";
import { createProfileFixtureSet } from "../../../support/helpers/admission-fixture.js";
import { createRunQueueProjectionTestWorld } from "../../../support/helpers/backend/run-queue-projection-world.js";
import { claimEventOf, DAY, declareProjectionWorker, instantOffsetOf, taskEventsOf, traceOf, uuidOf, workerLeaseOf,
  type DashboardWorld } from "../../../support/helpers/backend/dashboard-harness.js";
import { personLookupDescriptor } from "../../../support/helpers/registered-workflows.js";

const profileFixtures = createProfileFixtureSet();
afterAll(() => profileFixtures.close());
const { world, cleanup, queuedEventOf, runRecordOf } = createRunQueueProjectionTestWorld(profileFixtures.create);
afterEach(cleanup);

const workerId = "person-lookup-worker-1";
const startedAt = instantOffsetOf(0);
const ENDED = "2026-08-03T17:14:30.000Z";
const stoppedLease = () => workerLeaseOf({ workerId, directive: "stop",
  lifecycle: { state: "stopped", startedAt, stoppedAt: instantOffsetOf(0, 60_000), reason: "crashed" } });

function endRun(w: DashboardWorld, seed: number, outcome: "done" | "cancelled", descriptor = true): void {
  w.writer.emit({ t: "span.ended", kind: "run", ts: w.clock.now().toISOString(), workflow: "person-lookup",
    runId: uuidOf(seed), attempt: 1, traceId: traceOf(seed), spanPath: traceOf(seed), outcome });
  w.authority.put(runRecordOf({ seed, lifecycle: { state: "terminal", outcome, endedAt: ENDED }, version: 3,
    ...(descriptor ? { descriptor: personLookupDescriptor } : {}) }));
}

describe("worker card data the Sessions panel reads", () => {
  it("serves an idle card's last run outcome and step after the projection is rebuilt", async () => {
    const w = await world({ descriptors: { resolve: () => personLookupDescriptor } });
    declareProjectionWorker(w.authority, workerId, 1);
    queuedEventOf(w, { seed: 1, descriptor: personLookupDescriptor });
    claimEventOf(w, 1);
    taskEventsOf(w, 1, "active-status", "done");
    taskEventsOf(w, 1, "crm-dates", "skipped", "condition-false");
    endRun(w, 1, "done");
    w.authority.putWorkerLease(workerLeaseOf({ workerId }));
    const stepStartedAt = w.clock.now().toISOString();
    w.projection.rebuildFromTimeline();
    const card = w.projection.buildDashboardDayWire(DAY).workerCards[0];
    assert.deepEqual(card?.lastRun, { state: "present", runId: uuidOf(1), traceId: traceOf(1), outcome: "done", endedAt: ENDED,
      step: { nodeId: "crm-dates", taskId: "crm/read-onboarding-dates", state: "done", startedAt: stepStartedAt } });
    assert.deepEqual(card?.timeline, { state: "present" });
  });

  it("names the step a crashed worker died in while its run is still unsettled", async () => {
    const w = await world({ descriptors: { resolve: () => personLookupDescriptor } });
    declareProjectionWorker(w.authority, workerId, 1);
    queuedEventOf(w, { seed: 2, descriptor: personLookupDescriptor, claimGeneration: 1, version: 2, lifecycle: { state: "running", workerId,
      claimedAt: startedAt, heartbeatAt: startedAt, workerLifetime: { membershipRevision: 1, leaseGeneration: 1 } } });
    claimEventOf(w, 2);
    taskEventsOf(w, 2, "active-status", "done");
    taskEventsOf(w, 2, "crm-dates");
    w.authority.put(runRecordOf({ seed: 2, descriptor: personLookupDescriptor, claimGeneration: 1, version: 3, lifecycle: { state: "queued" } }));
    w.authority.putWorkerLease(stoppedLease());
    const card = w.projection.buildDashboardDayWire(DAY).workerCards[0];
    assert.equal(card?.state, "failed");
    assert.equal(card?.lastRun?.state, "present");
    if (card?.lastRun?.state !== "present") return;
    assert.equal(card.lastRun.outcome, undefined);
    assert.equal(card.lastRun.step?.nodeId, "crm-dates");
    assert.equal(card.lastRun.step?.state, "open");
  });

  it("serves each timeline unavailable reason for its case", async () => {
    const cases: [string, (w: DashboardWorld) => void, string | undefined][] = [
      ["run-not-in-day", w => {
        queuedEventOf(w, { seed: 3, descriptor: personLookupDescriptor, enqueuedAt: "2026-08-01T17:00:00.000Z" });
        claimEventOf(w, 3); taskEventsOf(w, 3, "active-status", "done"); endRun(w, 3, "done");
        w.authority.put(runRecordOf({ seed: 3, descriptor: personLookupDescriptor, enqueuedAt: "2026-08-01T17:00:00.000Z",
          lifecycle: { state: "terminal", outcome: "done", endedAt: ENDED }, version: 3 }));
      }, undefined],
      ["timeline-incompatible", w => {
        queuedEventOf(w, { seed: 4 });
        claimEventOf(w, 4); taskEventsOf(w, 4, "ghost-step", "done"); endRun(w, 4, "cancelled", false);
      }, undefined],
      ["no-steps-recorded", w => { queuedEventOf(w, { seed: 5 }); claimEventOf(w, 5); endRun(w, 5, "cancelled", false); }, "none"],
      ["run-unavailable", w => { queuedEventOf(w, { seed: 6 }); claimEventOf(w, 6); w.authority.records.delete(uuidOf(6)); }, "none"],
    ];
    for (const [reason, seed, descriptors] of cases) {
      const w = await world({ descriptors: { resolve: () => descriptors === "none" ? undefined : personLookupDescriptor } });
      declareProjectionWorker(w.authority, workerId, 1);
      seed(w);
      w.authority.putWorkerLease(workerLeaseOf({ workerId }));
      const day = w.projection.buildDashboardDayWire(DAY);
      assert.deepEqual(day.workerCards[0]?.timeline, { state: "unavailable", reason }, reason);
    }
    const fresh = await world();
    declareProjectionWorker(fresh.authority, workerId, 1);
    fresh.authority.putWorkerLease(workerLeaseOf({ workerId }));
    const card = fresh.projection.buildDashboardDayWire(DAY).workerCards[0];
    assert.deepEqual(card?.lastRun, { state: "unavailable", reason: "no-run-recorded" });
    assert.equal(card?.timeline, undefined);
  });

  it("serves a card that fails to build as unavailable while its siblings render and worker authority stays present", async () => {
    const w = await world();
    declareProjectionWorker(w.authority, workerId, 1);
    declareProjectionWorker(w.authority, "person-lookup-worker-2", 2);
    w.authority.putWorkerLease(workerLeaseOf({ workerId }));
    w.authority.putWorkerLease(workerLeaseOf({ workerId: "person-lookup-worker-2" }));
    w.authority.workerOwners.delete(`${workerId}:1:4242:${startedAt}`);
    const day = w.projection.buildDashboardDayWire(DAY);
    assert.equal(day.workerAuthority.state, "present");
    assert.deepEqual(day.workerCards.map(card => [card.workerId, card.availability]), [["person-lookup-worker-2", { state: "available" }]]);
    assert.deepEqual(day.unavailableWorkerCards?.map(card => [card.workerId, card.availability]),
      [[workerId, { state: "unavailable", reason: "worker-current-owner-unavailable" }]]);
  });
});
