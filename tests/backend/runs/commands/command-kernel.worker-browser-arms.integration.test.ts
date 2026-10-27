import { createCommandKernelTestWorld } from "../../../support/helpers/backend/command-kernel-harness.js";
import { testWorkerPorts } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { HASH_A, NOW, UUID_4 } from "../../../support/fixtures/phase1c-contract-fixtures.js";

const { roots, openDatabases, profiles, rejectActiveDescriptor, createHarness, nextCommandId, applyCurrentSettings } = createCommandKernelTestWorld();


afterEach(async () => {
  for (const database of openDatabases.splice(0)) database.close();
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

  it("plans worker capacity under activated settings without spawning an unreviewed worker", async () => {
    const harness = await createHarness();
    applyCurrentSettings(harness);
    const result = await harness.kernel.executeWorkerPool(workerCommand("plan-worker-count", { workflowId: "kernel-reject", expectedVersion: 0 }, { desiredWorkers: 2 }));
    assert.equal(result.state, "applied");
    assert.equal(harness.database.authority.workerPools.get("kernel-reject")?.desiredWorkers, 2);
    assert.deepEqual(harness.workerCalls, ["plan:plan-worker-count"]);
  });
  it("refuses an unavailable parked-read owner without journaling, changing control authority or calling a runtime", async () => {
    const h = await createHarness();
    testWorkerPorts(h.database, h.clock, { path: join(h.stateRoot, "state.db"), descriptor: rejectActiveDescriptor, poolIndex: 1 });
    const slot = h.database.authority.workerSlots.list(rejectActiveDescriptor.id)[0], lease = h.database.authority.workerLeases.get(slot.workerId);
    assert.ok(lease);
    const request = workerCommand("check-parked-write", { workerId: slot.workerId, workflowId: rejectActiveDescriptor.id, expectedVersion: lease.version,
      controlBasis: { leaseGeneration: lease.leaseGeneration, controlRevision: lease.controlRevision }, membershipRevision: slot.membershipRevision,
      processId: lease.processId, startedAt: lease.lifecycle.startedAt, installationId: UUID_4, profileId: UUID_4, itemId: UUID_4, runId: UUID_4, runVersion: 1,
      runAttempt: 1, traceId: "wf-090000-2222", nodeId: "submit-write", writeIntentId: UUID_4, intentVersion: 1, intentGeneration: 1,
      writeAttemptId: UUID_4, bindingProofDigest: HASH_A, occurrenceKeyDigest: HASH_A });
    const before = h.database.authority.workerLeases.get(slot.workerId);
    const result = await h.kernel.executeWorkerPool({ ...request, source: "run-detail" });
    assert.equal(result.state, "rejected");
    if (result.state !== "rejected") throw new Error("unavailable read owner was admitted");
    assert.equal(result.code, "capability-unavailable"); assert.equal(result.message, "PARKED_CHECK_UNAVAILABLE");
    assert.deepEqual(h.database.authority.workerLeases.get(slot.workerId), before);
    assert.equal(h.database.authority.workerControls.get(request.commandId), undefined);
    assert.deepEqual(h.workerCalls, []); assert.deepEqual(h.writeCalls, []);
  });

  it("writes pause/resume directives and reserves Stop for owner reset against exact membership", async () => {
    const harness = await createHarness();
    testWorkerPorts(harness.database, harness.clock, { path: join(harness.stateRoot, "state.db"), descriptor: rejectActiveDescriptor, poolIndex: 1 });
    const workerId = harness.database.authority.workerSlots.list(rejectActiveDescriptor.id)[0].workerId;

    const paused = await harness.kernel.executeWorkerPool(workerCommand("pause-worker", { workerId, expectedVersion: 999, controlBasis: { leaseGeneration: 1, controlRevision: 1 } }));
    assert.equal(paused.state, "applied");
    assert.equal(harness.database.authority.workerLeases.get(workerId)?.control.directive, "pause");

    const resumed = await harness.kernel.executeWorkerPool(workerCommand("resume-worker", { workerId, expectedVersion: 999, controlBasis: { leaseGeneration: 1, controlRevision: 2 } }));
    assert.equal(resumed.state, "applied");
    assert.equal(harness.database.authority.workerLeases.get(workerId)?.control.directive, "run");

    const stopped = await harness.kernel.executeWorkerPool(workerCommand("stop-worker", { workerId, membershipRevision: harness.database.authority.workerSlots.get(workerId)?.membershipRevision, expectedVersion: 999, controlBasis: { leaseGeneration: 1, controlRevision: 3 } }));
    assert.equal(stopped.state, "pending");
    assert.equal(harness.database.authority.workerLeases.get(workerId)?.control.directive, "run");

    const missing = await harness.kernel.executeWorkerPool(workerCommand("stop-worker", { workerId: "worker-9", expectedVersion: 1 }));
    assert.equal(missing.state, "rejected");
    if (missing.state === "rejected") assert.equal(missing.message, "worker-reset-authority-unavailable");
  });

  it("delegates plan/spawn/refresh/reopen to the typed runtime seam after authority validation", async () => {
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
    const spawned = await harness.kernel.executeWorkerPool(workerCommand(
      "spawn-worker",
      { workflowId: "kernel-reject", expectedVersion: 1 },
      { workerId },
    ));
    assert.equal(spawned.state, "applied");

    assert.equal(harness.database.authority.workerLeases.start({ workerId, workflow: rejectActiveDescriptor.id, browserSystems: [], processId: process.pid, requestedBy: "local-operator", now: NOW }).state, "started");
    const spawnLive = await harness.kernel.executeWorkerPool(workerCommand(
      "spawn-worker",
      { workflowId: "kernel-reject", expectedVersion: 1 },
      { workerId },
    ));
    assert.equal(spawnLive.state, "rejected");
    if (spawnLive.state === "rejected") assert.equal(spawnLive.code, "invalid-state");

    const lease = harness.database.authority.workerLeases.get(workerId);
    assert.ok(lease !== undefined);
    harness.database.authority.workerControls.observe({ workerId, leaseGeneration: lease.leaseGeneration, sessionId: UUID_4, system: "ucpath",
      configFingerprint: harness.database.authority.runtimeConfig.get()!.configFingerprint, signInFingerprint: HASH_A, browserMode: "headless", acceptDownloads: false,
      exclusive: false, health: "authenticated", observedAt: NOW, openedAt: NOW, profileRevision: 1 });
    const refreshed = await harness.kernel.executeWorkerPool(workerCommand(
      "refresh-browser",
      { workerId, controlBasis: { leaseGeneration: 1, controlRevision: 1 }, browserSessionId: UUID_4, expectedVersion: lease.version },
    ));
    assert.equal(refreshed.state, "applied");
    const refreshedRecord = harness.database.authority.workerControls.get(refreshed.commandId);
    assert.equal(refreshedRecord?.phase.state, "succeeded");
    assert.ok(refreshedRecord?.auditedAt);
    if (refreshedRecord?.phase.state !== "succeeded") throw new Error("expected browser outcome");
    assert.deepEqual(refreshedRecord.phase.application?.result, refreshed, "native read-only operation carries exact audited application");
    const unknownWorkflow = await harness.kernel.executeWorkerPool(workerCommand(
      "plan-worker-count",
      { workflowId: "kernel-unknown", expectedVersion: 1 },
      { desiredWorkers: 1 },
    ));
    assert.equal(unknownWorkflow.state, "rejected");
    if (unknownWorkflow.state === "rejected") assert.equal(unknownWorkflow.code, "target-not-found");

    assert.deepEqual(harness.workerCalls, [
      "plan:plan-worker-count",
      "spawn:spawn-worker",
      "refresh:refresh-browser",
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
    assert.deepEqual(harness.workerCalls, ["plan:plan-worker-count"], "only the applied plan reached the seam");

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
