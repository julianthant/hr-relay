import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach, it } from "vitest";
import { requireLifecycleApplied } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { runClaim } from "../../../../src/models/run/record.js";
import { deriveWriteBindingProofDigest } from "../../../../src/rules/write-safety/write-safety.js";
import { WRITE_ATTEMPT, WRITE_INTENT_ATTEMPTING } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { fenceWriteFixture } from "../../../support/helpers/write-fence-fixture.js";
import { createRunRecordServiceTestWorld } from "../../../support/helpers/backend/run-record-service-world.js";

const world = createRunRecordServiceTestWorld();
afterEach(async () => world.cleanup());

it("persists queued pause, excludes claims, replays exactly, and resumes only by explicit command", async () => {
  const f = await world.fixture();
  const run = world.created(f.service, f.request);
  const request = { commandId: randomUUID(), runId: run.envelope.runId, expectedVersion: run.version };
  const paused = requireLifecycleApplied(f.service.pause(request));
  assert.equal(paused.pause?.state, "paused");
  assert.equal(paused.lifecycle.state, "queued");
  assert.equal(runClaim(paused), undefined);
  assert.deepEqual(requireLifecycleApplied(f.service.pause(request)), paused);
  assert.deepEqual(f.database.authority.runs.get(run.envelope.runId), paused);
  assert.equal(f.service.resumePaused({ ...request, commandId: randomUUID() }).state, "refused");
  const resumed = requireLifecycleApplied(f.service.resumePaused({ commandId: randomUUID(), runId: run.envelope.runId, expectedVersion: paused.version }));
  assert.equal(resumed.pause, undefined);
  assert.equal(Object.hasOwn(resumed, "pause"), false);
  const persisted = f.database.authority.runs.get(resumed.envelope.runId); assert.ok(persisted);
  assert.equal(Object.hasOwn(persisted, "pause"), false);
  assert.equal(resumed.envelope.continuation?.sources[0]?.runId, run.envelope.runId);
  assert.equal(resumed.version, paused.version + 1);
});

it("requests running pause and accepts only the real kebab-case worker claim at its boundary", async () => {
  const f = await world.fixture();
  const running = world.runningRun(f.service, f.request, f.runtimeConfig);
  const claim = runClaim(running); assert.ok(claim);
  assert.equal(claim.workerId, "person-lookup-worker-1");
  const paused = requireLifecycleApplied(f.service.pause({ commandId: randomUUID(), runId: running.envelope.runId, expectedVersion: running.version }));
  assert.equal(paused.pause?.state, "requested");
  assert.deepEqual(runClaim(paused), claim);
  const token = { workerId: claim.workerId, claimGeneration: claim.claimGeneration };
  assert.throws(() => f.service.acknowledgePause({ commandId: randomUUID(), runId: paused.envelope.runId,
    claim: { ...token, claimGeneration: token.claimGeneration + 1 } }));
  assert.deepEqual(f.database.authority.runs.get(paused.envelope.runId), paused);
  const request = { commandId: randomUUID(), runId: paused.envelope.runId, claim: token };
  const acknowledged = requireLifecycleApplied(f.service.acknowledgePause(request));
  assert.equal(acknowledged.pause?.state, "paused");
  assert.equal(acknowledged.lifecycle.state, "queued");
  assert.equal(runClaim(acknowledged), undefined);
  assert.deepEqual(requireLifecycleApplied(f.service.acknowledgePause(request)), acknowledged);
});

it("withdraws a requested pause on Resume and keeps the claim and envelope of the running step", async () => {
  const f = await world.fixture();
  const running = world.runningRun(f.service, f.request, f.runtimeConfig);
  const pausing = requireLifecycleApplied(f.service.pause({ commandId: randomUUID(), runId: running.envelope.runId, expectedVersion: running.version }));
  assert.equal(pausing.pause?.state, "requested");
  const withdrawal = { commandId: randomUUID(), runId: pausing.envelope.runId, expectedVersion: pausing.version };
  const resumed = requireLifecycleApplied(f.service.resumePaused(withdrawal));
  assert.equal(Object.hasOwn(resumed, "pause"), false);
  assert.deepEqual(resumed.lifecycle, pausing.lifecycle);
  assert.deepEqual(resumed.envelope, pausing.envelope);
  assert.equal(resumed.version, pausing.version + 1);
  assert.deepEqual(f.database.authority.runs.get(resumed.envelope.runId), resumed);
  // The journal records the withdrawal as a pause change, never as a Resume, and a replay reads it back as stored.
  const journaled = f.database.authority.lifecycleJournal.getCommand(withdrawal.commandId);
  assert.ok(journaled !== undefined && "kind" in journaled && journaled.kind === "run-lifecycle");
  assert.equal(journaled.operation, "pause");
  assert.equal(f.database.authority.lifecycleJournal.findRunResume(resumed.envelope.runId), undefined);
  assert.deepEqual(requireLifecycleApplied(f.service.resumePaused(withdrawal)), resumed);
  assert.deepEqual(f.database.authority.runs.get(resumed.envelope.runId), resumed);
});

it("releases a run unpaused when its worker stops for a pause that Resume has since withdrawn", async () => {
  const f = await world.fixture();
  const running = world.runningRun(f.service, f.request, f.runtimeConfig);
  const claim = runClaim(running); assert.ok(claim);
  const pausing = requireLifecycleApplied(f.service.pause({ commandId: randomUUID(), runId: running.envelope.runId, expectedVersion: running.version }));
  const resumed = requireLifecycleApplied(f.service.resumePaused({ commandId: randomUUID(), runId: pausing.envelope.runId, expectedVersion: pausing.version }));
  const request = { commandId: randomUUID(), runId: resumed.envelope.runId, claim: { workerId: claim.workerId, claimGeneration: claim.claimGeneration } };
  const released = requireLifecycleApplied(f.service.acknowledgePause(request));
  assert.deepEqual(released.lifecycle, { state: "queued", requeuedFrom: "recovery" });
  assert.equal(Object.hasOwn(released, "pause"), false);
  assert.equal(runClaim(released), undefined);
  assert.deepEqual(requireLifecycleApplied(f.service.acknowledgePause(request)), released);
  assert.equal(f.service.acknowledgePause({ ...request, commandId: randomUUID() }).state, "refused");
});

it("keeps a stop over a requested pause: Resume is refused and nothing changes", async () => {
  const f = await world.fixture();
  const running = world.runningRun(f.service, f.request, f.runtimeConfig);
  const pausing = requireLifecycleApplied(f.service.pause({ commandId: randomUUID(), runId: running.envelope.runId, expectedVersion: running.version }));
  const stopping = requireLifecycleApplied(f.service.transition({ commandId: randomUUID(), runId: pausing.envelope.runId, expectedVersion: pausing.version,
    lifecycle: { state: "terminal", outcome: "cancelled", endedAt: f.clock.now().toISOString() } }));
  assert.deepEqual([stopping.cancelRequested, stopping.pause?.state], [true, "requested"]);
  assert.equal(f.service.resumePaused({ commandId: randomUUID(), runId: stopping.envelope.runId, expectedVersion: stopping.version }).state, "refused");
  assert.deepEqual(f.database.authority.runs.get(stopping.envelope.runId), stopping);
});

for (const state of ["queued", "parked-gate"] as const) it(`acknowledges requested pause atomically when active work releases to ${state}`, async () => {
  const f = await world.fixture();
  const running = world.runningRun(f.service, f.request, f.runtimeConfig);
  const paused = requireLifecycleApplied(f.service.pause({ commandId: randomUUID(), runId: running.envelope.runId, expectedVersion: running.version }));
  const claim = runClaim(paused); assert.ok(claim);
  const lifecycle = state === "queued" ? { state, requeuedFrom: "recovery" as const }
    : { state, gateId: "approval", resumeAt: "approval", parkedAt: f.clock.now().toISOString() };
  const request = { commandId: randomUUID(), runId: paused.envelope.runId,
    expectedVersion: paused.version, claim: { workerId: claim.workerId, claimGeneration: claim.claimGeneration } };
  const outcome = state === "queued" ? f.service.requeue({ ...request, cause: "recovery" })
    : f.service.workerTransition({ ...request, lifecycle });
  assert.ok(outcome.state === "applied" || outcome.state === "applied-already");
  const released = requireLifecycleApplied(outcome);
  assert.equal(released.pause?.state, "paused");
  assert.deepEqual(released.lifecycle, lifecycle);
  assert.equal(runClaim(released), undefined);
  const resumed = requireLifecycleApplied(f.service.resumePaused({ commandId: randomUUID(), runId: released.envelope.runId, expectedVersion: released.version }));
  assert.equal(resumed.pause, undefined);
  assert.deepEqual(resumed.lifecycle, lifecycle);
});

it("refuses a pause acknowledgement over an attempting write and leaves the claim and pause request intact", async () => {
  const f = await world.fixture();
  const running = world.runningRun(f.service, f.request, f.runtimeConfig);
  const claim = runClaim(running); assert.ok(claim);
  const proof = { ...WRITE_INTENT_ATTEMPTING.bindingProof, runId: running.envelope.runId, attempt: running.envelope.attempt,
    afterPrepareSpanPath: `${running.envelope.traceId}/termination/prepare` };
  const bindingProofDigest = deriveWriteBindingProofDigest(proof);
  const intent = { ...WRITE_INTENT_ATTEMPTING, workflowId: running.envelope.workflow, itemId: running.envelope.itemId,
    runId: running.envelope.runId, runAttempt: running.envelope.attempt, bindingProof: proof, bindingProofDigest };
  fenceWriteFixture(f.database, { intent, attempt: { ...WRITE_ATTEMPT, writeIntentId: intent.writeIntentId,
    runId: intent.runId, runAttempt: intent.runAttempt, bindingProof: proof, bindingProofDigest } });
  const requested = requireLifecycleApplied(f.service.pause({ commandId: randomUUID(), runId: running.envelope.runId, expectedVersion: running.version }));
  assert.equal(requested.pause?.state, "requested");
  const outcome = f.service.acknowledgePause({ commandId: randomUUID(), runId: running.envelope.runId,
    claim: { workerId: claim.workerId, claimGeneration: claim.claimGeneration } });
  assert.ok(outcome.state === "refused", JSON.stringify(outcome));
  assert.deepEqual(outcome.refusal, { reason: "illegal-transition", from: "running", to: "queued",
    message: "a pause cannot release a claim over an unfinished write" });
  const after = f.database.authority.runs.get(running.envelope.runId); assert.ok(after);
  assert.equal(after.lifecycle.state, "running");
  assert.deepEqual(runClaim(after), claim);
  assert.equal(after.pause?.state, "requested");
  assert.equal(f.database.authority.writeIntents.get(intent.writeIntentId)?.status, "attempting");
});
