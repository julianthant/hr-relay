import { createCommandKernelTestWorld } from "../../../support/helpers/backend/command-kernel-harness.js";
import { testWorkerPorts } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { HASH_A, NOW, UUID_4 } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { releaseSeededWriteOwners } from "../../../support/helpers/timeline-write-fixture.js";
import { singleAppliedRunId } from "../../../support/fixtures/operator-command-fixtures.js";
import { attemptingOwnedWrite } from "../../../support/helpers/backend/worker-lifetime-world.js";
import { lifecycleCommandId } from "../../../../src/rules/identity/identifiers.js";

const { roots, openDatabases, profiles, rejectActiveDescriptor, createHarness, nextCommandId, applyCurrentSettings, createPlan, startCommand } = createCommandKernelTestWorld();


afterEach(async () => {
  for (const database of openDatabases.splice(0)) { releaseSeededWriteOwners(database, NOW); database.close(); }
  for (const profile of profiles.splice(0)) await profile.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("worker-browser arms", () => {
  function workerCommand(type: string, target: Record<string, unknown>, payload?: Record<string, unknown>) {
    return {
      commandId: nextCommandId(),
      requestedAt: NOW,
      requestedBy: "local-operator",
      source: "dashboard",
      family: "worker-browser",
      type,
      target,
      ...(payload === undefined ? {} : { payload }),
    };
  }

  it("plans worker capacity under activated settings and ensures each planned member", async () => {
    const harness = await createHarness();
    applyCurrentSettings(harness);
    const result = await harness.kernel.executeWorkerPool(workerCommand("plan-worker-count", { workflowId: "kernel-reject", expectedVersion: 0 }, { desiredWorkers: 2 }));
    assert.equal(result.state, "applied");
    assert.equal(harness.database.authority.workerPools.get("kernel-reject")?.desiredWorkers, 2);
    const slots = harness.database.authority.workerSlots.active("kernel-reject");
    assert.deepEqual(harness.workerCalls, slots.map(slot => `ensure:${slot.workerId}`));
  });
  it("refuses an unavailable parked-read owner without journaling or calling the pool", async () => {
    const h = await createHarness();
    testWorkerPorts(h.database, h.clock, { path: join(h.stateRoot, "state.db"), descriptor: rejectActiveDescriptor, poolIndex: 1 });
    const slot = h.database.authority.workerSlots.list(rejectActiveDescriptor.id)[0];
    const request = workerCommand("check-parked-write", { workerId: slot.workerId, workflowId: rejectActiveDescriptor.id, lifetimeId: UUID_4, expectedVersion: 0,
      installationId: UUID_4, profileId: UUID_4, itemId: UUID_4, runId: UUID_4, runVersion: 1,
      runAttempt: 1, traceId: "wf-090000-2222", nodeId: "submit-write", writeIntentId: UUID_4, intentVersion: 1, intentGeneration: 1,
      writeAttemptId: UUID_4, bindingProofDigest: HASH_A, occurrenceKeyDigest: HASH_A });
    const result = await h.kernel.executeWorkerPool({ ...request, source: "run-detail" });
    assert.equal(result.state, "rejected");
    if (result.state !== "rejected") throw new Error("unavailable read owner was admitted");
    assert.equal(result.code, "capability-unavailable"); assert.equal(result.message, "PARKED_CHECK_UNAVAILABLE");
    assert.equal(h.database.authority.commands.get(request.commandId), undefined);
    assert.deepEqual(h.workerCalls, []); assert.deepEqual(h.writeCalls, []);
  });

  it("commits pause/resume on the slot, fences on the member, and resets through a fresh process", async () => {
    const harness = await createHarness();
    testWorkerPorts(harness.database, harness.clock, { path: join(harness.stateRoot, "state.db"), descriptor: rejectActiveDescriptor, poolIndex: 1 });
    const slot = harness.database.authority.workerSlots.list(rejectActiveDescriptor.id)[0], workerId = slot.workerId;
    const member = { workerId, workflowId: rejectActiveDescriptor.id };
    harness.workerMembers.set(workerId, { lifetimeId: UUID_4, version: 3, state: "running" });

    const stale = await harness.kernel.executeWorkerPool(workerCommand("pause-worker", { ...member, lifetimeId: UUID_4, expectedVersion: 2 }));
    assert.equal(stale.state, "conflict");
    if (stale.state === "conflict") assert.equal(stale.message, "WORKER_TARGET_STALE");
    assert.equal(harness.database.authority.workerSlots.get(workerId)?.paused, false);

    const paused = await harness.kernel.executeWorkerPool(workerCommand("pause-worker", { ...member, lifetimeId: UUID_4, expectedVersion: 3 }));
    assert.equal(paused.state, "applied");
    assert.equal(harness.database.authority.workerSlots.get(workerId)?.paused, true);

    const resumed = await harness.kernel.executeWorkerPool(workerCommand("resume-worker", { ...member, lifetimeId: UUID_4, expectedVersion: 3 }));
    assert.equal(resumed.state, "applied");
    assert.equal(harness.database.authority.workerSlots.get(workerId)?.paused, false);

    const reset = await harness.kernel.executeWorkerPool(workerCommand("stop-worker", { ...member, lifetimeId: UUID_4, expectedVersion: 3 }));
    assert.equal(reset.state, "applied");
    assert.notEqual(harness.workerMembers.get(workerId)?.lifetimeId, UUID_4, "Reset starts a fresh process");
    assert.deepEqual(harness.workerCalls, [`direct:${workerId}:pause`, `direct:${workerId}:run`, `stop:${workerId}:reset`, `start:${workerId}`]);

    const missing = await harness.kernel.executeWorkerPool(workerCommand("stop-worker", { workerId: "worker-9", workflowId: rejectActiveDescriptor.id, lifetimeId: null, expectedVersion: 0 }));
    assert.equal(missing.state, "rejected");
    if (missing.state === "rejected") assert.equal(missing.code, "target-not-found");
  });

  for (const write of ["none", "attempting"] as const) it(`resets a worker holding a claimed run through its own journaled run Cancel (write ${write})`, async () => {
    const harness = await createHarness();
    const plan = createPlan(harness, rejectActiveDescriptor, ["10800000"]);
    const runId = singleAppliedRunId(harness.kernel.execute(startCommand(plan)));
    testWorkerPorts(harness.database, harness.clock, { path: join(harness.stateRoot, "state.db"), descriptor: rejectActiveDescriptor, poolIndex: 1 });
    const slot = harness.database.authority.workerSlots.list(rejectActiveDescriptor.id)[0], workerId = slot.workerId;
    const claimed = harness.database.authority.runs.claimNext({ workflow: rejectActiveDescriptor.id, workerId, now: NOW });
    assert.equal(claimed.state, "claimed");
    if (claimed.state !== "claimed") throw new Error("fixture run was not claimed");
    if (write === "attempting") await attemptingOwnedWrite({ database: harness.database, fence: async input => harness.database.authority.writeIntents.fenceAttempt(input) }, claimed.run);
    harness.workerMembers.set(workerId, { lifetimeId: UUID_4, version: 3, state: "running" });

    const request = workerCommand("stop-worker", { workerId, workflowId: rejectActiveDescriptor.id, lifetimeId: UUID_4, expectedVersion: 3 });
    const reset = await harness.kernel.executeWorkerPool(request);
    const cancelId = lifecycleCommandId("worker-reset-cancel", request.commandId);
    assert.equal(reset.state, "applied", JSON.stringify(reset));
    // A fenced write in flight is not refused: it finishes and settles once, then the run ends.
    assert.deepEqual(harness.database.authority.writeIntents.listByRun(runId).map(intent => intent.status), write === "attempting" ? ["attempting"] : []);
    // A claimed run's Cancel is a request; the stopped process's exit settlement ends it.
    const cancelled = harness.database.authority.runs.get(runId);
    assert.equal(cancelled?.lifecycle.state, write === "attempting" ? "running" : "claimed");
    assert.equal(cancelled?.cancelRequested, true);
    assert.equal(harness.database.authority.commands.get(cancelId)?.type, "cancel");
    assert.equal(harness.database.authority.commandAudits.findByCommand(cancelId)?.result.state, "applied");
    assert.equal(harness.database.authority.commandAudits.findByCommand(request.commandId)?.result.state, "applied");
    assert.deepEqual(harness.workerCalls, [`stop:${workerId}:reset`, `start:${workerId}`]);
    const replay = await harness.kernel.executeWorkerPool(request);
    assert.equal(replay.state, "already-applied");
    assert.deepEqual(harness.workerCalls, [`stop:${workerId}:reset`, `start:${workerId}`], "a replayed Reset re-runs no effect");
  });

  it("delegates plan/spawn/refresh to the pool after authority validation", async () => {
    const harness = await createHarness();

    const planned = await harness.kernel.executeWorkerPool(workerCommand(
      "plan-worker-count",
      { workflowId: "kernel-reject", expectedVersion: 0 },
      { desiredWorkers: 2 },
    ));
    assert.equal(planned.state, "applied");
    if (planned.state === "applied") {
      assert.deepEqual(planned.affectedTargets[0], { family: "worker-pool", workflowId: "kernel-reject" });
    }
    const pool = harness.database.authority.workerPools.get("kernel-reject");
    assert.equal(pool?.version, 1);
    assert.equal(pool?.desiredWorkers, 2);
    assert.equal(pool?.plannedBy, "local-operator");

    const workerId = harness.database.authority.workerSlots.list(rejectActiveDescriptor.id)[0].workerId;
    harness.workerMembers.delete(workerId);
    const spawned = await harness.kernel.executeWorkerPool(workerCommand(
      "spawn-worker",
      { workflowId: "kernel-reject", expectedVersion: 1 },
      { workerId },
    ));
    assert.equal(spawned.state, "applied");

    const spawnLive = await harness.kernel.executeWorkerPool(workerCommand(
      "spawn-worker",
      { workflowId: "kernel-reject", expectedVersion: 1 },
      { workerId },
    ));
    assert.equal(spawnLive.state, "rejected");
    if (spawnLive.state === "rejected") assert.equal(spawnLive.message, "WORKER_ALREADY_RUNNING");

    const member = harness.workerMembers.get(workerId);
    assert.ok(member !== undefined);
    const refreshed = await harness.kernel.executeWorkerPool(workerCommand(
      "refresh-browser",
      { workerId, lifetimeId: member.lifetimeId, expectedVersion: member.version, browserSessionId: UUID_4 },
    ));
    assert.equal(refreshed.state, "applied");
    assert.deepEqual(harness.database.authority.commandAudits.findByCommand(refreshed.commandId)?.result, refreshed);
    const unknownWorkflow = await harness.kernel.executeWorkerPool(workerCommand(
      "plan-worker-count",
      { workflowId: "kernel-unknown", expectedVersion: 1 },
      { desiredWorkers: 1 },
    ));
    assert.equal(unknownWorkflow.state, "rejected");
    if (unknownWorkflow.state === "rejected") assert.equal(unknownWorkflow.code, "target-not-found");

    const slots = harness.database.authority.workerSlots.active("kernel-reject");
    assert.deepEqual(harness.workerCalls, [
      ...slots.map(slot => `ensure:${slot.workerId}`),
      `start:${workerId}`,
      `start:${workerId}`,
      `refresh-browser:${UUID_4}`,
    ]);
  });

  it("plan/spawn CAS against the durable POOL version and refuse a stale one by name, before the runtime seam", async () => {
    const harness = await createHarness();
    // No row yet: the basis is 0, and citing 1 is told so — with the current version.
    const unplanned = await harness.kernel.executeWorkerPool(workerCommand(
      "plan-worker-count",
      { workflowId: "kernel-reject", expectedVersion: 1 },
      { desiredWorkers: 1 },
    ));
    assert.equal(unplanned.state, "conflict");
    if (unplanned.state === "conflict") {
      assert.equal(unplanned.currentVersion, 0);
      assert.match(unplanned.message, /worker pool kernel-reject is at version 0 \(no worker count has been planned for it yet\), not 1/);
    }
    assert.equal(harness.database.authority.workerPools.get("kernel-reject"), undefined);
    assert.deepEqual(harness.workerCalls, [], "a refused CAS never reaches the runtime seam");

    const first = await harness.kernel.executeWorkerPool(workerCommand(
      "plan-worker-count",
      { workflowId: "kernel-reject", expectedVersion: 0 },
      { desiredWorkers: 1 },
    ));
    assert.equal(first.state, "applied");
    const audit = harness.database.authority.commandAudits.findByCommand(first.commandId);
    assert.ok(audit !== undefined);
    assert.deepEqual(audit.versionChanges, [{ target: { family: "worker-pool", workflowId: "kernel-reject" }, before: 0, after: 1 }]);

    // The same basis again is stale now: the row is at 1.
    const stale = await harness.kernel.executeWorkerPool(workerCommand(
      "plan-worker-count",
      { workflowId: "kernel-reject", expectedVersion: 0 },
      { desiredWorkers: 3 },
    ));
    assert.equal(stale.state, "conflict");
    if (stale.state === "conflict") assert.equal(stale.currentVersion, 1);
    assert.equal(harness.database.authority.workerPools.get("kernel-reject")?.desiredWorkers, 1);

    const staleSpawn = await harness.kernel.executeWorkerPool(workerCommand(
      "spawn-worker",
      { workflowId: "kernel-reject", expectedVersion: 0 },
      { workerId: "worker-1" },
    ));
    assert.equal(staleSpawn.state, "conflict");
    if (staleSpawn.state === "conflict") assert.equal(staleSpawn.currentVersion, 1);
    assert.deepEqual(harness.workerCalls, harness.database.authority.workerSlots.active("kernel-reject").map(slot => `ensure:${slot.workerId}`),
      "only the applied plan reached the pool");

    const next = await harness.kernel.executeWorkerPool(workerCommand(
      "plan-worker-count",
      { workflowId: "kernel-reject", expectedVersion: 1 },
      { desiredWorkers: 3 },
    ));
    assert.equal(next.state, "applied");
    assert.equal(harness.database.authority.workerPools.get("kernel-reject")?.version, 2);
    assert.equal(harness.database.authority.workerPools.get("kernel-reject")?.desiredWorkers, 3);
  });
});
