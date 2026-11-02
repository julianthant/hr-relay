import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach, it } from "vitest";
import { requireLifecycleApplied } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { runClaim } from "../../../../src/models/run/record.js";
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
  assert.equal(f.service.resumePaused({ commandId: randomUUID(), runId: paused.envelope.runId, expectedVersion: paused.version }).state, "refused");
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

for (const state of ["queued", "parked-gate"] as const) it(`acknowledges requested pause atomically when active work releases to ${state}`, async () => {
  const f = await world.fixture();
  const running = world.runningRun(f.service, f.request, f.runtimeConfig);
  const paused = requireLifecycleApplied(f.service.pause({ commandId: randomUUID(), runId: running.envelope.runId, expectedVersion: running.version }));
  const claim = runClaim(paused); assert.ok(claim);
  const lifecycle = state === "queued" ? { state, requeuedFrom: "recovery" as const }
    : { state, gateId: "approval", resumeAt: "approval", parkedAt: f.clock.now().toISOString() };
  const released = requireLifecycleApplied(f.service.transition({ commandId: randomUUID(), runId: paused.envelope.runId,
    expectedVersion: paused.version, claim: { workerId: claim.workerId, claimGeneration: claim.claimGeneration }, lifecycle }));
  assert.equal(released.pause?.state, "paused");
  assert.deepEqual(released.lifecycle, lifecycle);
  assert.equal(runClaim(released), undefined);
  const resumed = requireLifecycleApplied(f.service.resumePaused({ commandId: randomUUID(), runId: released.envelope.runId, expectedVersion: released.version }));
  assert.equal(resumed.pause, undefined);
  assert.deepEqual(resumed.lifecycle, lifecycle);
});
