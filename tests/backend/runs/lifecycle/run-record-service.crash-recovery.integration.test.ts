import { RuntimeLifetimeLockReleasedError } from "../../../../src/backend/storage/admission/lifetime-lock.js";
import assert from "node:assert/strict";
import { afterEach, it } from "vitest";
import { randomUUID } from "node:crypto";
import { requireLifecycleApplied } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { createRunRecordServiceTestWorld } from "../../../support/helpers/backend/run-record-service-world.js";
import { attemptingOwnedWrite } from "../../../support/helpers/backend/worker-lifetime-world.js";
import { settledWriteState } from "../../../../src/models/trust/failure.js";
import { ATOMIC_WRITE_COMMIT, LEDGER_PAYLOAD, SPAN_OUTBOX_PAYLOAD } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { atomicWriteCheckpoint } from "../../../support/helpers/timeline-write-fixture.js";

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

it("refuses a stale claim or version before any recovery effect", async () => {
  const f = await world.interruptedFixture(), request = f.recoveryRequest;
  for (const changed of [{ ...request, expectedVersion: request.expectedVersion + 1 },
    { ...request, claim: { ...request.claim, claimGeneration: request.claim.claimGeneration + 1 } }]) {
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

it("records a crash after the run's own committed write as a failure after that write", async () => {
  const f = await world.interruptedFixture({ dryRun: false });
  const intent = await attemptingOwnedWrite({ database: f.database, fence: async input => f.database.authority.writeIntents.fenceAttempt(input) }, f.run);
  const owned = f.database.authority.runs.get(f.run.envelope.runId); assert.ok(owned);
  const owner = { writeIntentId: intent.writeIntentId, workflowId: intent.workflowId, itemId: intent.itemId, runId: owned.envelope.runId,
    traceId: owned.envelope.traceId, attempt: intent.runAttempt, bindingProofDigest: intent.bindingProofDigest };
  const commit = { ...ATOMIC_WRITE_COMMIT, writeIntentId: intent.writeIntentId, generation: intent.generation,
    transaction: { ...LEDGER_PAYLOAD, ...owner, configFingerprint: owned.envelope.configFingerprint, fencedAt: intent.fencedAt,
      instance: owned.envelope.resolvedInstance.ucpath },
    committedSpan: { ...SPAN_OUTBOX_PAYLOAD, ...owner } };
  f.database.commitWriteAttempt(commit, { ...atomicWriteCheckpoint(commit), claimGeneration: owned.claimGeneration,
    descriptorVersion: owned.envelope.descriptorVersion, contractFingerprint: owned.envelope.contractFingerprint });
  const committed = f.database.authority.writeIntents.listByRun(f.run.envelope.runId);
  assert.deepEqual(committed.map(({ status }) => status), ["committed"]);
  assert.equal(f.service.recoverCrash(f.recoveryRequest, f.lock).state, "applied");
  const failure = f.database.authority.failures.listByRun(f.run.envelope.runId)[0]; assert.ok(failure);
  assert.equal(failure.code, "RUN_INTERRUPTED_BY_CRASH");
  assert.equal(failure.writeState, settledWriteState(committed));
  assert.equal(failure.writeState, "committed");
  assert.deepEqual(f.database.authority.writeIntents.listByRun(f.run.envelope.runId), committed);
});

it("settles a crashed run whose pause was still pending without carrying that pause", async () => {
  const f = await world.interruptedFixture();
  const pausing = requireLifecycleApplied(f.service.pause({ commandId: randomUUID(), runId: f.run.envelope.runId, expectedVersion: f.run.version }));
  assert.equal(pausing.pause?.state, "requested");
  const result = f.service.recoverCrash({ ...f.recoveryRequest, expectedVersion: pausing.version }, f.lock);
  assert.equal(result.state, "applied"); if (result.state !== "applied") throw new Error("recovery-refused");
  assert.ok(result.run.lifecycle.state === "terminal" && result.run.lifecycle.outcome === "failed");
  assert.equal(result.run.pause, undefined);
  assert.equal(f.database.authority.runs.get(f.run.envelope.runId)?.pause, undefined);
  assert.equal(f.database.authority.runResults.getSettlement(f.run.envelope.runId, result.run.version)?.run.pause, undefined);
});
