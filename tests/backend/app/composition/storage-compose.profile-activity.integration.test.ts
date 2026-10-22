import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { it } from "vitest";
import { composeProfileActivity, composeSelectedProfileStorage } from "../../../../src/backend/app/composition/storage-compose.js";
import { RunRecordService } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { admitDirectWorker } from "../../../../src/backend/storage/sqlite/worker-slots.js";
import { acquireRuntimeProcessLock, bindWorkerProcessAdmission } from "../../../../src/backend/storage/sqlite/runtime-process-locks.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { boundProfileCredentials, createBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";

function fixture() {
  const f = createBoundProfileFixture();
  const clock = manualClock(new Date("2026-10-21T12:00:00.000Z"));
  const context = composeSelectedProfileStorage({ machineAdmission: f.machine, admission: f.admission, credentials: boundProfileCredentials(f.admission), clock, hostFacts: { primaryDisplay: null } });
  const lifecycle = new RunRecordService({ database: context.database, clock, ids: { uuid: randomUUID }, publishQueued: () => { throw new Error("activity proof cannot enqueue"); } });
  const processLockRoot = join(f.workspace, "process-locks");
  const supervisor = { memberEvidence: () => undefined, drainOwnedChildren: async () => undefined };
  const input = { admission: f.admission, database: context.database, clock, processLockRoot, lifecycle, supervisor };
  return { ...f, context, input, async cleanup() { await context.account.close(); context.database.close(); f.close(); } };
}

it("observes actual empty canonical owners and awaits synthetic drain scheduling without certifying real browser closure", async () => {
  const f = fixture();
  let settle: (() => void) | undefined;
  const completion = new Promise<void>(resolve => { settle = resolve; });
  try {
    const activity = composeProfileActivity({ ...f.input, supervisor: { ...f.input.supervisor, drainOwnedChildren: () => completion } });
    const profileId = f.admission.profileBinding.profileId;
    assert.equal(activity.hasUnquiescedWork(profileId), false);
    assert.throws(() => activity.hasUnquiescedWork(randomUUID()), /owner-mismatch/u);
    activity.requestCancellation(profileId);
    assert.equal(activity.hasUnquiescedWork(profileId), true);
    assert.ok(settle); settle();
    await completion;
    assert.equal(activity.hasUnquiescedWork(profileId), false);
  } finally { settle?.(); await f.cleanup(); }
});

it("refuses unknown OS identity and a missing process close acknowledgement after a genuine record positive", async () => {
  const f = fixture();
  const record = acquireRuntimeProcessLock({ processLockRoot: f.input.processLockRoot, name: "workers", pid: process.pid,
    admission: { kind: "unbound-worker", authorityPath: f.path } }, f.input.clock);
  try {
    const profileId = f.admission.profileBinding.profileId;
    assert.equal(composeProfileActivity(f.input).hasUnquiescedWork(profileId), true);
    const unknown = composeProfileActivity({ ...f.input, observeProcessIdentity: () => { throw new Error("synthetic process identity unavailable"); } });
    assert.throws(() => unknown.hasUnquiescedWork(profileId), /identity unavailable/u);
    const missingAck = composeProfileActivity({ ...f.input, observeProcessIdentity: () => ({ state: "gone" }) });
    assert.throws(() => missingAck.hasUnquiescedWork(profileId), /closure-unproved/u);
  } finally { record.release(); await f.cleanup(); }
});

it("includes an idle owned lifetime and refuses absent supervisor acknowledgement", async () => {
  const f = fixture();
  let worker: ReturnType<typeof bindWorkerProcessAdmission> | undefined;
  try {
    const profileId = f.admission.profileBinding.profileId;
    assert.equal(composeProfileActivity(f.input).hasUnquiescedWork(profileId), false);
    worker = bindWorkerProcessAdmission({ processLockRoot: f.input.processLockRoot, authorityPath: f.path, pid: process.pid, clock: f.input.clock,
      open: () => f.context.database, close: () => undefined,
      admit: (_database, acquisitionId) => f.context.database.withAuthorityTransaction(repositories => admitDirectWorker(repositories, {
        commandId: randomUUID(), workflow: "person-lookup", poolIndex: 1, expectedPoolVersion: 0, processId: process.pid,
        processAcquisitionId: acquisitionId, authorityPath: f.path, processLockRoot: f.input.processLockRoot, now: f.input.clock.now().toISOString(),
      }, randomUUID()).workerId),
    });
    const started = f.context.database.startOwnedWorker({ workerId: worker.workerId, workflow: "person-lookup", browserSystems: ["crm"],
      processId: process.pid, requestedBy: "local-operator", now: f.input.clock.now().toISOString() }, worker.processLock);
    assert.equal(started.state, "started");
    const custody = f.context.database.readProfileResourceCustody();
    assert.equal(custody.slots.length, 1);
    assert.equal(custody.leases.length, 1);
    assert.throws(() => composeProfileActivity(f.input).hasUnquiescedWork(profileId), /supervisor-custody-unavailable/u);
  } finally { worker?.processLock.release(); await f.cleanup(); }
});
