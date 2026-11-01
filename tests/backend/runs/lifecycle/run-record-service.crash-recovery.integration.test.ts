import { RuntimeLifetimeLockReleasedError } from "../../../../src/backend/storage/admission/lifetime-lock.js";
import assert from "node:assert/strict";
import { afterEach, it } from "vitest";
import { createRunRecordServiceTestWorld } from "../../../support/helpers/backend/run-record-service-world.js";
import { attemptingOwnedWrite } from "../../../support/helpers/backend/worker-lifetime-world.js";

const world = createRunRecordServiceTestWorld();
afterEach(() => world.cleanup());

it("requires a held controller and terminalizes the exact interrupted claim with auditable recovery and replay", async () => {
  const f = await world.interruptedFixture(), request = f.recoveryRequest;
  assert.throws(() => Reflect.apply(f.service.recoverCrash.bind(f.service), f.service, [request, {}]), /crash-recovery-lock-required/u);
  assert.equal(f.database.authority.runs.get(f.run.envelope.runId)?.version, f.run.version);
  const result = f.service.recoverCrash(request, f.lock);
  assert.equal(result.state, "applied"); if (result.state !== "applied") throw new Error("recovery-refused");
  assert.ok(result.run.lifecycle.state === "terminal" && result.run.lifecycle.outcome === "failed");
  const failure = f.database.authority.failures.listByRun(f.run.envelope.runId)[0]; assert.ok(failure);
  assert.equal(failure.code, "RUN_INTERRUPTED_BY_CRASH");
  const command = f.database.authority.lifecycleJournal.getCommand(request.commandId);
  assert.ok(command && "operation" in command); assert.equal(command.operation, "recover-crash");
  assert.equal(f.service.recoverCrash(request, f.lock).state, "applied-already");
  assert.ok(f.database.authority.runResults.get(f.run.envelope.runId));
  await f.closeController();
  assert.throws(() => f.service.recoverCrash(request, f.lock), RuntimeLifetimeLockReleasedError);
});

it("refuses stale claim, version, membership and lease generation before any recovery effect", async () => {
  const f = await world.interruptedFixture(), request = f.recoveryRequest;
  for (const changed of [{ ...request, expectedVersion: request.expectedVersion + 1 },
    { ...request, claim: { ...request.claim, claimGeneration: request.claim.claimGeneration + 1 } },
    { ...request, workerLifetime: { ...request.workerLifetime, leaseGeneration: request.workerLifetime.leaseGeneration + 1 } },
    { ...request, workerLifetime: { ...request.workerLifetime, membershipRevision: request.workerLifetime.membershipRevision + 1 } }]) {
    assert.throws(() => f.service.recoverCrash(changed, f.lock));
  }
  assert.equal(f.database.authority.runs.get(f.run.envelope.runId)?.version, f.run.version);
  assert.deepEqual(f.database.authority.failures.listByRun(f.run.envelope.runId), []);
});

it("parks an unfinished attempt unchanged without a terminal result or a retry", async () => {
  const f = await world.interruptedFixture();
  const intent = await attemptingOwnedWrite({ database: f.database, fence: async input => f.database.authority.writeIntents.fenceAttempt(input) }, f.run);
  const result = f.service.recoverCrash(f.recoveryRequest, f.lock);
  assert.equal(result.state, "applied"); if (result.state !== "applied") throw new Error("recovery-refused");
  assert.equal(result.run.lifecycle.state, "parked-write");
  assert.deepEqual(f.database.authority.writeIntents.get(intent.writeIntentId), intent);
  assert.equal(f.database.authority.runResults.get(f.run.envelope.runId), undefined);
  assert.equal(f.service.recoverCrash(f.recoveryRequest, f.lock).state, "applied-already");
});
