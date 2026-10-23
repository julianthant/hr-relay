import { RunRecordService } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { createNotificationInbox } from "../../../../src/backend/runs/notifications/inbox.js";
import { CONFIG_SNAPSHOT } from "../../fixtures/phase1c-contract-fixtures.js";
import { sequentialIdFactory, QUEUED_RUN } from "../../fixtures/phase1f-run-fixtures.js";
import { testWorkerLifetime, testWorkerPorts } from "../../fixtures/run-lifecycle-fixtures.js";
import { storageRecoveryFixture } from "../integration/storage-recovery-fixture.js";
import { personLookupDescriptor } from "../registered-workflows.js";
import { AuthorityDatabase } from "../synthetic-storage-admission.js";
import { type RunRecord } from "../../../../src/models/run/record.js";





export function createNotificationCompositionTestWorld() {
  async function fixture() {
    const f = storageRecoveryFixture(); await f.run();
    const db = AuthorityDatabase.open({ path: f.path, busyTimeoutMs: 250, migrationOwner: "notification-producers" }, f.clock);
    db.authority.runtimeConfig.initialize(CONFIG_SNAPSHOT);
    testWorkerPorts(db, f.clock, { path: f.path, descriptor: personLookupDescriptor, poolIndex: 1 });
    const reader = new RunRecordService({ database: db, clock: f.clock, ids: sequentialIdFactory("e"), publishQueued: () => {} });
    const inbox = createNotificationInbox({ authority: db, clock: f.clock, ids: sequentialIdFactory("a"), actorId: "local-operator", runReader: reader });
    return { ...f, db, reader, inbox, close: () => { db.close(); f.dispose(); } };
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
        lifecycle: { state, ...(state === "running" ? { currentNodeId: "searching" } : {}), workerId: slot.workerId, claimedAt: run.lifecycle.state === "claimed" ? run.lifecycle.claimedAt : f.clock.now().toISOString(), heartbeatAt: f.clock.now().toISOString() } });
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
