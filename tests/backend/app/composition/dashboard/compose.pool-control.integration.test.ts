import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { WorkerSessionManager } from "../../../../../src/backend/runtime/workers/worker-sessions.js";
import { createWorkerResetControl } from "../../../../../src/backend/runtime/workers/worker-browser-control.js";
import { RunRecordService } from "../../../../../src/backend/runs/lifecycle/run-record-service.js";
import { taskStoreRegistry } from "../../../../../src/backend/app/registries/task-registry.js";
import { fixtureDuoCeremonyGates } from "../../../../support/helpers/duo-ceremony-fixtures.js";
import { sequentialIdFactory } from "../../../../support/fixtures/phase1f-run-fixtures.js";
import { createDashboardPoolTestWorld, type ControlHarness } from "../../../../support/helpers/backend/dashboard-pool-world.js";
import assert from "node:assert/strict";

import { afterEach, describe, it } from "vitest";
import { PositiveIntSchema } from "../../../../../src/rules/identity/ids.js";

const {servedControlBasis, NOW, WORKFLOW, BROWSER_SYSTEMS, WORKER_1, MEMBER_1, WORKER_2, openControlHarness, nextCommandId, envelope, spawnPoolWorker, admitExternalSlot, cleanup } = createDashboardPoolTestWorld();

const POOL_INDEX_2 = PositiveIntSchema.parse(2);
const MEMBER_2 = { workflowId: WORKFLOW, poolIndex: POOL_INDEX_2, ordinal: POOL_INDEX_2, membershipRevision: PositiveIntSchema.parse(1), workerId: WORKER_2 } as const;

afterEach(cleanup);

async function settleOwnedReset(harness: ControlHarness, commandId: string) {
  const reset = harness.database.authority.workerControls.get(commandId)?.reset;
  assert.ok(reset, "the command must retain its exact reset binding");
  const sessions = new WorkerSessionManager({ workerId: reset.member.workerId, workflowId: reset.member.workflowId,
    resetOwner: { member: reset.member, lifetime: reset.lifetime }, stores: taskStoreRegistry, factory: { open: async () => { throw new Error("browserless reset must not acquire"); } },
    clock: harness.clock, scheduler: harness.scheduler, acquireDeadlineMs: 1000, duoCeremony: await fixtureDuoCeremonyGates(harness.clock) });
  const lifecycle = new RunRecordService({ database: harness.database, clock: harness.clock,
    ids: sequentialIdFactory("e"), publishQueued: () => { throw new Error("reset must not queue work"); } });
  await createWorkerResetControl({ database: harness.database, workerId: reset.member.workerId,
    leaseGeneration: reset.lifetime.leaseGeneration, clock: harness.clock, lifecycle })(sessions, reset);
}

/* ── the composed seam, end to end ───────────────────────────────────────── */

describe("the composed worker process control through the kernel pool door", () => {

  it("binds Stop to the command instant and confirms only the exact owner's durable idle reset", async () => {
    const harness = await openControlHarness(); await spawnPoolWorker(harness);
    harness.clock.advanceWall(5_000);
    const stopAt = harness.clock.now().toISOString(), commandId = nextCommandId();
    const command = { ...envelope(harness, commandId), type: "stop-worker" as const,
      target: { workerId: WORKER_1, membershipRevision: MEMBER_1.membershipRevision, expectedVersion: 1,
        controlBasis: servedControlBasis(harness.database, WORKER_1) }, reason: "shift over" };
    assert.deepEqual(await harness.kernel.executeWorkerPool(command), { state: "pending", commandId });
    const admitted = harness.database.authority.workerControls.get(commandId);
    assert.equal(admitted?.admittedAt, stopAt);
    assert.deepEqual(admitted?.request, command);
    assert.equal(harness.database.authority.commandAudits.findByCommand(commandId), undefined);
    assert.equal(harness.database.authority.workerLeases.get(WORKER_1)?.control.directive, "run");
    await settleOwnedReset(harness, commandId);
    assert.equal((await harness.kernel.executeWorkerPool(command)).state, "already-applied");
    assert.deepEqual(harness.database.authority.workerLeases.get(WORKER_1)?.control,
      { directive: "run", requestedAt: stopAt, requestedBy: "local-operator" });
    const settled = harness.database.authority.workerControls.get(commandId);
    assert.equal(settled?.phase.state, "succeeded");
    if (settled?.phase.state !== "succeeded") throw new Error("missing reset milestone");
    assert.deepEqual(settled.phase.acknowledgement, { kind: "reset", commandId, leaseGeneration: 1,
      controlRevision: admitted?.reset?.reservedControlRevision, membershipRevision: 1, idleAt: stopAt,
      closedSessionIds: [], browsersClosed: true, duoReleased: true });
    assert.deepEqual(harness.control.supervisor.memberEvidence(MEMBER_1),
      { state: "running", pid: harness.children[0]?.pid, bornAt: NOW, leaseStartedAt: NOW });
  });

  it("plans only after validation, and writes the desired count from the command — never from the ack path", async () => {
    const harness = await openControlHarness();
    // A stale CAS basis refuses BEFORE the supervisor is consulted: no pool
    // row, no journal row, no process effect.
    const staleId = nextCommandId();
    const conflicted = await harness.kernel.executeWorkerPool({
      ...envelope(harness, staleId),
      type: "plan-worker-count",
      target: { workflowId: WORKFLOW, expectedVersion: 3 },
      payload: { desiredWorkers: 1 },
    });
    assert.equal(conflicted.state, "conflict");
    assert.equal(harness.database.authority.workerPools.get(WORKFLOW), undefined);
    assert.equal(harness.database.authority.commands.get(staleId), undefined);
    assert.equal(harness.spawnRequests.length, 0);

    const planId = nextCommandId();
    const planned = await harness.kernel.executeWorkerPool({
      ...envelope(harness, planId),
      type: "plan-worker-count",
      target: { workflowId: WORKFLOW, expectedVersion: 0 },
      payload: { desiredWorkers: 1 },
    });
    assert.deepEqual(planned, {
      state: "applied",
      commandId: planId,
      affectedTargets: [
        { family: "worker-pool", workflowId: WORKFLOW },
        { family: "worker-browser", workerId: WORKER_1 },
      ],
    });
    assert.equal(harness.database.authority.workerPools.get(WORKFLOW)?.desiredWorkers, 1);
    assert.equal(harness.database.authority.workerPools.get(WORKFLOW)?.version, 1);
  });

  it("serializes concurrent pool plans: the loser refuses before any directive or escalation effect lands", async () => {
    const harness = await openControlHarness();
    await spawnPoolWorker(harness, MEMBER_1);
    await spawnPoolWorker(harness, MEMBER_2);

    const beforeVersion = harness.database.authority.workerPools.get(WORKFLOW)?.version; assert.ok(beforeVersion);
    const keepBothId = nextCommandId();
    const keepBoth = harness.kernel.executeWorkerPool({
      ...envelope(harness, keepBothId),
      type: "plan-worker-count",
      target: { workflowId: WORKFLOW, expectedVersion: beforeVersion },
      payload: { desiredWorkers: 2 },
    });
    const shrinkId = nextCommandId();
    const shrink = harness.kernel.executeWorkerPool({
      ...envelope(harness, shrinkId),
      type: "plan-worker-count",
      target: { workflowId: WORKFLOW, expectedVersion: beforeVersion },
      payload: { desiredWorkers: 1 },
    });
    const [first, second] = await Promise.allSettled([keepBoth, shrink]);

    assert.equal(first.status, "fulfilled");
    if (first.status !== "fulfilled") throw new Error("unreachable");
    assert.equal(first.value.state, "applied");
    // The loser refuses TYPED, before its effect: never a thrown 500, never a
    // stop directive it initiated and then abandoned.
    assert.equal(second.status, "fulfilled");
    if (second.status !== "fulfilled") throw new Error("unreachable");
    assert.equal(second.value.state, "conflict");
    if (second.value.state !== "conflict") throw new Error("unreachable");
    assert.equal(second.value.currentVersion, beforeVersion + 1);
    assert.equal(harness.database.authority.commands.get(shrinkId), undefined);

    // The desired member the loser would have stopped is untouched: run
    // directive intact, supervisor evidence plain running, nothing armed.
    assert.equal(harness.database.authority.workerLeases.get(WORKER_2)?.control.directive, "run");
    assert.deepEqual(harness.control.supervisor.memberEvidence(MEMBER_2)?.state, "running");
    assert.equal(harness.database.authority.workerPools.get(WORKFLOW)?.desiredWorkers, 2);
    assert.equal(harness.database.authority.workerPools.get(WORKFLOW)?.version, beforeVersion + 1);
  });

  it("maps a phase-C pool CAS loss to a typed conflict naming the already-executed effect", async () => {
    let effectCalls = 0;
    const harness = await openControlHarness({
      interceptPool: (pool, edges) => ({
        ...pool,
        planPoolWorkerCount: async (context) => {
          effectCalls += 1;
          const acknowledgement = await pool.planPoolWorkerCount(context);

          assert.equal(edges.database.authority.workerPools.plan({
            workflow: WORKFLOW,
            expectedVersion: 1,
            desiredWorkers: 1,
            requestedBy: "local-operator",
            now: edges.clock.now().toISOString(),
          }).state, "applied");
          return acknowledgement;
        },
      }),
    });
    const commandId = nextCommandId();
    const command = {
      ...envelope(harness, commandId),
      type: "plan-worker-count",
      target: { workflowId: WORKFLOW, expectedVersion: 0 },
      payload: { desiredWorkers: 1 },
    };
    const result = await harness.kernel.executeWorkerPool(command);
    assert.equal(result.state, "conflict");
    if (result.state !== "conflict") throw new Error("unreachable");
    assert.equal(result.currentVersion, 2);
    // The refusal tells the operator the truth: the process effect ran.
    assert.match(result.message, /ALREADY executed/);
    assert.equal(harness.database.authority.workerControls.get(commandId)?.phase.state, "uncertain");
    assert.equal((await harness.kernel.executeWorkerPool(command)).state, "rejected");
    assert.equal(effectCalls, 1);
    // Admission remains; no completion is audited.
    assert.equal(harness.database.authority.commands.get(commandId)?.type, "plan-worker-count");
    assert.equal(harness.database.authority.commandAudits.findByCommand(commandId), undefined);
  });

  it.each(["admitted", "executing"] as const)("reconciles an expired %s command without delivering its effect again", async state => {
    const harness = await openControlHarness(); await spawnPoolWorker(harness);
    const commandId = nextCommandId(); const request = { ...envelope(harness, commandId), type: "pause-worker" as const,
      target: { workerId: WORKER_1, expectedVersion: 1, controlBasis: servedControlBasis(harness.database, WORKER_1) } };
    harness.database.withAuthorityTransaction(r => {
      r.commands.insert(request);
      r.workerLeases.reserveControl(WORKER_1, request.target.controlBasis, commandId, NOW);
      r.workerControls.admit({ commandId, request, scope: "worker-pool:person-lookup", executorId: nextCommandId(), admittedAt: NOW, expiresAt: NOW, basisVersion: 1, phase: { state: "admitted" } });
      if (state === "executing") r.workerControls.transition(commandId, "admitted", { state: "executing", startedAt: NOW });
    });
    harness.control.supervisor.close();
    const result = await harness.kernel.executeWorkerPool(request);
    assert.equal(result.state, "rejected");
    assert.equal(harness.database.authority.workerLeases.get(WORKER_1)?.control.directive, "run");
    assert.equal(harness.database.authority.workerControls.get(commandId)?.phase.state, state === "admitted" ? "refused" : "uncertain");
    assert.equal(harness.database.authority.commandAudits.findByCommand(commandId)?.result.state, state === "admitted" ? "rejected" : undefined);
    const next = await harness.kernel.executeWorkerPool({ ...envelope(harness), type: "pause-worker",
      target: { workerId: WORKER_1, expectedVersion: 1, controlBasis: servedControlBasis(harness.database, WORKER_1) } });
    assert.equal(next.state, "rejected");
    if (next.state === "rejected") assert.match(next.message, state === "executing" ? /unresolved-effect/ : /closed/);
  });

  it("rolls reset settlement back on audit loss and replays the exact completed reset without a supervisor", async () => {
    const harness = await openControlHarness(); await spawnPoolWorker(harness);
    const commandId = nextCommandId(), command = { ...envelope(harness, commandId), type: "stop-worker" as const,
      target: { workerId: WORKER_1, membershipRevision: MEMBER_1.membershipRevision, expectedVersion: 1,
        controlBasis: servedControlBasis(harness.database, WORKER_1) }, reason: "shift over" };
    assert.equal((await harness.kernel.executeWorkerPool(command)).state, "pending");
    const lease = harness.database.authority.workerLeases.get(WORKER_1);
    const raw = new DatabaseSync(join(harness.root, "state.db"));
    try {
      raw.exec(`CREATE TRIGGER fail_reset_audit BEFORE INSERT ON command_audits WHEN NEW.command_id = '${commandId}' BEGIN SELECT RAISE(ABORT, 'injected-command-audit-failure'); END`);
      await assert.rejects(settleOwnedReset(harness, commandId), /injected-command-audit-failure/);
    } finally { raw.exec("DROP TRIGGER IF EXISTS fail_reset_audit"); raw.close(); }
    assert.equal(harness.database.authority.workerControls.get(commandId)?.phase.state, "uncertain");
    assert.equal(harness.database.authority.workerControls.get(commandId)?.auditedAt, undefined);
    assert.notEqual(harness.database.authority.commands.get(commandId), undefined);
    assert.equal(harness.database.authority.commandAudits.findByCommand(commandId), undefined);
    assert.deepEqual(harness.database.authority.workerLeases.get(WORKER_1), lease);
    assert.equal((await harness.kernel.executeWorkerPool(command)).state, "pending");
    const blocked = await harness.kernel.executeWorkerPool({ ...envelope(harness), type: "pause-worker",
      target: { workerId: WORKER_1, expectedVersion: lease?.version, controlBasis: servedControlBasis(harness.database, WORKER_1) } });
    assert.equal(blocked.state, "rejected");
    if (blocked.state === "rejected") assert.match(blocked.message, /unresolved-effect/);
    await settleOwnedReset(harness, commandId);
    const completedLease = harness.database.authority.workerLeases.get(WORKER_1);
    harness.control.supervisor.close();
    assert.equal((await harness.kernel.executeWorkerPool(command)).state, "already-applied");
    assert.equal((await harness.kernel.executeWorkerPool(command)).state, "already-applied");
    assert.deepEqual(harness.database.authority.workerLeases.get(WORKER_1), completedLease);
    assert.equal(harness.database.authority.commandAudits.findByCommand(commandId)?.result.state, "applied");
    assert.deepEqual(harness.database.authority.commandAudits.findByCommand(commandId)?.versionChanges,
      [{ target: { family: "worker-browser", workerId: WORKER_1 }, before: lease?.version, after: completedLease?.version }]);
  });

  it("does not identify an unjournaled historical stop by matching actor and reason", async () => {
    const harness = await openControlHarness();
    assert.equal(admitExternalSlot(harness), WORKER_1);
    harness.database.authority.workerLeases.start({ workerId: WORKER_1, workflow: WORKFLOW, browserSystems: BROWSER_SYSTEMS,
      processId: process.pid, requestedBy: "local-operator", now: NOW });
    harness.database.authority.workerLeases.control({ workerId: WORKER_1, expectedVersion: 1,
      control: { directive: "stop", requestedAt: NOW, requestedBy: "local-operator", reason: "shift over" }, now: NOW });
    const commandId = nextCommandId();
    const result = await harness.kernel.executeWorkerPool({ ...envelope(harness, commandId), type: "stop-worker",
      target: { workerId: WORKER_1, membershipRevision: MEMBER_1.membershipRevision, expectedVersion: 2, controlBasis: servedControlBasis(harness.database, WORKER_1) }, reason: "shift over" });
    assert.equal(result.state, "rejected");
    if (result.state === "rejected") assert.match(result.message, /never spawned/);
    assert.equal(harness.database.authority.commands.get(commandId), undefined);
    assert.equal(harness.database.authority.commandAudits.findByCommand(commandId), undefined);
    assert.equal(harness.database.authority.workerLeases.get(WORKER_1)?.control.requestedAt, NOW);
  });

  it("refuses a new same-identity stop against a dead lease's stale directive: invalid-state, never applied", async () => {
    const harness = await openControlHarness();
    assert.equal(admitExternalSlot(harness), WORKER_1);
    // A COMPLETED stop, all the way through the worker's own death: the lease
    // carries the stop directive that stopped it and the lifecycle is stopped.
    assert.equal(harness.database.authority.workerLeases.start({
      workerId: WORKER_1, workflow: WORKFLOW, browserSystems: BROWSER_SYSTEMS,
      processId: process.pid, requestedBy: "local-operator", now: NOW,
    }).state, "started");
    const stoppedNow = harness.clock.now().toISOString();
    assert.equal(harness.database.authority.workerLeases.control({
      workerId: WORKER_1,
      expectedVersion: 1,
      control: { directive: "stop", requestedAt: stoppedNow, requestedBy: "local-operator", reason: "shift over" },
      now: stoppedNow,
    }).state, "applied");
    assert.equal(harness.database.authority.workerLeases.reportLifecycle({
      workerId: WORKER_1,
      leaseGeneration: 1,
      lifecycle: { state: "stopped", startedAt: NOW, stoppedAt: stoppedNow, reason: "operator" },
      now: stoppedNow,
    }).state, "applied");

    harness.clock.advanceWall(30_000);
    const commandId = nextCommandId();
    const result = await harness.kernel.executeWorkerPool({
      ...envelope(harness, commandId),
      type: "stop-worker",
      target: { workerId: WORKER_1, membershipRevision: MEMBER_1.membershipRevision, expectedVersion: 3, controlBasis: servedControlBasis(harness.database, WORKER_1) },
      reason: "shift over",
    });
    assert.equal(result.state, "rejected");
    if (result.state !== "rejected") throw new Error("unreachable");
    assert.equal(result.code, "invalid-state");
    assert.match(result.message, /worker-reset-replacement-authority-unavailable/);
    assert.equal(harness.database.authority.commands.get(commandId), undefined);
    assert.equal(harness.database.authority.commandAudits.findByCommand(commandId), undefined);
  });

  it("refuses actor, reason and instant drift under the same retained command identity before effects", async () => {
    const harness = await openControlHarness();
    await spawnPoolWorker(harness);
    const commandId = nextCommandId();
    const command = { ...envelope(harness, commandId), type: "pause-worker" as const,
      target: { workerId: WORKER_1, expectedVersion: 1, controlBasis: servedControlBasis(harness.database, WORKER_1) }, reason: "shift over" };
    harness.auditFault.enabled = true;
    await assert.rejects(harness.kernel.executeWorkerPool(command), /injected-command-audit-failure/);
    harness.auditFault.enabled = false;
    const lease = harness.database.authority.workerLeases.get(WORKER_1);
    for (const drift of [{ requestedBy: "another-operator" }, { reason: "another reason" }, { requestedAt: "2026-08-26T09:01:00.000Z" }]) {
      const result = await harness.kernel.executeWorkerPool({ ...command, ...drift });
      assert.equal(result.state, "rejected");
      if (result.state === "rejected") assert.equal(result.code, "command-divergent");
      assert.notEqual(harness.database.authority.commands.get(commandId), undefined);
    assert.equal(harness.database.authority.commandAudits.findByCommand(commandId), undefined);
      assert.deepEqual(harness.database.authority.workerLeases.get(WORKER_1), lease);
    }
    assert.equal((await harness.kernel.executeWorkerPool(command)).state, "applied");
    assert.equal((await harness.kernel.executeWorkerPool(command)).state, "already-applied");
  });

  it("audits reset settlement's own lease versions, not later unrelated heartbeats", async () => {
    const harness = await openControlHarness(); await spawnPoolWorker(harness, MEMBER_1);
    const commandId = nextCommandId(), command = { ...envelope(harness, commandId), type: "stop-worker" as const,
      target: { workerId: WORKER_1, membershipRevision: MEMBER_1.membershipRevision, expectedVersion: 1,
        controlBasis: servedControlBasis(harness.database, WORKER_1) } };
    assert.equal((await harness.kernel.executeWorkerPool(command)).state, "pending");
    const before = harness.database.authority.workerLeases.get(WORKER_1); assert.ok(before);
    await settleOwnedReset(harness, commandId);
    const settled = harness.database.authority.workerLeases.get(WORKER_1); assert.ok(settled);
    const bumpNow = harness.clock.now().toISOString();
    assert.equal(harness.database.authority.workerLeases.reportLifecycle({ workerId: WORKER_1,
      leaseGeneration: settled.leaseGeneration, lifecycle: { state: "idle", startedAt: NOW, heartbeatAt: bumpNow }, now: bumpNow }).state, "applied");
    assert.equal((await harness.kernel.executeWorkerPool(command)).state, "already-applied");
    assert.equal(harness.database.authority.workerLeases.get(WORKER_1)?.version, settled.version + 1);
    assert.deepEqual(harness.database.authority.commandAudits.findByCommand(commandId)?.versionChanges,
      [{ target: { family: "worker-browser", workerId: WORKER_1 }, before: before.version, after: settled.version }]);
    assert.equal(harness.database.authority.workerControls.get(commandId)?.phase.state, "succeeded");
  });

  it("drives the composed pause→resume round-trip: durable directives at the command's now, versioned and audited", async () => {
    const harness = await openControlHarness();
    await spawnPoolWorker(harness, MEMBER_1);

    const pauseAt = harness.clock.now().toISOString();
    const pauseId = nextCommandId();
    const paused = await harness.kernel.executeWorkerPool({
      ...envelope(harness, pauseId),
      type: "pause-worker",
      target: { workerId: WORKER_1, expectedVersion: 1, controlBasis: servedControlBasis(harness.database, WORKER_1) },
      reason: "operator break",
    });
    assert.deepEqual(paused, {
      state: "applied",
      commandId: pauseId,
      affectedTargets: [{ family: "worker-browser", workerId: WORKER_1 }],
    });
    const afterPause = harness.database.authority.workerLeases.get(WORKER_1);

    assert.deepEqual(afterPause?.control, {
      directive: "pause", requestedAt: pauseAt, requestedBy: "local-operator", reason: "operator break",
    });
    assert.equal(afterPause?.version, 3);
    assert.deepEqual(harness.database.authority.commandAudits.findByCommand(pauseId)?.versionChanges, [
      { target: { family: "worker-browser", workerId: WORKER_1 }, before: 2, after: 3 },
    ]);

    harness.clock.advanceWall(60_000);
    const resumeAt = harness.clock.now().toISOString();
    const resumeId = nextCommandId();
    const resumed = await harness.kernel.executeWorkerPool({
      ...envelope(harness, resumeId),
      type: "resume-worker",
      target: { workerId: WORKER_1, expectedVersion: 2, controlBasis: servedControlBasis(harness.database, WORKER_1) },
    });
    assert.deepEqual(resumed, {
      state: "applied",
      commandId: resumeId,
      affectedTargets: [{ family: "worker-browser", workerId: WORKER_1 }],
    });
    const afterResume = harness.database.authority.workerLeases.get(WORKER_1);
    assert.deepEqual(afterResume?.control, {
      directive: "run", requestedAt: resumeAt, requestedBy: "local-operator",
    });
    assert.equal(afterResume?.version, 5);
    assert.deepEqual(harness.database.authority.commandAudits.findByCommand(resumeId)?.versionChanges, [
      { target: { family: "worker-browser", workerId: WORKER_1 }, before: 4, after: 5 },
    ]);
    // The supervisor still owns the child as plain running throughout.
    assert.deepEqual(harness.control.supervisor.memberEvidence(MEMBER_1)?.state, "running");
  });
});
