import { testWorkerPorts } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import { releaseSeededWriteOwners, seedAtomicWriteOwner } from "../../../support/helpers/timeline-write-fixture.js";
import { writeFenceFixtureInput } from "../../../support/helpers/write-fence-fixture.js";
import { ATOMIC_WRITE_COMMIT, WRITE_INTENT_ATTEMPTING, WRITE_ATTEMPT } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { deriveWriteAuthorityReason } from "../../../../src/rules/write-safety/write-authority-reason.js";
import { RunRecordSchema, runClaim } from "../../../../src/models/run/record.js";
import { lifecycleCommandId } from "../../../../src/rules/identity/identifiers.js";
import { once } from "node:events";
import { initializeFailedWorkerReset } from "../../../../src/backend/app/composition/worker-compose.js";
import { createWorkerPoolRuntimeExecutor } from "../../../../src/backend/runtime/workers/worker-loop.js";
import { kernelOver } from "../../../support/helpers/backend/dashboard-pool-world.js";
import { workerCardOf } from "../../../../src/backend/runs/projections/worker-cards.js";
import type { ChildProcess } from "node:child_process";
import { createDashboardWorkerProcessSupervisor } from "../../../../src/backend/runtime/workers/worker-supervisor.js";
import { WorkerRetirementProofSchema } from "../../../../src/models/run/worker-slot.js";
import { personLookupQueuedRun, ManualScheduler } from "../../../support/helpers/phase1f-executor-harness.js";
import { admitWorkerLifecycle, admitWorkerReset } from "../../../../src/backend/storage/sqlite/worker-control.js";
import { ownedWorkerLifetimeFixture } from "../../../support/helpers/backend/worker-lifetime-world.js";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AuthorityDatabase } from "../../../support/helpers/synthetic-storage-admission.js";
import { workerPoolMember } from "../../../../src/models/run/worker-slot.js";
import { createRunRecordServiceTestWorld } from "../../../support/helpers/backend/run-record-service-world.js";
import { personLookupDescriptor } from "../../../support/helpers/registered-workflows.js";

const world = createRunRecordServiceTestWorld();
afterEach(world.cleanup);
async function fixture(fenceInOwner = false) { return ownedWorkerLifetimeFixture(world, { fenceInOwner }); }

function actualReplacement(f: Awaited<ReturnType<typeof fixture>>, commandId: string, beforeDeath?: () => void) {
  const scheduler = new ManualScheduler(f.clock);
  let birth: Promise<Awaited<ReturnType<typeof f.owner>>> | undefined;
  let spawns = 0;
  const faults: Error[] = [];
  const supervisor = createDashboardWorkerProcessSupervisor({
    launch: { command: process.execPath, environment: {}, prefixArgs: [], cwd: f.root }, clock: f.clock, scheduler,
    birth: { pollMs: 50, timeoutMs: 1000 },
    spawn: () => {
      spawns += 1;
      const binding = f.database.authority.workerControls.get(commandId)?.lifecycle;
      if (binding?.operation.kind !== "retry") throw new Error("missing original browserless binding");
      let child: ChildProcess | undefined;
      birth = (f.owner(undefined, actual => { child = actual; })).then(owner => {
        const result = f.database.startOwnedWorker({ workerId: f.slot.workerId, workflow: f.slot.workflow,
          browserSystems: binding.operation.kind === "retry" ? binding.operation.systems : [], processId: owner.pid,
          requestedBy: "local-operator", commandId, now: f.now }, owner.handle);
        if (result.state !== "started") throw new Error("replacement birth refused");
        return owner;
      });
      if (child === undefined) throw new Error("real child was not spawned");
      const actual = child;
      return { pid: actual.pid, kill: signal => actual.kill(signal),
        onExit: listener => { actual.on("exit", listener); }, onError: listener => { actual.on("error", listener); } };
    },
    assertRetainedOwnerDeath: (member, lifetime, command) => { beforeDeath?.(); f.database.assertRetainedWorkerDeath(member, lifetime, command); },
    proveRetirement: member => { f.database.assertWorkerLifecycleRelease(member.workerId); return WorkerRetirementProofSchema.parse({
      workerId: member.workerId, membershipRevision: member.membershipRevision, checkedAt: f.now,
      processStopped: true, browsersClosed: true, exclusive: true,
    }); },
    leases: { observe: id => { const lease = f.database.authority.workerLeases.get(id); return lease === undefined || lease.lifecycle.state === "stopped"
      ? undefined : { processId: lease.processId, startedAt: lease.lifecycle.startedAt }; } },
    gracefulStop: { request: () => { throw new Error("browserless replacement must not request another stop"); } },
    onFault: error => { faults.push(error); },
  });
  return { scheduler, supervisor, faults, spawns: () => spawns, birth: () => {
    if (birth === undefined) throw new Error("missing actual birth");
    return birth;
  } };
}

describe("native standing lifetime recovery", () => {
  it("refuses a peer reserved before the native grant when its raw command is admitted later", async () => {
    const f = await fixture();
    try {
      f.observe("idle");
      const lease = f.database.authority.workerLeases.get(f.slot.workerId);
      if (lease === undefined) throw new Error("missing live peer basis");
      const commandId = randomUUID(), controlBasis = { leaseGeneration: lease.leaseGeneration, controlRevision: lease.controlRevision };
      f.database.authority.workerLeases.reserveControl(f.slot.workerId, controlBasis, commandId, f.now);
      await f.shutdown();
      const grant = f.database.reserveStandingWorkerRecovery(f.slot.workerId, personLookupDescriptor, f.now);
      const request = { commandId, family: "worker-browser", type: "pause-worker", source: "dashboard", requestedAt: f.now,
        requestedBy: "local-operator", target: { workerId: f.slot.workerId, expectedVersion: lease.version, controlBasis } };
      f.database.authority.commands.insert(request);
      const before = f.database.getMeta().authorityGeneration;
      expect(() => f.database.authority.workerControls.admit({ commandId, request, scope: `worker-pool:${f.slot.workflow}`,
        executorId: randomUUID(), admittedAt: f.now, expiresAt: f.now, basisVersion: lease.version, phase: { state: "admitted" } })).toThrow("standing-recovery-reserved");
      expect(f.database.getMeta().authorityGeneration).toBe(before);
      expect(f.database.authority.workerControls.get(commandId)).toBeUndefined();
      expect(f.database.authority.workerSlots.recovery(f.slot.workerId)?.command.commandId).toBe(grant.commandId);
    } finally { await f.dispose(); }
  });

  for (const type of ["stop-worker", "remove-worker", "retry-worker"] as const) {
    it.each(["admitted", "ready", "executing", "uncertain"] as const)(`retains original pending ${type} authority after restart from %s`, async phase => {
      const f = await fixture();
      try {
        f.observe("idle");
        if (type === "retry-worker") await f.shutdown();
        const lease = f.database.authority.workerLeases.get(f.slot.workerId), pool = f.database.authority.workerPools.get(f.slot.workflow);
        if (lease === undefined || pool === undefined) throw new Error("missing exact pending authority");
        const command = { commandId: randomUUID(), family: "worker-browser", type, source: "dashboard", requestedAt: f.now,
          requestedBy: "local-operator", target: { workerId: f.slot.workerId, membershipRevision: f.slot.membershipRevision,
            ...(type === "stop-worker" ? {} : { workflowId: f.slot.workflow, expectedVersion: pool.version }),
            controlBasis: { leaseGeneration: lease.leaseGeneration, controlRevision: lease.controlRevision } } };
        const record = f.database.withAuthorityTransaction(repositories => type === "stop-worker"
          ? admitWorkerReset(repositories, command, randomUUID(), f.now)
          : admitWorkerLifecycle(repositories, command, randomUUID(), f.now, { descriptor: personLookupDescriptor, mode: "initialize" }));
        if (phase === "ready") f.database.authority.workerControls.transition(record.commandId, "admitted", { state: "ready" });
        if (phase === "executing" || phase === "uncertain") f.database.authority.workerControls.transition(record.commandId, "admitted", { state: "executing", startedAt: f.now });
        if (phase === "uncertain") f.database.authority.workerControls.transition(record.commandId, "executing", { state: "uncertain", startedAt: f.now, observedAt: f.now, message: "controlled-crash-window" });
        const reopened = AuthorityDatabase.open({ path: join(f.root, "state.db"), migrationOwner: "unit-test", busyTimeoutMs: 250 }, f.clock);
        try {
          const expired = new Date(Date.parse(record.expiresAt) + 1).toISOString();
          reopened.reconcileWorkerControlMilestones(expired);
          const retained = reopened.authority.workerControls.get(record.commandId);
          expect(retained).toMatchObject({ request: record.request, phase: { state: "uncertain" } });
          expect(retained?.reset).toEqual(record.reset);
          expect(retained?.lifecycle).toEqual(record.lifecycle);
          expect(reopened.authority.workerControls.pending(record.scope)).toHaveLength(1);
          expect(reopened.authority.commandAudits.findByCommand(record.commandId)).toBeUndefined();
          expect(reopened.authority.workerSlots.get(f.slot.workerId)?.retiredAt).toBeNull();
          expect(reopened.authority.workerPools.get(f.slot.workflow)).toEqual(pool);
          expect(reopened.authority.workerLeases.get(f.slot.workerId)?.leaseGeneration).toBe(lease.leaseGeneration);
          expect(() => reopened.authority.runs.claimNext({ workerId: f.slot.workerId, workflow: f.slot.workflow,
            workerLifetime: { membershipRevision: f.slot.membershipRevision, leaseGeneration: lease.leaseGeneration }, now: expired })).toThrow();
          expect(reopened.authority.runs.listByWorkflow(f.slot.workflow)).toEqual([]);
          expect(reopened.authority.workerControls.browsers(f.slot.workerId)).toEqual([]);
        } finally { reopened.close(); }
      } finally { await f.dispose(); }
    });
  }

  it("keeps a dead replacement's original native grant reserved without a settled audit", async () => {
    const f = await fixture();
    try {
      f.observe("idle"); await f.shutdown();
      const grant = f.database.reserveStandingWorkerRecovery(f.slot.workerId, personLookupDescriptor, f.now);
      if (grant.binding.operation.kind !== "retry") throw new Error("missing native replacement");
      const replacement = await f.owner();
      const born = f.database.startOwnedWorker({ workerId: f.slot.workerId, workflow: f.slot.workflow,
        browserSystems: grant.binding.operation.systems, processId: replacement.pid, requestedBy: "local-operator",
        commandId: grant.commandId, now: f.now }, replacement.handle);
      if (born.state !== "started") throw new Error("missing actual new birth");
      const exited = once(replacement.child, "exit"); replacement.child.kill("SIGTERM"); await exited; replacement.handle.release();
      f.database.authority.workerLeases.reportLifecycle({ workerId: f.slot.workerId, leaseGeneration: born.lease.leaseGeneration, now: f.now,
        lifecycle: { state: "stopped", startedAt: born.lease.lifecycle.startedAt, stoppedAt: f.now, reason: "crashed" } });
      expect(() => f.database.completeStandingWorkerRecovery(grant.commandId, replacement.handle, personLookupDescriptor, f.now)).toThrow();
      f.clock.advanceWall(86_400_000);
      expect(f.database.authority.workerSlots.recovery(f.slot.workerId)?.command.commandId).toBe(grant.commandId);
      expect(f.database.authority.lifecycleJournal.findAuditByCommand(grant.commandId)).toBeUndefined();
      expect(f.database.authority.workerLeases.get(f.slot.workerId)?.birthCommandId).toBe(born.lease.birthCommandId);
      expect(f.database.authority.workerLeases.get(f.slot.workerId)?.leaseGeneration).toBe(born.lease.leaseGeneration);
    } finally { await f.dispose(); }
  });

  it("refuses native recovery for a retired member in a zero-size pool", async () => {
    const f = await fixture();
    try {
      f.observe("idle"); await f.shutdown();
      const pool = f.database.authority.workerPools.get(f.slot.workflow);
      if (pool === undefined) throw new Error("missing roster pool");
      f.database.withAuthorityTransaction(repositories => {
        const commandId = randomUUID();
        repositories.commands.insert({ commandId, family: "worker-browser", type: "plan-worker-count", requestedBy: "local-operator",
          source: "dashboard", requestedAt: f.now, target: { workflowId: f.slot.workflow, expectedVersion: pool.version }, payload: { desiredWorkers: 0 } });
        repositories.workerSlots.retire({ workerId: f.slot.workerId, expectedRevision: f.slot.membershipRevision, commandId, now: f.now });
        expect(repositories.workerPools.plan({ workflow: f.slot.workflow, desiredWorkers: 0, expectedVersion: pool.version,
          requestedBy: "local-operator", now: f.now }).state).toBe("applied");
      });
      expect(f.database.authority.workerPools.get(f.slot.workflow)?.desiredWorkers).toBe(0);
      expect(f.database.authority.workerSlots.get(f.slot.workerId)?.retiredAt).toBe(f.now);
      expect(() => f.database.reserveStandingWorkerRecovery(f.slot.workerId, personLookupDescriptor, f.now)).toThrow("standing-recovery-ineligible");
    } finally { await f.dispose(); }
  });

  it.each(["idle", "paused"] as const)("preserves actual %s intent through staged shutdown and commits owner audit before claims", async phase => {
    const f = await fixture();
    try {
      f.observe(phase);
      await f.shutdown();
      expect(f.database.authority.workerLeases.get(f.slot.workerId)?.recoveryBasis?.state).toBe(phase);
      const originalPool = f.database.authority.workerPools.get(f.slot.workflow);
      const grant = f.database.reserveStandingWorkerRecovery(f.slot.workerId, personLookupDescriptor, f.now);
      expect(grant.previous.state).toBe(phase);
      expect(() => f.database.authority.runs.claimNext({ workflow: f.slot.workflow, workerId: f.slot.workerId, now: f.now })).toThrow("standing-recovery-reserved");
      expect(() => f.database.authority.workerPools.plan({ workflow: f.slot.workflow, desiredWorkers: 0,
        expectedVersion: originalPool?.version, requestedBy: "local-operator", now: f.now })).toThrow("standing-recovery-reserved");
      expect(() => f.database.authority.workerSlots.allocate({ workflow: f.slot.workflow, poolIndex: 2, commandId: randomUUID(), now: f.now })).toThrow("standing-recovery-reserved");
      expect(() => f.database.authority.workerSlots.retire({ workerId: f.slot.workerId, expectedRevision: f.slot.membershipRevision, commandId: randomUUID(), now: f.now })).toThrow("standing-recovery-reserved");
      expect(() => f.database.authority.workerLeases.start({ workerId: f.slot.workerId, workflow: f.slot.workflow,
        browserSystems: ["ucpath", "crm"], processId: process.pid, requestedBy: "local-operator", commandId: grant.commandId, now: f.now })).toThrow("standing-recovery-reserved");
      const replacement = await f.owner();
      if (grant.binding.operation.kind !== "retry") throw new Error("missing recovery operation");
      const born = f.database.startOwnedWorker({ workerId: f.slot.workerId, workflow: f.slot.workflow,
        browserSystems: grant.binding.operation.systems, processId: replacement.pid, requestedBy: "local-operator", commandId: grant.commandId, now: f.now }, replacement.handle);
      expect(born.state).toBe("started");
      if (born.state !== "started") throw new Error("replacement not born");
      const before = f.database.getMeta().authorityGeneration;
      expect(() => f.database.completeStandingWorkerRecovery(grant.commandId, { ...replacement.handle }, personLookupDescriptor, f.now)).toThrow("birth-custody-unavailable");
      expect(() => f.database.completeStandingWorkerRecovery(grant.commandId, f.old.handle, personLookupDescriptor, f.now)).toThrow("birth-custody-unavailable");
      expect(f.database.getMeta().authorityGeneration).toBe(before);
      expect(() => f.database.withAuthorityTransaction(() => {
        f.database.completeStandingWorkerRecovery(grant.commandId, replacement.handle, personLookupDescriptor, f.now);
        throw new Error("controlled-outer-rollback");
      })).toThrow("controlled-outer-rollback");
      expect(f.database.authority.workerSlots.recovery(f.slot.workerId)?.command.commandId).toBe(grant.commandId);
      expect(f.database.authority.lifecycleJournal.findAuditByCommand(grant.commandId)).toBeUndefined();
      expect(f.database.authority.workerLeases.get(f.slot.workerId)?.lifecycle.state).toBe("starting");
      f.database.completeStandingWorkerRecovery(grant.commandId, replacement.handle, personLookupDescriptor, f.now);
      expect(f.database.authority.workerLeases.get(f.slot.workerId)).toMatchObject({ leaseGeneration: f.started.leaseGeneration + 1,
        lifecycle: { state: phase }, control: { directive: phase === "paused" ? "pause" : "run" } });
      expect(workerPoolMember(f.database.authority.workerSlots.get(f.slot.workerId) ?? f.slot)).toEqual(workerPoolMember(f.slot));
      expect(f.database.authority.workerPools.get(f.slot.workflow)).toEqual(originalPool);
      const reopened = AuthorityDatabase.open({ path: join(f.root, "state.db"), migrationOwner: "unit-test", busyTimeoutMs: 250 }, f.clock);
      try { expect(reopened.authority.lifecycleJournal.findAuditByCommand(grant.commandId)).toMatchObject({ result: { kind: "worker-recovery", phase,
        oldLeaseGeneration: f.started.leaseGeneration, leaseGeneration: born.lease.leaseGeneration } }); } finally { reopened.close(); }
      expect(f.database.authority.workerSlots.recovery(f.slot.workerId)).toBeUndefined();
      expect(f.database.authority.runs.listByWorkflow(f.slot.workflow)).toEqual([]);
      expect(f.database.authority.workerControls.browsers(f.slot.workerId)).toEqual([]);
    } finally { await f.dispose(); }
  });

  for (const type of ["retry-worker", "stop-worker"] as const) {
    it.each(["starting", "busy", "waiting"] as const)(`admits explicit ${type} after a proven shutdown hard loss from %s`, async phase => {
      const f = await fixture();
      try {
        f.observe(phase); await f.shutdown();
        f.database.assertRetainedWorkerDeath(workerPoolMember(f.slot), {
          leaseGeneration: f.started.leaseGeneration, processId: f.started.processId, startedAt: f.started.lifecycle.startedAt,
        }, f.started.birthCommandId);
        const lease = f.database.authority.workerLeases.get(f.slot.workerId);
        if (lease === undefined) throw new Error("missing stopped lifetime");
        const pool = f.database.authority.workerPools.get(f.slot.workflow);
        const command = { commandId: randomUUID(), family: "worker-browser", type, source: "dashboard", requestedAt: f.now,
          requestedBy: "local-operator", target: { workerId: f.slot.workerId, membershipRevision: f.slot.membershipRevision,
            ...(type === "retry-worker" ? { workflowId: f.slot.workflow, expectedVersion: pool?.version } : {}),
            controlBasis: { leaseGeneration: lease.leaseGeneration, controlRevision: lease.controlRevision } } };
        const operation = f.database.withAuthorityTransaction(repositories => type === "stop-worker"
          ? admitWorkerReset(repositories, command, randomUUID(), f.now, personLookupDescriptor)
          : admitWorkerLifecycle(repositories, command, randomUUID(), f.now, { descriptor: personLookupDescriptor, mode: "initialize" }));
        expect(operation.lifecycle).toMatchObject({ member: workerPoolMember(f.slot), lifetime: { leaseGeneration: lease.leaseGeneration },
          operation: { kind: "retry", mode: type === "stop-worker" ? "browserless" : "initialize" } });
        expect(f.database.authority.workerControls.pending(operation.scope)).toHaveLength(1);
        expect(f.database.authority.workerPools.get(f.slot.workflow)).toEqual(pool);
        expect(f.database.authority.runs.listByWorkflow(f.slot.workflow)).toEqual([]);
        expect(f.database.authority.workerControls.browsers(f.slot.workerId)).toEqual([]);
        expect(f.database.authority.commandAudits.findByCommand(operation.commandId)).toBeUndefined();
      } finally { await f.dispose(); }
    });
  }

  it.each(["starting", "busy", "waiting"] as const)("never recovers a %s hard loss as a healthy standing member", async phase => {
    const f = await fixture();
    try {
      f.observe(phase); await f.shutdown();
      const before = f.database.getMeta().authorityGeneration;
      expect(() => f.database.reserveStandingWorkerRecovery(f.slot.workerId, personLookupDescriptor, f.now)).toThrow("standing-recovery-ineligible");
      expect(f.database.getMeta().authorityGeneration).toBe(before);
      expect(f.database.authority.workerSlots.recovery(f.slot.workerId)).toBeUndefined();
    } finally { await f.dispose(); }
  });
});


it.each(["absent", "current"] as const)("dispatches one public failed Stop with %s old work independently of its pending response and commits fresh browserless idle", async work => {
  const f = await fixture();
  try {
    f.observe("waiting");
    let oldRunId: string | undefined;
    if (work === "current") {
      const original = RunRecordSchema.parse(personLookupQueuedRun()); oldRunId = randomUUID();
      f.database.authority.runs.enqueue({ ...original, envelope: { ...original.envelope, runId: oldRunId, itemId: randomUUID() } });
      const claim = f.database.authority.runs.claimNext({ workerId: f.slot.workerId, workflow: f.slot.workflow, now: f.now,
        workerLifetime: { membershipRevision: f.slot.membershipRevision, leaseGeneration: f.started.leaseGeneration } });
      expect(claim.state).toBe("claimed");
      f.database.authority.workerLeases.reportLifecycle({ workerId: f.slot.workerId, leaseGeneration: f.started.leaseGeneration, now: f.now,
        lifecycle: { state: "busy", startedAt: f.started.lifecycle.startedAt, heartbeatAt: f.now, runId: oldRunId } });
    }
    await f.shutdown();
    const old = f.database.authority.workerLeases.get(f.slot.workerId);
    if (old === undefined) throw new Error("missing old lifetime");
    const command = {
      commandId: randomUUID(), family: "worker-browser", type: "stop-worker", source: "dashboard", requestedAt: f.now,
      requestedBy: "local-operator", target: { workerId: f.slot.workerId, membershipRevision: f.slot.membershipRevision,
        controlBasis: { leaseGeneration: old.leaseGeneration, controlRevision: old.controlRevision } },
    };
    const actual = actualReplacement(f, command.commandId), { scheduler, supervisor } = actual;
    const pool = createWorkerPoolRuntimeExecutor(supervisor, f.database.authority.workerSlots, { database: f.database, clock: f.clock });
    const kernel = kernelOver(f.database, f.clock, pool);
    expect(await kernel.executeWorkerPool(command)).toEqual({ state: "pending", commandId: command.commandId });
    expect(await kernel.executeWorkerPool(command)).toEqual({ state: "pending", commandId: command.commandId });
    const lostResponse = AuthorityDatabase.open({ path: join(f.root, "state.db"), migrationOwner: "unit-test", busyTimeoutMs: 250 }, f.clock);
    try { expect(await kernelOver(lostResponse, f.clock, pool).executeWorkerPool(command)).toEqual({ state: "pending", commandId: command.commandId }); }
    finally { lostResponse.close(); }
    const record = f.database.authority.workerControls.get(command.commandId);
    if (record?.reset === undefined || record.lifecycle?.operation.kind !== "retry") throw new Error("missing admitted original Stop");
    await new Promise<void>(resolve => { setImmediate(resolve); });
    const replacement = await actual.birth();
    expect(() => f.database.authority.runs.claimNext({ workerId: f.slot.workerId, workflow: f.slot.workflow,
      workerLifetime: { membershipRevision: f.slot.membershipRevision, leaseGeneration: old.leaseGeneration + 1 }, now: f.now })).toThrow();
    expect(() => f.database.completeFailedWorkerReset(record.commandId, replacement.handle, personLookupDescriptor, f.now)).toThrow();
    let initialized = false;
    const initialize = initializeFailedWorkerReset({ database: f.database, commandId: record.commandId,
      leaseGeneration: old.leaseGeneration + 1, descriptor: personLookupDescriptor, handle: replacement.handle,
      signal: new AbortController().signal, clock: f.clock, scheduler }).then(() => { initialized = true; });
    expect(initialized).toBe(false);
    expect(f.database.authority.commandAudits.findByCommand(record.commandId)).toBeUndefined();
    const peer = { ...command, commandId: randomUUID(), target: { ...command.target,
      controlBasis: { leaseGeneration: old.leaseGeneration + 1, controlRevision: 1 } } };
    expect(await kernel.executeWorkerPool(peer)).toMatchObject({ state: "rejected" });
    expect(f.database.authority.workerControls.get(peer.commandId)).toBeUndefined();
    expect(f.database.authority.commands.get(peer.commandId)).toBeUndefined();
    for (const entry of scheduler.pending()) entry.fire();
    await new Promise<void>(resolve => { setImmediate(resolve); });
    expect(f.database.authority.workerControls.get(record.commandId)?.effect).toBeDefined();
    expect(initialized).toBe(false);
    const stopping = new AbortController(); stopping.abort(new Error("new owner lifetime is shutting down"));
    await expect(initializeFailedWorkerReset({ database: f.database, commandId: record.commandId,
      leaseGeneration: old.leaseGeneration + 1, descriptor: personLookupDescriptor, handle: replacement.handle,
      signal: stopping.signal, clock: f.clock, scheduler })).rejects.toThrow("initialization-aborted");
    expect(f.database.authority.commandAudits.findByCommand(record.commandId)).toBeUndefined();
    expect(() => f.database.completeFailedWorkerReset(record.commandId, { ...replacement.handle }, personLookupDescriptor, f.now)).toThrow();
    expect(() => f.database.withAuthorityTransaction(() => {
      f.database.completeFailedWorkerReset(record.commandId, replacement.handle, personLookupDescriptor, f.now);
      throw new Error("controlled-final-rollback");
    })).toThrow("controlled-final-rollback");
    expect(f.database.authority.commandAudits.findByCommand(record.commandId)).toBeUndefined();
    expect(f.database.authority.workerLeases.get(f.slot.workerId)?.lifecycle.state).toBe("starting");
    for (const entry of scheduler.pending()) entry.fire();
    await initialize;
    expect(initialized).toBe(true);
    expect(actual.spawns()).toBe(1);
    expect(actual.faults).toEqual([]);
    expect(await kernel.executeWorkerPool(command)).toMatchObject({ state: "already-applied", commandId: command.commandId });
    expect(actual.spawns()).toBe(1);
    expect(f.database.authority.workerControls.get(record.commandId)?.phase).toMatchObject({ state: "succeeded", acknowledgement: {
      kind: "reset-replacement", commandId: record.commandId, oldLeaseGeneration: old.leaseGeneration,
      leaseGeneration: old.leaseGeneration + 1, closedSessionIds: [], browsersClosed: true, duoReleased: true,
    } });
    expect(f.database.authority.commandAudits.findByCommand(record.commandId)?.result.state).toBe("applied");
    expect(f.database.authority.workerLeases.get(f.slot.workerId)?.lifecycle.state).toBe("idle");
    expect(f.database.authority.workerControls.pending(record.scope)).toEqual([]);
    expect(f.database.authority.workerControls.browsers(f.slot.workerId)).toEqual([]);
    expect(f.database.authority.runs.listByWorkflow(f.slot.workflow).filter(run => run.envelope.runId !== oldRunId)).toEqual([]);
    if (oldRunId !== undefined) expect(f.database.authority.runs.get(oldRunId)?.lifecycle).toMatchObject({ state: "terminal", outcome: "cancelled" });
    expect(() => f.database.completeFailedWorkerReset(record.commandId, replacement.handle, personLookupDescriptor, f.now)).toThrow();
    const confirmation = f.database.authority.workerControls.get(record.commandId);
    f.database.authority.runs.enqueue(personLookupQueuedRun());
    const claimed = f.database.authority.runs.claimNext({ workerId: f.slot.workerId, workflow: f.slot.workflow,
      workerLifetime: { membershipRevision: f.slot.membershipRevision, leaseGeneration: old.leaseGeneration + 1 }, now: f.now });
    expect(claimed.state).toBe("claimed");
    if (claimed.state !== "claimed") throw new Error("durably settled owner could not claim next real work");
    const nextLease = f.database.authority.workerLeases.get(f.slot.workerId);
    if (nextLease === undefined) throw new Error("missing new idle lifetime");
    f.database.authority.workerLeases.reportLifecycle({ workerId: f.slot.workerId, leaseGeneration: nextLease.leaseGeneration, now: f.now,
      lifecycle: { state: "busy", startedAt: nextLease.lifecycle.startedAt, heartbeatAt: f.now, runId: claimed.run.envelope.runId } });
    expect(f.database.authority.workerControls.get(record.commandId)).toEqual(confirmation);
    const running = f.database.authority.workerLeases.get(f.slot.workerId);
    if (running === undefined || confirmation === undefined) throw new Error("missing confirmed running authority");
    const card = workerCardOf({ lease: running, member: f.slot, ownerAlive: f.database.workerLifetimeCustody(f.slot.workerId).state === "alive",
      owned: true, fold: undefined, operations: [confirmation], observations: [], resolveRun: id => f.database.authority.runs.get(id) });
    expect(card.state).toBe("running");
    expect(card.controls?.operation).toMatchObject({ commandId: record.commandId, type: "stop-worker", state: "succeeded", unresolved: false });
    expect(card.currentRun).toMatchObject({ state: "present", runId: claimed.run.envelope.runId });
    const reopened = AuthorityDatabase.open({ path: join(f.root, "state.db"), migrationOwner: "unit-test", busyTimeoutMs: 250 }, f.clock);
    try {
      expect(reopened.authority.workerControls.get(record.commandId)).toEqual(confirmation);
      expect(reopened.authority.workerLeases.get(f.slot.workerId)?.lifecycle.state).toBe("busy");
    } finally { reopened.close(); }
  } finally { await f.dispose(); }
});


it("finishes Retry from its original durable authenticated birth milestone after restart", async () => {
  const f = await fixture();
  try {
    f.observe("starting"); await f.shutdown();
    const lease = f.database.authority.workerLeases.get(f.slot.workerId), pool = f.database.authority.workerPools.get(f.slot.workflow);
    if (lease === undefined || pool === undefined) throw new Error("missing failed lifetime");
    const record = f.database.withAuthorityTransaction(repositories => admitWorkerLifecycle(repositories, {
      commandId: randomUUID(), family: "worker-browser", type: "retry-worker", source: "dashboard", requestedAt: f.now,
      requestedBy: "local-operator", target: { workerId: f.slot.workerId, workflowId: f.slot.workflow,
        membershipRevision: f.slot.membershipRevision, expectedVersion: pool.version,
        controlBasis: { leaseGeneration: lease.leaseGeneration, controlRevision: lease.controlRevision } },
    }, randomUUID(), f.now, { descriptor: personLookupDescriptor, mode: "initialize" }));
    if (record.lifecycle === undefined) throw new Error("missing Retry binding");
    f.database.authority.workerControls.transition(record.commandId, "admitted", { state: "executing", startedAt: f.now });
    const actual = actualReplacement(f, record.commandId);
    if (actual.supervisor.retryWorker === undefined) throw new Error("missing actual replacement owner");
    const effect = actual.supervisor.retryWorker(record.lifecycle);
    await new Promise<void>(resolve => { setImmediate(resolve); });
    await actual.birth();
    for (const entry of actual.scheduler.pending()) entry.fire();
    f.database.observeWorkerLifecycleEffect(record.commandId, await effect, f.now);
    expect(f.database.authority.commandAudits.findByCommand(record.commandId)).toBeUndefined();
    const reopened = AuthorityDatabase.open({ path: join(f.root, "state.db"), migrationOwner: "unit-test", busyTimeoutMs: 250 }, f.clock);
    try {
      reopened.reconcileWorkerControlMilestones(f.now);
      const settled = reopened.authority.workerControls.get(record.commandId);
      expect(settled).toMatchObject({ request: record.request, phase: { state: "succeeded", acknowledgement: {
        kind: "retry", oldLeaseGeneration: lease.leaseGeneration, leaseGeneration: lease.leaseGeneration + 1,
      } }, readiness: { state: "initializing", leaseGeneration: lease.leaseGeneration + 1 } });
      expect(reopened.authority.commandAudits.findByCommand(record.commandId)?.result.state).toBe("applied");
      expect(reopened.authority.workerLeases.get(f.slot.workerId)?.lifecycle.state).toBe("starting");
      expect(() => reopened.authority.runs.claimNext({ workerId: f.slot.workerId, workflow: f.slot.workflow,
        workerLifetime: { membershipRevision: f.slot.membershipRevision, leaseGeneration: lease.leaseGeneration + 1 }, now: f.now })).toThrow();
      reopened.reconcileWorkerControlMilestones(f.now);
      expect(reopened.authority.workerControls.get(record.commandId)).toEqual(settled);
      expect(reopened.authority.workerPools.get(f.slot.workflow)).toEqual(pool);
      expect(reopened.authority.runs.listByWorkflow(f.slot.workflow)).toEqual([]);
      expect(reopened.authority.workerControls.browsers(f.slot.workerId)).toEqual([]);
      expect(actual.spawns()).toBe(1);
    } finally { reopened.close(); }
  } finally { await f.dispose(); }
});


it("rolls back safe provisional old-work cancellation when replacement owner death cannot be proved", async () => {
  const f = await fixture();
  try {
    f.database.authority.runs.enqueue(personLookupQueuedRun());
    const claim = f.database.authority.runs.claimNext({ workerId: f.slot.workerId, workflow: f.slot.workflow, now: f.now,
      workerLifetime: { membershipRevision: f.slot.membershipRevision, leaseGeneration: f.started.leaseGeneration } });
    if (claim.state !== "claimed") throw new Error("missing genuine old claim");
    f.database.authority.workerLeases.reportLifecycle({ workerId: f.slot.workerId, leaseGeneration: f.started.leaseGeneration, now: f.now,
      lifecycle: { state: "busy", startedAt: f.started.lifecycle.startedAt, heartbeatAt: f.now, runId: claim.run.envelope.runId } });
    await f.shutdown();
    const beforeLease = f.database.authority.workerLeases.get(f.slot.workerId), beforeRun = f.database.authority.runs.get(claim.run.envelope.runId);
    if (beforeLease === undefined || beforeRun === undefined) throw new Error("missing exact rollback authority");
    const command = { commandId: randomUUID(), family: "worker-browser", type: "stop-worker", source: "dashboard", requestedAt: f.now,
      requestedBy: "local-operator", target: { workerId: f.slot.workerId, membershipRevision: f.slot.membershipRevision,
        controlBasis: { leaseGeneration: beforeLease.leaseGeneration, controlRevision: beforeLease.controlRevision } } };
    let inspected = false;
    const actual = actualReplacement(f, command.commandId, () => {
      inspected = true;
      expect(f.database.authority.runs.get(beforeRun.envelope.runId)?.lifecycle).toMatchObject({ state: "terminal", outcome: "cancelled" });
      expect(f.database.authority.workerControls.get(command.commandId)?.phase.state).toBe("executing");
      throw new Error("worker-retry-death-unproved");
    });
    const pool = createWorkerPoolRuntimeExecutor(actual.supervisor, f.database.authority.workerSlots, { database: f.database, clock: f.clock });
    const generation = f.database.getMeta().authorityGeneration, beforeSlot = f.database.authority.workerSlots.get(f.slot.workerId), beforePool = f.database.authority.workerPools.get(f.slot.workflow);
    expect(await kernelOver(f.database, f.clock, pool).executeWorkerPool(command)).toMatchObject({ state: "rejected", message: "worker-retry-death-unproved" });
    expect(inspected).toBe(true);
    expect(actual.spawns()).toBe(0);
    expect(f.database.getMeta().authorityGeneration).toBe(generation);
    expect(f.database.authority.runs.get(beforeRun.envelope.runId)).toEqual(beforeRun);
    expect(f.database.authority.workerLeases.get(f.slot.workerId)).toEqual(beforeLease);
    expect(f.database.authority.workerSlots.get(f.slot.workerId)).toEqual(beforeSlot);
    expect(f.database.authority.workerPools.get(f.slot.workflow)).toEqual(beforePool);
    expect(f.database.authority.commands.get(command.commandId)).toBeUndefined();
    expect(f.database.authority.workerControls.get(command.commandId)).toBeUndefined();
    expect(f.database.authority.commandAudits.findByCommand(command.commandId)).toBeUndefined();
    const cancellation = lifecycleCommandId("reset-current-cancel", { commandId: command.commandId, runId: beforeRun.envelope.runId });
    expect(f.database.authority.lifecycleJournal.getCommand(cancellation)).toBeUndefined();
    expect(f.database.authority.lifecycleJournal.findAuditByCommand(cancellation)).toBeUndefined();
  } finally { await f.dispose(); }
});


it.each(["attempting", "unknown"] as const)("preserves exact %s write authority during public failed Stop", async outcome => {
  const f = await fixture(true);
  try {
    const commit = { ...ATOMIC_WRITE_COMMIT, transaction: { ...ATOMIC_WRITE_COMMIT.transaction, workflowId: f.slot.workflow },
      committedSpan: { ...ATOMIC_WRITE_COMMIT.committedSpan, workflowId: f.slot.workflow } };
    seedAtomicWriteOwner(f.database, commit, join(f.root, "state.db"), 1);
    await f.fence(writeFenceFixtureInput(f.database, { intent: { ...WRITE_INTENT_ATTEMPTING, workflowId: f.slot.workflow }, attempt: WRITE_ATTEMPT }));
    const run = f.database.authority.runs.get(WRITE_INTENT_ATTEMPTING.runId);
    const claim = run === undefined ? undefined : runClaim(run);
    if (run === undefined || claim === undefined || claim.workerId !== f.slot.workerId) throw new Error("missing exact old write owner");
    if (outcome === "unknown") {
      f.database.authority.writeIntents.parkAttempt({ writeIntentId: WRITE_INTENT_ATTEMPTING.writeIntentId, generation: 1, expectedVersion: 1,
        code: "unknown", message: "controlled original unknown", authorityReason: deriveWriteAuthorityReason("recovery-probe-unknown", "probe", "controlled original unknown"), now: f.now });
      expect(f.database.authority.runs.transition({ runId: run.envelope.runId, expectedVersion: run.version,
        claim: { workerId: claim.workerId, claimGeneration: claim.claimGeneration }, lifecycle: { state: "parked-write",
          writeIntentId: WRITE_INTENT_ATTEMPTING.writeIntentId, intentGeneration: 1, parkedAt: f.now, code: "unknown", message: "controlled original unknown" }, now: f.now }).state).toBe("applied");
    }
    f.database.authority.workerLeases.reportLifecycle({ workerId: f.slot.workerId, leaseGeneration: f.started.leaseGeneration, now: f.now,
      lifecycle: outcome === "attempting" ? { state: "busy", startedAt: f.started.lifecycle.startedAt, heartbeatAt: f.now, runId: run.envelope.runId }
        : { state: "waiting", startedAt: f.started.lifecycle.startedAt, heartbeatAt: f.now, activity: "closing" } });
    await f.shutdown();
    const old = f.database.authority.workerLeases.get(f.slot.workerId);
    if (old === undefined) throw new Error("missing stopped write lifetime");
    const command = { commandId: randomUUID(), family: "worker-browser", type: "stop-worker", source: "dashboard", requestedAt: f.now,
      requestedBy: "local-operator", target: { workerId: f.slot.workerId, membershipRevision: f.slot.membershipRevision,
        controlBasis: { leaseGeneration: old.leaseGeneration, controlRevision: old.controlRevision } } };
    const actual = actualReplacement(f, command.commandId);
    const pool = createWorkerPoolRuntimeExecutor(actual.supervisor, f.database.authority.workerSlots, { database: f.database, clock: f.clock });
    const retained = () => ({ run: f.database.authority.runs.get(run.envelope.runId),
      intent: f.database.authority.writeIntents.get(WRITE_INTENT_ATTEMPTING.writeIntentId),
      attempt: f.database.authority.writeAttempts.get(WRITE_ATTEMPT.writeAttemptId), publication: f.database.authority.writeIntents.getPublication(WRITE_INTENT_ATTEMPTING.writeIntentId) });
    const before = retained(), generation = f.database.getMeta().authorityGeneration;
    const result = await kernelOver(f.database, f.clock, pool).executeWorkerPool(command);
    if (outcome === "attempting") {
      expect(result).toMatchObject({ state: "rejected", message: "worker-reset-write-callback-unresolved" });
      expect(f.database.getMeta().authorityGeneration).toBe(generation);
      expect(f.database.authority.workerControls.get(command.commandId)).toBeUndefined();
      expect(f.database.authority.commands.get(command.commandId)).toBeUndefined();
      expect(f.database.authority.workerLeases.get(f.slot.workerId)).toEqual(old);
      expect(actual.spawns()).toBe(0);
    } else {
      expect(result).toMatchObject({ state: "pending" });
      await new Promise<void>(resolve => { setImmediate(resolve); });
      const replacement = await actual.birth();
      for (const entry of actual.scheduler.pending()) entry.fire();
      await new Promise<void>(resolve => { setImmediate(resolve); });
      await initializeFailedWorkerReset({ database: f.database, commandId: command.commandId,
        leaseGeneration: old.leaseGeneration + 1, descriptor: personLookupDescriptor, handle: replacement.handle,
        signal: new AbortController().signal, clock: f.clock, scheduler: actual.scheduler });
      expect(f.database.authority.workerLeases.get(f.slot.workerId)?.lifecycle.state).toBe("idle");
      expect(f.database.authority.workerControls.get(command.commandId)?.phase.state).toBe("succeeded");
      expect(actual.spawns()).toBe(1);
    }
    expect(retained()).toEqual(before);
  } finally { await f.dispose(); }
});


it("rolls back a failed Stop with a separately claimed foreign cascade before terminal cancellation", async () => {
  const f = await fixture();
  try {
    testWorkerPorts(f.database, f.clock, { path: join(f.root, "state.db"), descriptor: personLookupDescriptor, poolIndex: 2 });
    const other = f.database.authority.workerSlots.list(f.slot.workflow).find(member => member.workerId !== f.slot.workerId);
    const otherLease = other === undefined ? undefined : f.database.authority.workerLeases.get(other.workerId);
    if (other === undefined || otherLease === undefined) throw new Error("missing admitted foreign owner");
    const parent = RunRecordSchema.parse(personLookupQueuedRun()); f.database.authority.runs.enqueue(parent);
    expect(f.database.authority.runs.claimNext({ workerId: f.slot.workerId, workflow: f.slot.workflow, now: f.now,
      workerLifetime: { membershipRevision: f.slot.membershipRevision, leaseGeneration: f.started.leaseGeneration } }).state).toBe("claimed");
    const childId = randomUUID(), manifestId = randomUUID(), dependencyId = randomUUID();
    f.database.authority.runs.enqueue({ ...parent, envelope: { ...parent.envelope, runId: childId, itemId: childId,
      parent: { runId: parent.envelope.runId, tracePrefix: parent.envelope.traceId, edgeId: "reset-child" } } });
    const policy = { onChildFailed: "fail-parent", cascadeCancel: "cascade", afterChildRetry: "resume-parent", visibility: "inline" };
    f.database.authority.delegationManifests.insert({ manifestId, parentRunId: parent.envelope.runId, edgeId: "reset-child",
      inputSchemaHash: "a".repeat(64), resultSchemaHash: "b".repeat(64), cardinality: "one", join: "one", policy,
      children: [{ dependencyId, childRunId: childId, childItemId: childId, canonicalInputFingerprint: "a".repeat(64) }], createdAt: f.now, manifestFingerprint: "a".repeat(64) });
    f.database.authority.dependencies.insert({ dependencyId, manifestId, edgeId: "reset-child", parentRunId: parent.envelope.runId,
      childRunId: childId, childItemId: childId, policy, state: "active", version: 1, createdAt: f.now, updatedAt: f.now });
    expect(f.database.authority.runs.claimNext({ workerId: other.workerId, workflow: f.slot.workflow, now: f.now,
      workerLifetime: { membershipRevision: other.membershipRevision, leaseGeneration: otherLease.leaseGeneration } }).state).toBe("claimed");
    f.database.authority.workerLeases.reportLifecycle({ workerId: f.slot.workerId, leaseGeneration: f.started.leaseGeneration, now: f.now,
      lifecycle: { state: "busy", startedAt: f.started.lifecycle.startedAt, heartbeatAt: f.now, runId: parent.envelope.runId } });
    await f.shutdown();
    const old = f.database.authority.workerLeases.get(f.slot.workerId);
    if (old === undefined) throw new Error("missing stopped parent lifetime");
    const command = { commandId: randomUUID(), family: "worker-browser", type: "stop-worker", source: "dashboard", requestedAt: f.now,
      requestedBy: "local-operator", target: { workerId: f.slot.workerId, membershipRevision: f.slot.membershipRevision,
        controlBasis: { leaseGeneration: old.leaseGeneration, controlRevision: old.controlRevision } } };
    const actual = actualReplacement(f, command.commandId);
    const pool = createWorkerPoolRuntimeExecutor(actual.supervisor, f.database.authority.workerSlots, { database: f.database, clock: f.clock });
    const before = f.database.authority.runs.listByWorkflow(f.slot.workflow), generation = f.database.getMeta().authorityGeneration;
    expect(await kernelOver(f.database, f.clock, pool).executeWorkerPool(command)).toMatchObject({ state: "rejected", message: "worker-reset-foreign-cascade-owner" });
    expect(f.database.authority.runs.listByWorkflow(f.slot.workflow)).toEqual(before);
    expect(f.database.getMeta().authorityGeneration).toBe(generation);
    expect(f.database.authority.workerLeases.get(f.slot.workerId)).toEqual(old);
    expect(f.database.authority.workerLeases.get(other.workerId)).toEqual(otherLease);
    expect(f.database.authority.workerControls.get(command.commandId)).toBeUndefined();
    expect(f.database.authority.commands.get(command.commandId)).toBeUndefined();
    expect(actual.spawns()).toBe(0);
  } finally {
    releaseSeededWriteOwners(f.database, f.clock.now().toISOString());
    await f.dispose();
  }
});
