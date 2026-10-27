import { testAdmittedWorker } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach,it,vi } from "vitest";
import { requireLifecycleApplied } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { selectRunRuntime } from "../../../../src/backend/runs/settings/run-settings.js";
import { settingsFixture } from "../../../support/helpers/backend/settings-activation-fixture.js";
const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); vi.restoreAllMocks(); });
async function fixture(isolateBrowser = false) {
  const f = await settingsFixture(isolateBrowser); cleanups.push(f.close);
  const workers = [1, 2].map(poolIndex => testAdmittedWorker(f.database, f.clock,
    { path: f.path, workflow: "person-lookup", poolIndex, browserSystems: ["ucpath", "crm"] }));
  return { ...f, workers };
}
it("current authorization claims old and new queued snapshots and still refuses stale tokens and owners", async () => {
  const f = await fixture(); const old = f.create(); const token = selectRunRuntime(f.database.authority);
  f.save({ "timeouts.taskMs": { set: 90_000 } }); const next = f.create();
  const claim = (poolIndex: number, runtimeConfig = selectRunRuntime(f.database.authority)) => {
    const worker = f.workers[poolIndex - 1]; assert.ok(worker);
    return f.service.claimNext({ commandId: randomUUID(), workflow: "person-lookup",
      workerId: worker.workerId, workerLifetime: worker.workerLifetime, runtimeConfig });
  };
  assert.deepEqual(claim(1, token), { state: "refused", refusal: { reason: "runtime-stale" } });
  const first = requireLifecycleApplied(claim(1));
  const second = requireLifecycleApplied(claim(2));
  assert.deepEqual(new Set([first.envelope.configSnapshotId, second.envelope.configSnapshotId]),
    new Set([old.envelope.configSnapshotId, next.envelope.configSnapshotId]));
  assert.deepEqual(claim(1), { state: "refused", refusal: { reason: "worker-busy", runId: first.envelope.runId } });
  const now = f.clock.now().toISOString();
  const request = { commandId: randomUUID(), runId: first.envelope.runId, expectedVersion: first.version,
    claim: { workerId: f.workers[1].workerId, claimGeneration: first.claimGeneration },
    lifecycle: { state: "validating", workerId: f.workers[0].workerId, workerLifetime: f.workers[0].workerLifetime, claimedAt: now, heartbeatAt: now } };
  assert.equal(f.service.workerTransition(request).state, "refused");
  const validated = requireLifecycleApplied(f.service.workerTransition({ ...request, commandId: randomUUID(),
    claim: { workerId: f.workers[0].workerId, claimGeneration: first.claimGeneration } }));
  assert.deepEqual(validated.envelope, first.envelope);
});

it("pause/requeue then resume keeps the same run configuration and rejects the former claim", async () => {
  const f = await fixture(); const original = f.create();
  const claim = requireLifecycleApplied(f.service.claimNext({ commandId: randomUUID(), workflow: "person-lookup", workerId: f.workers[0].workerId, workerLifetime: f.workers[0].workerLifetime,
    runtimeConfig: selectRunRuntime(f.database.authority) }));
  const fence = { workerId: f.workers[0].workerId, claimGeneration: claim.claimGeneration };
  const recovery = f.service.requeue({ commandId: randomUUID(), runId: claim.envelope.runId,
    expectedVersion: claim.version, cause: "recovery", claim: fence });
  assert.ok(recovery.state === "applied" || recovery.state === "applied-already");
  const paused = requireLifecycleApplied(recovery);
  f.save({ "timeouts.taskMs": { set: 90_000 } });
  const resumed = requireLifecycleApplied(f.service.claimNext({ commandId: randomUUID(), workflow: "person-lookup", workerId: f.workers[1].workerId, workerLifetime: f.workers[1].workerLifetime,
    runtimeConfig: selectRunRuntime(f.database.authority) }));
  assert.deepEqual(resumed.envelope, original.envelope); assert.deepEqual(paused.envelope, original.envelope);
  assert.ok(resumed.claimGeneration > fence.claimGeneration);
  assert.deepEqual(f.service.renewClaim({ commandId: randomUUID(), runId: resumed.envelope.runId, claim: fence }),
    { state: "refused", refusal: { reason: "lost" } });
});
