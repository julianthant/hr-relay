import { RunRecordService } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { createNotificationInbox } from "../../../../src/backend/runs/notifications/inbox.js";
import { CONFIG_SNAPSHOT } from "../../fixtures/phase1c-contract-fixtures.js";
import { sequentialIdFactory, QUEUED_RUN } from "../../fixtures/phase1f-run-fixtures.js";
import { testWorkerLifetime, testWorkerPorts } from "../../fixtures/run-lifecycle-fixtures.js";
import { personLookupDescriptor } from "../registered-workflows.js";
import { openBoundDatabaseFixture, createBoundProfileFixture, type BoundProfileStorageFixture } from "../admission-fixture.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { type RunRecord } from "../../../../src/models/run/record.js";





export function createNotificationCompositionTestWorld(profileFixture: () => Promise<BoundProfileStorageFixture> = createBoundProfileFixture) {
  async function fixture() {
    const clock = manualClock(new Date("2026-09-10T20:00:00.000Z"));
    const opened = await openBoundDatabaseFixture("notification-producers", clock, undefined, undefined, undefined, undefined, profileFixture);
    const db = opened.database;
    db.authority.runtimeConfig.initialize(CONFIG_SNAPSHOT);
    testWorkerPorts(db, clock, { path: opened.path, descriptor: personLookupDescriptor, poolIndex: 1 });
    const reader = new RunRecordService({ database: db, clock, ids: sequentialIdFactory("e"), publishQueued: () => {} });
    const inbox = createNotificationInbox({ authority: db, clock, ids: sequentialIdFactory("a"), actorId: "local-operator", runReader: reader });
    return { root: opened.stateRoot, path: opened.path, clock, db, reader, inbox, close: async () => await opened.close(), dispose: async () => await opened.close() };
  }

  function seedRun(f: Awaited<ReturnType<typeof fixture>>, desired: RunRecord) {
    const active = f.db.authority.runtimeConfig.get();
    if (active === undefined) throw new Error("missing fixture settings");
    const queued = { ...QUEUED_RUN, envelope: { ...QUEUED_RUN.envelope,
      runId: desired.envelope.runId, itemId: desired.envelope.itemId,
      traceId: desired.envelope.traceId, descriptorVersion: personLookupDescriptor.version, contractFingerprint: personLookupDescriptor.contractFingerprint,
      configFingerprint: active.configFingerprint, configSnapshotId: active.configSnapshotId } };
    f.db.authority.runs.enqueue(queued);
    if (desired.lifecycle.state === "queued") return f.db.authority.runs.get(queued.envelope.runId)!;
    const slot = f.db.authority.workerSlots.list("person-lookup")[0];
    const claimMember1 = f.db.authority.workerSlots.get(slot.workerId);
    if (claimMember1 === undefined) throw new Error("fixture-claim-member-required");
    const claim = f.db.authority.runs.claimNext({ workerLifetime: testWorkerLifetime(f.db, "person-lookup", claimMember1.poolIndex).workerLifetime, workflow: "person-lookup", workerId: slot.workerId, now: f.clock.now().toISOString() });
    if (claim.state !== "claimed") throw new Error("fixture claim refused");
    let run = claim.run;
    for (const state of ["validating", "running"] as const) {
      const result = f.db.authority.runs.transition({ runId: run.envelope.runId, expectedVersion: run.version,
        claim: { workerId: slot.workerId, claimGeneration: run.claimGeneration }, now: f.clock.now().toISOString(),
        lifecycle: { state, ...(state === "running" ? { currentNodeId: "searching" } : {}), workerId: slot.workerId, workerLifetime: testWorkerLifetime(f.db, "person-lookup", claimMember1.poolIndex).workerLifetime, claimedAt: run.lifecycle.state === "claimed" ? run.lifecycle.claimedAt : f.clock.now().toISOString(), heartbeatAt: f.clock.now().toISOString() } });
      if (result.state !== "applied") throw new Error("fixture transition refused");
      run = result.run;
    }
    if (desired.lifecycle.state === "parked-gate") {
      const result = f.db.authority.runs.transition({ runId: run.envelope.runId, expectedVersion: run.version,
        claim: { workerId: slot.workerId, claimGeneration: run.claimGeneration }, now: f.clock.now().toISOString(), lifecycle: desired.lifecycle });
      if (result.state !== "applied") throw new Error("fixture park refused");
      return result.run;
    }
    return run;
  }
  return { fixture, seedRun };
}
