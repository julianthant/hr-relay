import assert from "node:assert/strict";
import { afterAll, afterEach, describe, it } from "vitest";
import { createProfileFixtureSet } from "../../../support/helpers/admission-fixture.js";
import { createRunQueueProjectionTestWorld } from "../../../support/helpers/backend/run-queue-projection-world.js";
import { claimEventOf, DAY, declareProjectionWorker, instantOffsetOf, taskEventsOf, traceOf, uuidOf, workerMemberOf,
  type DashboardWorld } from "../../../support/helpers/backend/dashboard-harness.js";
import { WorkerBrowserObservationSchema } from "../../../../src/models/run/worker-control.js";
import { personLookupDescriptor } from "../../../support/helpers/registered-workflows.js";
import { WRITE_FIXTURE_NODE_ID, writeFixtureDescriptor, WriteFixturePrepare } from "../../../support/fixtures/write-sequencer-fixtures.js";

const profileFixtures = createProfileFixtureSet();
afterAll(() => profileFixtures.close());
const { world, cleanup, queuedEventOf, runRecordOf } = createRunQueueProjectionTestWorld(profileFixtures.create);
afterEach(cleanup);

const workerId = "person-lookup-worker-1";
const startedAt = instantOffsetOf(0);
const ENDED = "2026-08-03T17:14:30.000Z";
const crashedMember = (w: DashboardWorld) => workerMemberOf(w.authority, { workerId, state: "exited",
  exit: { code: null, signal: "SIGKILL", at: instantOffsetOf(0, 60_000), outcome: "crashed", settlement: "settled" } });

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
    w.authority.putWorkerMember(workerMemberOf(w.authority, { workerId }));
    const stepStartedAt = w.clock.now().toISOString();
    w.projection.rebuildFromTimeline();
    const card = w.projection.buildDashboardDayWire(DAY).workerCards[0];
    assert.deepEqual(card?.lastRun, { state: "present", runId: uuidOf(1), traceId: traceOf(1), outcome: "done", endedAt: ENDED,
      step: { nodeId: "crm-dates", taskId: "crm/read-onboarding-dates", state: "done", startedAt: stepStartedAt } });
    assert.deepEqual(card?.timeline, { state: "present" });
  });

  it("names the transaction task a last run ended in from its claim-generation span path", async () => {
    const w = await world({ descriptors: { resolve: () => writeFixtureDescriptor } });
    declareProjectionWorker(w.authority, workerId, 1);
    queuedEventOf(w, { seed: 3, descriptor: writeFixtureDescriptor });
    claimEventOf(w, 3);
    const base = { ts: w.clock.now().toISOString(), workflow: "person-lookup", runId: uuidOf(3), attempt: 1, traceId: traceOf(3) } as const;
    for (const role of ["probe", "prepare"]) {
      const spanPath = `${traceOf(3)}/${WRITE_FIXTURE_NODE_ID}/${role}#2`;
      w.writer.emit({ ...base, t: "span.started", kind: "task", spanPath, parentSpanPath: traceOf(3), name: role });
      w.writer.emit({ ...base, t: "span.ended", kind: "task", spanPath, outcome: "done" });
    }
    w.writer.emit({ ...base, t: "span.ended", kind: "run", spanPath: traceOf(3), outcome: "done" });
    w.authority.put(runRecordOf({ seed: 3, lifecycle: { state: "terminal", outcome: "done", endedAt: ENDED }, version: 3, descriptor: writeFixtureDescriptor }));
    w.authority.putWorkerMember(workerMemberOf(w.authority, { workerId }));
    const card = w.projection.buildDashboardDayWire(DAY).workerCards[0];
    assert.ok(card?.lastRun?.state === "present");
    assert.deepEqual(card.lastRun.step, { nodeId: WRITE_FIXTURE_NODE_ID, taskId: String(WriteFixturePrepare.id), state: "done", startedAt: base.ts });
  });

  it("names the step a crashed worker died in while its run is still unsettled", async () => {
    const w = await world({ descriptors: { resolve: () => personLookupDescriptor } });
    declareProjectionWorker(w.authority, workerId, 1);
    queuedEventOf(w, { seed: 2, descriptor: personLookupDescriptor, claimGeneration: 1, version: 2, lifecycle: { state: "running", workerId,
      claimedAt: startedAt, heartbeatAt: startedAt } });
    claimEventOf(w, 2);
    taskEventsOf(w, 2, "active-status", "done");
    taskEventsOf(w, 2, "crm-dates");
    w.authority.put(runRecordOf({ seed: 2, descriptor: personLookupDescriptor, claimGeneration: 1, version: 3, lifecycle: { state: "queued" } }));
    w.authority.putWorkerMember(crashedMember(w));
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
      w.authority.putWorkerMember(workerMemberOf(w.authority, { workerId }));
      const day = w.projection.buildDashboardDayWire(DAY);
      assert.deepEqual(day.workerCards[0]?.timeline, { state: "unavailable", reason }, reason);
    }
    const fresh = await world();
    declareProjectionWorker(fresh.authority, workerId, 1);
    fresh.authority.putWorkerMember(workerMemberOf(fresh.authority, { workerId }));
    const card = fresh.projection.buildDashboardDayWire(DAY).workerCards[0];
    assert.deepEqual(card?.lastRun, { state: "unavailable", reason: "no-run-recorded" });
    assert.equal(card?.timeline, undefined);
  });

  it("serves a card that fails to build as unavailable while its siblings render and worker authority stays present", async () => {
    const w = await world();
    declareProjectionWorker(w.authority, workerId, 1);
    declareProjectionWorker(w.authority, "person-lookup-worker-2", 2);
    const own = workerMemberOf(w.authority, { workerId });
    w.authority.putWorkerMember({ ...own, member: { ...own.member, workflowId: "emergency-contact" } });
    w.authority.putWorkerMember(workerMemberOf(w.authority, { workerId: "person-lookup-worker-2" }));
    const day = w.projection.buildDashboardDayWire(DAY);
    assert.equal(day.workerAuthority.state, "present");
    assert.deepEqual(day.workerCards.map(card => [card.workerId, card.availability]), [["person-lookup-worker-2", { state: "available" }]]);
    assert.deepEqual(day.unavailableWorkerCards?.map(card => [card.workerId, card.availability]),
      [[workerId, { state: "unavailable", reason: "worker-member-authority-unavailable" }]]);
  });

  it("serves needs-duo only for a system whose live Duo lease the worker holds", async () => {
    const w = await world();
    declareProjectionWorker(w.authority, workerId, 1);
    const browser = (system: string, sessionId: string) => WorkerBrowserObservationSchema.parse({ workerId, sessionId, system, configFingerprint: "a".repeat(64),
      signInFingerprint: "b".repeat(64), browserMode: "headless", acceptDownloads: false, exclusive: false, health: "starting",
      observedAt: startedAt, openedAt: startedAt, profileRevision: 1 });
    w.authority.putWorkerMember(workerMemberOf(w.authority, { workerId, browsers: [browser("ucpath", uuidOf(61)), browser("crm", uuidOf(62))] }));
    let held: readonly string[] = ["ucpath"];
    Object.assign(w.authority, { heldDuoSystems: () => held });
    const signIns = () => w.projection.buildDashboardDayWire(DAY).workerCards[0]?.browsers.map(item => [item.system, item.signIn]);
    assert.deepEqual(signIns(), [["ucpath", "needs-duo"], ["crm", "signing-in"]]);
    held = [];
    assert.deepEqual(signIns(), [["ucpath", "signing-in"], ["crm", "signing-in"]]);
  });

  it("serves a dead worker's last browsers and last run while browsers stays empty", async () => {
    const w = await world({ descriptors: { resolve: () => personLookupDescriptor } });
    declareProjectionWorker(w.authority, workerId, 1);
    queuedEventOf(w, { seed: 7, descriptor: personLookupDescriptor });
    claimEventOf(w, 7);
    taskEventsOf(w, 7, "active-status", "done");
    endRun(w, 7, "cancelled");
    const dead = crashedMember(w);
    w.authority.putWorkerMember({ ...dead, browsers: [WorkerBrowserObservationSchema.parse({ workerId, sessionId: uuidOf(63), system: "crm", configFingerprint: "a".repeat(64),
      signInFingerprint: "b".repeat(64), browserMode: "headless", acceptDownloads: false, exclusive: false, health: "authenticated",
      observedAt: startedAt, openedAt: startedAt, profileRevision: 1 })] });
    const card = w.projection.buildDashboardDayWire(DAY).workerCards[0];
    assert.equal(card?.state, "failed");
    assert.deepEqual(card?.browsers, []);
    assert.deepEqual(card?.lastBrowsers?.map(browser => [browser.system, browser.signIn]), [["crm", "signed-in"]]);
    assert.equal(card?.lastRun?.state, "present");
    assert.deepEqual(card?.availability, { state: "available" });
  });
});
