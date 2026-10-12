import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach,it,vi } from "vitest";
import { requireLifecycleApplied } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { selectRunRuntime } from "../../../../src/backend/runs/settings/run-settings.js";
import { settingsFixture } from "../../../support/helpers/backend/settings-activation-fixture.js";
const cleanups: (() => void)[] = [];
afterEach(() => { for (const close of cleanups.splice(0).reverse()) close(); vi.restoreAllMocks(); });
function fixture(isolateBrowser = false) { const f = settingsFixture(isolateBrowser); cleanups.push(f.close); return f; }
it("current authorization claims old and new queued snapshots and still refuses stale tokens and owners", () => {
  const f = fixture(); const old = f.create(); const token = selectRunRuntime(f.database.authority);
  f.save({ "timeouts.taskMs": { set: 90_000 } }); const next = f.create();
  const claim = (workerId: string, runtimeConfig = selectRunRuntime(f.database.authority)) => f.service.claimNext({
    commandId: randomUUID(), workflow: "person-lookup", workerId, runtimeConfig,
  });
  assert.deepEqual(claim("stale", token), { state: "refused", refusal: { reason: "runtime-stale" } });
  const first = requireLifecycleApplied(claim("first"));
  const second = requireLifecycleApplied(claim("second"));
  assert.deepEqual(new Set([first.envelope.configSnapshotId, second.envelope.configSnapshotId]),
    new Set([old.envelope.configSnapshotId, next.envelope.configSnapshotId]));
  assert.deepEqual(claim("first"), { state: "refused", refusal: { reason: "worker-busy", runId: first.envelope.runId } });
  const now = f.clock.now().toISOString();
  const request = { commandId: randomUUID(), runId: first.envelope.runId, expectedVersion: first.version,
    claim: { workerId: "intruder", claimGeneration: first.claimGeneration },
    lifecycle: { state: "validating", workerId: "first", claimedAt: now, heartbeatAt: now } };
  assert.equal(f.service.workerTransition(request).state, "refused");
  const validated = requireLifecycleApplied(f.service.workerTransition({ ...request, commandId: randomUUID(),
    claim: { workerId: "first", claimGeneration: first.claimGeneration } }));
  assert.deepEqual(validated.envelope, first.envelope);
});

it("pause/requeue then resume keeps the same run configuration and rejects the former claim", () => {
  const f = fixture(); const original = f.create();
  const claim = requireLifecycleApplied(f.service.claimNext({ commandId: randomUUID(), workflow: "person-lookup", workerId: "owner",
    runtimeConfig: selectRunRuntime(f.database.authority) }));
  const fence = { workerId: "owner", claimGeneration: claim.claimGeneration };
  const recovery = f.service.requeue({ commandId: randomUUID(), runId: claim.envelope.runId,
    expectedVersion: claim.version, cause: "recovery", claim: fence });
  assert.ok(recovery.state === "applied" || recovery.state === "applied-already");
  const paused = requireLifecycleApplied(recovery);
  f.save({ "timeouts.taskMs": { set: 90_000 } });
  const resumed = requireLifecycleApplied(f.service.claimNext({ commandId: randomUUID(), workflow: "person-lookup", workerId: "new-owner",
    runtimeConfig: selectRunRuntime(f.database.authority) }));
  assert.deepEqual(resumed.envelope, original.envelope); assert.deepEqual(paused.envelope, original.envelope);
  assert.ok(resumed.claimGeneration > fence.claimGeneration);
  assert.deepEqual(f.service.renewClaim({ commandId: randomUUID(), runId: resumed.envelope.runId, claim: fence }),
    { state: "refused", refusal: { reason: "lost" } });
});
