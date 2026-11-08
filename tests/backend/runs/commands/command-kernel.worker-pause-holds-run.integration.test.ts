import { createCommandKernelTestWorld, type Harness } from "../../../support/helpers/backend/command-kernel-harness.js";
import { releaseSeededWriteOwners } from "../../../support/helpers/timeline-write-fixture.js";
import { canonicalChildExecution } from "../../../support/helpers/backend/canonical-child-execution.js";
import { createRunExecutorTestWorld } from "../../../support/helpers/backend/run-executor-world.js";
import { childMixedPolicyModules, childMixedPolicyRoot } from "../../../support/fixtures/child-execution-workflows.js";
import { plan1Stores } from "../../../support/fixtures/plan1-operation-workflows.js";
import { NO_INTAKE_PROJECTIONS, UNSTORED_CONFIG_IDENTITY, UNWIRED_INTAKE_PARSER } from "../../../support/fixtures/intake-kernel-seams.js";
import { createCommandKernel } from "../../../../src/backend/runs/commands/command-kernel.js";
import { testAdmittedWorker, testRunService } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import { singleAppliedRunId } from "../../../support/fixtures/operator-command-fixtures.js";
import { NOW, UUID_4 } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { lifecycleCommandId, requireLifecycleApplied } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { deriveWriteAuthorityReason } from "../../../../src/rules/write-safety/write-authority-reason.js";
import { attemptingOwnedWrite } from "../../../support/helpers/backend/worker-lifetime-world.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";

const { roots, openDatabases, profiles, parallelDescriptor, createHarness, nextCommandId, createPlan, startCommand, runCommand } = createCommandKernelTestWorld();
const delegationWorld = createRunExecutorTestWorld();
afterEach(delegationWorld.cleanup);

afterEach(async () => {
  for (const database of openDatabases.splice(0)) { releaseSeededWriteOwners(database, NOW); database.close(); }
  for (const profile of profiles.splice(0)) await profile.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function workerCommand(type: string, target: Record<string, unknown>) {
  return { commandId: nextCommandId(), requestedAt: NOW, requestedBy: "local-operator", source: "dashboard", family: "worker-browser", type, target };
}

async function world() {
  const harness = await createHarness();
  const { workerId } = testAdmittedWorker(harness.database, harness.clock, { path: join(harness.stateRoot, "state.db"), workflow: parallelDescriptor.id, poolIndex: 1, browserSystems: [] });
  harness.workerMembers.set(workerId, { lifetimeId: UUID_4, version: 3, state: "running" });
  const service = testRunService(harness.database, harness.clock);
  const target = { workerId, workflowId: parallelDescriptor.id, lifetimeId: UUID_4, expectedVersion: 3 };
  const run = (runId: string) => {
    const record = harness.database.authority.runs.get(runId);
    assert.ok(record);
    return record;
  };
  const slot = () => {
    const current = harness.database.authority.workerSlots.get(workerId);
    assert.ok(current);
    return current;
  };
  const startRun = (eid: string) => singleAppliedRunId(harness.kernel.execute(startCommand(createPlan(harness, parallelDescriptor, [eid]))));
  const claim = () => {
    const claimed = harness.database.authority.runs.claimNext({ workflow: parallelDescriptor.id, workerId, now: NOW });
    assert.equal(claimed.state, "claimed");
    if (claimed.state !== "claimed") throw new Error("fixture run was not claimed");
    return { runId: claimed.run.envelope.runId, run: claimed.run, claim: { workerId, claimGeneration: claimed.run.claimGeneration } };
  };
  const workerPauseId = (held: ReturnType<typeof claim>) => lifecycleCommandId("worker-pause", { workerId, runId: held.runId, claimGeneration: held.claim.claimGeneration });
  const pauseWorker = (h: Harness) => h.kernel.executeWorkerPool(workerCommand("pause-worker", target));
  const resumeWorker = (h: Harness) => h.kernel.executeWorkerPool(workerCommand("resume-worker", target));
  const acknowledge = (held: ReturnType<typeof claim>) => requireLifecycleApplied(service.acknowledgePause({ commandId: nextCommandId(), runId: held.runId, claim: held.claim }));
  const rowPause = (runId: string) => {
    assert.equal(harness.kernel.execute(runCommand("pause", runId, run(runId).version)).state, "applied");
    return run(runId);
  };
  return { harness, workerId, target, slot, run, startRun, claim, workerPauseId, pauseWorker, resumeWorker, acknowledge, rowPause };
}

describe("worker pause holds the run the worker claimed", () => {
  it("pause-worker holds the worker's claimed run with a worker-derived pause request", async () => {
    const w = await world();
    const held = (w.startRun("10800000"), w.claim());
    const result = await w.pauseWorker(w.harness);
    assert.equal(result.state, "applied");
    assert.equal(w.slot().paused, true);
    const paused = w.run(held.runId).pause;
    assert.equal(paused?.state, "requested");
    assert.equal(paused?.commandId, w.workerPauseId(held));
  });

  it("pause-worker on an idle worker sets only the slot flag", async () => {
    const w = await world();
    const queuedId = w.startRun("10800000");
    const before = w.run(queuedId);
    const result = await w.pauseWorker(w.harness);
    assert.equal(result.state, "applied");
    assert.equal(w.slot().paused, true);
    assert.deepEqual(w.run(queuedId), before);
  });

  it("pause-worker keeps an existing row pause on the claimed run", async () => {
    const w = await world();
    const held = (w.startRun("10800000"), w.claim());
    const rowPaused = w.rowPause(held.runId);
    assert.equal(rowPaused.pause?.state, "requested");
    assert.notEqual(rowPaused.pause?.commandId, w.workerPauseId(held));
    assert.equal((await w.pauseWorker(w.harness)).state, "applied");
    assert.equal(w.slot().paused, true);
    assert.deepEqual(w.run(held.runId).pause, rowPaused.pause);
  });

  it("resume-worker resumes only the run its worker pause held", async () => {
    const w = await world();
    const held = (w.startRun("10800000"), w.claim());
    assert.equal((await w.pauseWorker(w.harness)).state, "applied");
    w.acknowledge(held);
    assert.equal(w.run(held.runId).pause?.state, "paused");
    const rowPausedId = w.startRun("10800001");
    const rowPaused = w.rowPause(rowPausedId);
    assert.equal(rowPaused.pause?.state, "paused");

    const result = await w.resumeWorker(w.harness);
    assert.equal(result.state, "applied");
    assert.equal(w.slot().paused, false);
    const resumed = w.run(held.runId);
    assert.equal(resumed.pause, undefined);
    assert.equal(resumed.lifecycle.state, "queued");
    assert.deepEqual(w.run(rowPausedId), rowPaused);
  });

  it("resume-worker refuses worker-pause-settling while the held run's pause is still requested", async () => {
    const w = await world();
    const held = (w.startRun("10800000"), w.claim());
    assert.equal((await w.pauseWorker(w.harness)).state, "applied");
    const slotBefore = w.slot();
    const runBefore = w.run(held.runId);
    assert.equal(runBefore.pause?.state, "requested");

    const result = await w.resumeWorker(w.harness);
    assert.equal(result.state, "rejected");
    if (result.state !== "rejected") throw new Error("resume was admitted while the pause was settling");
    assert.equal(result.code, "invalid-state");
    assert.equal(result.message, "worker-pause-settling");
    assert.deepEqual(w.slot(), slotBefore);
    assert.equal(w.slot().paused, true);
    assert.deepEqual(w.run(held.runId), runBefore);
  });

  it("stop-worker on a paused worker cancels the run its pause holds", async () => {
    const w = await world();
    const held = (w.startRun("10800000"), w.claim());
    assert.equal((await w.pauseWorker(w.harness)).state, "applied");
    w.acknowledge(held);
    const heldRun = w.run(held.runId);
    assert.equal(heldRun.lifecycle.state, "queued");
    assert.equal(heldRun.pause?.state, "paused");
    assert.equal(heldRun.pause?.commandId, w.workerPauseId(held));
    const rowPausedId = w.startRun("10800001");
    const rowPaused = w.rowPause(rowPausedId);

    const request = workerCommand("stop-worker", w.target);
    const result = await w.harness.kernel.executeWorkerPool(request);
    assert.equal(result.state, "applied", JSON.stringify(result));
    const cancelId = lifecycleCommandId("worker-stop-held-cancel", { commandId: request.commandId, runId: held.runId });
    assert.equal(w.harness.database.authority.commands.get(cancelId)?.type, "cancel");
    assert.equal(w.harness.database.authority.commandAudits.findByCommand(cancelId)?.result.state, "applied");
    const cancelled = w.run(held.runId);
    assert.equal(cancelled.lifecycle.state, "terminal");
    if (cancelled.lifecycle.state === "terminal") assert.equal(cancelled.lifecycle.outcome, "cancelled");
    assert.deepEqual(w.run(rowPausedId), rowPaused);
  });

  it("stop-worker cancels the held run's cascade-cancel children through the operator Cancel arm", async () => {
    const h = await delegationWorld.executorHarness({ descriptor: childMixedPolicyRoot.descriptor, stores: plan1Stores });
    const { database, path } = h.authority;
    const resolve = (id: string) => childMixedPolicyModules.find(module => module.descriptor.id === id)?.descriptor;
    const execution = canonicalChildExecution(h.deps, database, path, resolve);
    const root = execution.start(childMixedPolicyRoot.descriptor, { emplId: "10800000", text: "same", mode: "ok" }, { dryRun: false });
    const stepped = await execution.step(root, delegationWorld.SIGNAL);
    assert.equal(stepped.outcome.state, "yielded-delegation");
    const { workerId } = stepped.claim;
    const parentId = root.envelope.runId;
    const parent = database.authority.runs.get(parentId);
    assert.ok(parent);
    const children = database.authority.runs.listChildren(parentId);
    const cascadeChildId = children.find(child => child.envelope.parent?.edgeId === "cascade")?.envelope.runId;
    const independentChildId = children.find(child => child.envelope.parent?.edgeId === "independent")?.envelope.runId;
    assert.ok(cascadeChildId && independentChildId);
    // The worker's Pause held the parent as it released into its delegation.
    requireLifecycleApplied(execution.lifecycle.pause({ runId: parentId, expectedVersion: parent.version,
      commandId: lifecycleCommandId("worker-pause", { workerId, runId: parentId, claimGeneration: parent.claimGeneration }) }));
    assert.equal(database.authority.runs.get(parentId)?.pause?.state, "paused");
    const unused = (): never => { throw new Error("unrequested worker effect"); };
    const member = { lifetimeId: UUID_4, version: 3, state: "running" as const };
    const kernel = createCommandKernel({ authority: database, lifecycle: execution.lifecycle, clock: h.deps.clock, ids: { uuid: randomUUID },
      appVersion: "0.1.0", descriptors: { resolve }, configIdentity: UNSTORED_CONFIG_IDENTITY, intakeParser: UNWIRED_INTAKE_PARSER,
      intakeProjections: NO_INTAKE_PROJECTIONS, writeResolution: { recheck: unused, resolveAbsent: unused },
      workerRuntime: { pool: { admit: async () => undefined, assertMember: () => member.state, start: async () => undefined, ensure: unused,
        stop: async () => undefined, remove: unused, direct: async () => undefined, browser: unused, checkParkedWrite: unused } } });
    const slot = database.authority.workerSlots.get(workerId);
    assert.ok(slot);

    const result = await kernel.executeWorkerPool(workerCommand("stop-worker", { workerId, workflowId: slot.workflow, lifetimeId: UUID_4, expectedVersion: 3 }));

    assert.equal(result.state, "applied", JSON.stringify(result));
    for (const runId of [parentId, cascadeChildId]) {
      const cancelled = database.authority.runs.get(runId);
      assert.ok(cancelled?.lifecycle.state === "terminal" && cancelled.lifecycle.outcome === "cancelled", runId);
    }
    assert.equal(database.authority.runs.get(independentChildId)?.lifecycle.state, "queued");
  });

  it("stop-worker during the claimed run's fenced write is admitted and lets the write finish", async () => {
    const w = await world();
    const held = (w.startRun("10800000"), w.claim());
    const intent = await attemptingOwnedWrite({ database: w.harness.database, fence: async input => w.harness.database.authority.writeIntents.fenceAttempt(input) }, held.run);

    const result = await w.harness.kernel.executeWorkerPool(workerCommand("stop-worker", w.target));

    assert.equal(result.state, "applied", JSON.stringify(result));
    assert.equal(w.run(held.runId).cancelRequested, true);
    assert.equal(w.harness.database.authority.writeIntents.get(intent.writeIntentId)?.status, "attempting");
  });

  it("a parked write still refuses stop-worker", async () => {
    const w = await world();
    const held = (w.startRun("10800000"), w.claim());
    const intent = await attemptingOwnedWrite({ database: w.harness.database, fence: async input => w.harness.database.authority.writeIntents.fenceAttempt(input) }, held.run);
    w.harness.database.authority.writeIntents.parkAttempt({ writeIntentId: intent.writeIntentId, generation: intent.generation, expectedVersion: intent.version,
      code: "unknown", message: "synthetic-unresolved-submit", now: NOW,
      authorityReason: deriveWriteAuthorityReason("post-click-verifier-unknown", "probe", "synthetic-unresolved-submit") });
    const before = w.run(held.runId);

    const result = await w.harness.kernel.executeWorkerPool(workerCommand("stop-worker", w.target));

    assert.equal(result.state, "rejected", JSON.stringify(result));
    if (result.state === "rejected") assert.equal(result.code, "invalid-state");
    assert.deepEqual(w.run(held.runId), before);
  });
});
