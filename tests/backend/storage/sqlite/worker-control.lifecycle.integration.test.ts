import { WorkerControlRecordSchema, WorkerLifecycleBindingSchema } from "../../../../src/models/run/worker-control.js";
import { AuthorityDatabase } from "../../../support/helpers/synthetic-storage-admission.js";
import { WorkerRetirementProofSchema, workerPoolMember } from "../../../../src/models/run/worker-slot.js";
import { FakeWorkerChild } from "../../../support/helpers/backend/worker-supervision-world.js";
import { WorkerStopDirectiveContextSchema } from "../../../../src/backend/runtime/workers/worker-loop.js";
import { createDashboardWorkerProcessSupervisor } from "../../../../src/backend/runtime/workers/worker-supervisor.js";
import { kernelOver } from "../../../support/helpers/backend/dashboard-pool-world.js";
import { createWorkerPoolRuntimeExecutor } from "../../../../src/backend/runtime/workers/worker-loop.js";
import { seedAtomicWriteOwner } from "../../../support/helpers/timeline-write-fixture.js";
import { fenceWriteFixture } from "../../../support/helpers/write-fence-fixture.js";
import { CONFIG_SNAPSHOT, ATOMIC_WRITE_COMMIT, WRITE_INTENT_ATTEMPTING, WRITE_ATTEMPT } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { admitDirectWorker } from "../../../../src/backend/storage/sqlite/worker-slots.js";
import { dirname, join } from "node:path";
import { realpathSync } from "node:fs";
import { deriveWriteAuthorityReason } from "../../../../src/rules/write-safety/write-authority-reason.js";
import { runClaim } from "../../../../src/models/run/record.js";
import { sha256Hex } from "../../../../src/rules/validation/sha256.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { createWorkerDirectiveTestWorld } from "../../../support/helpers/backend/worker-directive-world.js";
import { testWorkerLifetime, testWorkerPorts } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import { personLookupDescriptor } from "../../../support/helpers/registered-workflows.js";
import { sequentialIdFactory } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { RunRecordService } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { selectRunRuntime } from "../../../../src/backend/runs/settings/run-settings.js";
import { initializeRetryWorker } from "../../../../src/backend/app/composition/worker-compose.js";
import { createWorkerBrowserChannel } from "../../../../src/backend/runtime/workers/worker-browser-channel.js";
import { createWorkerBrowserControl, createWorkerResetControl } from "../../../../src/backend/runtime/workers/worker-browser-control.js";
import { runWorkerLoop } from "../../../../src/backend/runtime/workers/worker-loop.js";
import { admitWorkerReset, admitWorkerLifecycle } from "../../../../src/backend/storage/sqlite/worker-control.js";
import { FingerprintSchema } from "../../../../src/rules/identity/ids.js";
import { withBoundRunConfigFingerprint, WorkerSessionManager } from "../../../../src/backend/runtime/workers/worker-sessions.js";
import { personLookupQueuedRun } from "../../../support/helpers/phase1f-executor-harness.js";
import { boundFixtureProcessLock } from "../../../support/helpers/synthetic-database-admission.js";

const world = createWorkerDirectiveTestWorld();
afterEach(world.cleanup);
async function fixture(count = 1) {
  const h = await world.loopHarness();
  for (let index = 2; index <= count; index += 1) testWorkerPorts(h.authority.database, h.authority.clock, { path: h.authority.path, descriptor: personLookupDescriptor, poolIndex: index });
  const database = h.authority.database;
  for (const lease of database.authority.workerLeases.listLive()) database.authority.workerLeases.reportLifecycle({ workerId: lease.workerId, leaseGeneration: lease.leaseGeneration,
    lifecycle: { state: "idle", startedAt: lease.lifecycle.startedAt, heartbeatAt: h.authority.clock.now().toISOString() }, now: h.authority.clock.now().toISOString() });
  return { ...h, database };
}
function request(h: Awaited<ReturnType<typeof fixture>>, workerId: string, type: "remove-worker" | "retry-worker") {
  const slot = h.database.authority.workerSlots.get(workerId), lease = h.database.authority.workerLeases.get(workerId);
  if (slot === undefined || lease === undefined) throw new Error("missing authority");
  return { commandId: randomUUID(), family: "worker-browser", type, source: "dashboard", requestedBy: "local-operator", requestedAt: h.authority.clock.now().toISOString(),
    target: { workerId, workflowId: slot.workflow, membershipRevision: slot.membershipRevision, expectedVersion: h.database.authority.workerPools.get(slot.workflow)?.version,
      controlBasis: { leaseGeneration: lease.leaseGeneration, controlRevision: lease.controlRevision } } };
}
function admit(h: Awaited<ReturnType<typeof fixture>>, workerId: string, type: "remove-worker" | "retry-worker", mode: "initialize" | "browserless" = "initialize") {
  const command = request(h, workerId, type);
  const record = h.database.withAuthorityTransaction(repositories => admitWorkerLifecycle(repositories, command, randomUUID(), command.requestedAt,
    { descriptor: personLookupDescriptor, mode }));
  h.database.authority.workerControls.transition(record.commandId, "admitted", { state: "executing", startedAt: record.admittedAt });
  return record;
}
async function close(h: Awaited<ReturnType<typeof fixture>>, record: ReturnType<typeof admit>) {
  if (record.lifecycle === undefined) throw new Error("missing binding");
  const manager = new WorkerSessionManager({ workerId: record.lifecycle.member.workerId, workflowId: record.lifecycle.member.workflowId,
    stores: h.deps.stores, factory: h.deps.sessionFactory, clock: h.authority.clock, scheduler: h.scheduler, acquireDeadlineMs: h.deps.sessionAcquireMs,
    duoCeremony: h.deps.duoCeremony, resetOwner: { member: record.lifecycle.member, lifetime: record.lifecycle.lifetime } });
  const proof = await manager.closeForRetirement(record.lifecycle);
  h.database.observeWorkerRetirementClosure(record.commandId, proof, record.admittedAt);
}
function stopped(h: Awaited<ReturnType<typeof fixture>>, workerId: string, reason: "crashed" | "operator" = "crashed") {
  const lease = h.database.authority.workerLeases.get(workerId);
  if (lease === undefined) throw new Error("missing lease");
  h.database.authority.workerLeases.reportLifecycle({ workerId, leaseGeneration: lease.leaseGeneration,
    lifecycle: { state: "stopped", startedAt: lease.lifecycle.startedAt, stoppedAt: h.authority.clock.now().toISOString(), reason }, now: h.authority.clock.now().toISOString() });
}
async function owned(h: Awaited<ReturnType<typeof fixture>>, workerId: string, executeInProcess = false) {
  const slot = h.database.authority.workerSlots.get(workerId);
  if (slot === undefined) throw new Error("missing slot");
  const member = workerPoolMember(slot), children: FakeWorkerChild[] = [];
  stopped(h, workerId);
  let nextPid = process.pid + 10000;
  const gates: { beforeBirth: () => Promise<void>; beforeClose: () => Promise<void>; close?: (commandId: string) => Promise<void> } = { beforeBirth: async () => undefined, beforeClose: async () => undefined };
  const faults: Error[] = [];
  const supervisor = createDashboardWorkerProcessSupervisor({
    onExit: () => undefined,
    launch: { command: "/node", environment: {}, prefixArgs: [], cwd: "/test-owned-worker" },
    clock: h.authority.clock, scheduler: h.scheduler, birth: { pollMs: 50, timeoutMs: 1000 },
    spawn: () => {
      const child = new FakeWorkerChild(executeInProcess ? process.pid : nextPid++); children.push(child);
      const command = h.database.authority.workerControls.lifecycleForWorker(workerId);
      const request = { workerId, workflow: member.workflowId, commandId: command?.commandId,
        browserSystems: command?.lifecycle?.operation.kind === "retry" ? command.lifecycle.operation.systems : ["ucpath", "crm"], processId: child.pid, requestedBy: "local-operator" as const, now: h.authority.clock.now().toISOString() };
      const started = executeInProcess
        ? h.database.startOwnedWorker(request, boundFixtureProcessLock(h.database, h.authority.path, workerId))
        : h.database.authority.workerLeases.start(request);
      if (started.state !== "started") throw new Error("controlled child birth refused");
      return child;
    },
    prepareAdmission: async () => { await gates.beforeBirth(); },
    leases: { observe: id => {
      const lease = h.database.authority.workerLeases.get(id);
      return lease === undefined || lease.lifecycle.state === "stopped" ? undefined : { processId: lease.processId, startedAt: lease.lifecycle.startedAt };
    } },
    browserControl: { request: async () => { throw new Error("unused"); }, closeForRemoval: async commandId => {
      if (gates.close !== undefined) return gates.close(commandId);
      const record = h.database.authority.workerControls.get(commandId);
      if (record === undefined) throw new Error("missing removal");
      await gates.beforeClose();
      await close(h, record);
    } },
    gracefulStop: { request: (_member, directive) => {
      const lease = h.database.authority.workerLeases.get(workerId); if (lease === undefined) throw new Error("missing owner");
      const controlled = h.database.authority.workerLeases.control({ workerId, expectedVersion: lease.version,
        control: { directive: "stop", requestedAt: directive.requestedAt, requestedBy: directive.requestedBy }, commandId: directive.commandId, now: directive.requestedAt });
      if (controlled.state !== "applied") throw new Error("stop refused");
      stopped(h, workerId, "operator"); setImmediate(() => { children.at(-1)?.emitExit(0, null); });
      return { requestedAt: directive.requestedAt, leaseVersions: { before: lease.version, after: controlled.lease.version } };
    } },
    proveRetirement: target => {
      h.database.assertWorkerLifecycleRelease(workerId);
      return WorkerRetirementProofSchema.parse({ workerId, membershipRevision: target.membershipRevision, checkedAt: h.authority.clock.now().toISOString(), processStopped: true, browsersClosed: true, exclusive: true });
    },
    onFault: error => { faults.push(error); },
  });
  if (supervisor.removeWorker === undefined || supervisor.retryWorker === undefined) throw new Error("missing lifecycle supervisor");
  const removeWorker = supervisor.removeWorker.bind(supervisor), retryWorker = supervisor.retryWorker.bind(supervisor);
  await supervisor.execute({ command: "spawn-worker", commandId: randomUUID(), member });
  const lease = h.database.authority.workerLeases.get(workerId); if (lease === undefined) throw new Error("missing birth");
  h.database.authority.workerLeases.reportLifecycle({ workerId, leaseGeneration: lease.leaseGeneration,
    lifecycle: { state: "idle", startedAt: lease.lifecycle.startedAt, heartbeatAt: h.authority.clock.now().toISOString() }, now: h.authority.clock.now().toISOString() });
  return { supervisor, children, removeWorker, retryWorker, gates, faults };
}
async function retryStarting(h: Awaited<ReturnType<typeof fixture>>, mode: "initialize" | "browserless" = "initialize", executeInProcess = false) {
  const owner = await owned(h, h.deps.workerId, executeInProcess);
  stopped(h, h.deps.workerId); owner.children.at(-1)?.emitExit(1, null);
  const record = admit(h, h.deps.workerId, "retry-worker", mode);
  if (record.lifecycle === undefined || record.lifecycle.operation.kind !== "retry") throw new Error("missing retry");
  const proof = await owner.retryWorker(record.lifecycle);
  h.database.settleWorkerRetry(record.commandId, proof, record.admittedAt, randomUUID());
  const lease = h.database.authority.workerLeases.get(h.deps.workerId);
  if (lease === undefined) throw new Error("missing birth");
  return { owner, record, binding: record.lifecycle, lease };
}
const forgedEffect = Object.freeze({ kind: "worker-supervisor-effect" as const });

describe("exact lifecycle reservation", () => {
  it("refuses a caller-forged closure on an otherwise exact new Remove admission atomically", async () => {
    const h = await fixture(), command = request(h, h.deps.workerId, "remove-worker");
    const generation = h.database.getMeta().authorityGeneration;
    const before = h.database.authority.workerLeases.get(h.deps.workerId);
    expect(() => h.database.withAuthorityTransaction(repositories => admitWorkerLifecycle({ ...repositories,
      workerControls: { ...repositories.workerControls, admit: input => repositories.workerControls.admit({
        ...WorkerControlRecordSchema.parse(input), closure: { observedAt: command.requestedAt, closedSessionIds: [] },
      }) } }, command, randomUUID(), command.requestedAt))).toThrow("worker-control-derived-milestone-admission-refused");
    expect(h.database.getMeta().authorityGeneration).toBe(generation);
    expect(h.database.authority.workerControls.get(command.commandId)).toBeUndefined();
    expect(h.database.authority.commands.get(command.commandId)).toBeUndefined();
    expect(h.database.authority.workerLeases.get(h.deps.workerId)).toEqual(before);
  });

  for (const selected of [0, 1, 2]) {
    it(`retires selected member ${selected} without renaming survivors or reusing ordinal`, async () => {
      const h = await fixture(3), before = h.database.authority.workerSlots.list();
      const member = before[selected]; if (member === undefined) throw new Error("missing selection");
      const owner = await owned(h, member.workerId);
      const record = admit(h, member.workerId, "remove-worker");
      expect(() => h.database.settleWorkerRemoval(record.commandId, forgedEffect, record.admittedAt, randomUUID())).toThrow();
      expect(h.database.authority.workerSlots.get(member.workerId)).toEqual(member);
      await close(h, record);
      expect(() => h.database.settleWorkerRemoval(record.commandId, forgedEffect, record.admittedAt, randomUUID())).toThrow("effect-authority-unavailable");
      if (record.lifecycle === undefined) throw new Error("missing binding");
      const proof = await owner.removeWorker(record.lifecycle, WorkerStopDirectiveContextSchema.parse({ commandId: record.commandId, requestedAt: record.admittedAt, requestedBy: "local-operator" }));
      expect(() => h.database.settleWorkerRemoval(record.commandId, proof, "invalid", randomUUID())).toThrow();
      expect(h.database.authority.workerSlots.get(member.workerId)).toEqual(member);
      expect(h.database.authority.workerControls.get(record.commandId)?.auditedAt).toBeUndefined();
      const settled = h.database.settleWorkerRemoval(record.commandId, proof, record.admittedAt, randomUUID());
      expect(settled.phase.state).toBe("succeeded");
      expect(h.database.authority.workerPools.get(member.workflow)?.desiredWorkers).toBe(2);
      expect(h.database.authority.workerSlots.list().filter(slot => slot.retiredAt === null)).toEqual(before.filter(slot => slot.workerId !== member.workerId));
      expect(() => h.database.settleWorkerRemoval(record.commandId, forgedEffect, record.admittedAt, randomUUID())).toThrow();
      expect(h.database.authority.workerPools.get(member.workflow)?.desiredWorkers).toBe(2);
      testWorkerPorts(h.database, h.authority.clock, { path: h.authority.path, descriptor: personLookupDescriptor, poolIndex: member.poolIndex });
      const added = h.database.authority.workerSlots.list().find(slot => slot.retiredAt === null && slot.poolIndex === member.poolIndex);
      expect(added?.ordinal).toBe(4);
      expect(added?.workerId).not.toBe(member.workerId);
      expect(h.database.authority.workerSlots.get(member.workerId)?.retiredAt).not.toBeNull();
    });
  }
  it("retires the last member to zero only after closure and stopped lifetime", async () => {
    const h = await fixture(), owner = await owned(h, h.deps.workerId), record = admit(h, h.deps.workerId, "remove-worker");
    if (record.lifecycle === undefined) throw new Error("missing binding");
    const proof = await owner.removeWorker(record.lifecycle, WorkerStopDirectiveContextSchema.parse({ commandId: record.commandId, requestedAt: record.admittedAt, requestedBy: "local-operator" }));
    h.database.settleWorkerRemoval(record.commandId, proof, record.admittedAt, randomUUID());
    expect(h.database.authority.workerPools.get(h.deps.workflowId)?.desiredWorkers).toBe(0);
    expect(h.database.authority.workerSlots.list().filter(slot => slot.retiredAt === null)).toEqual([]);
  });
  it("blocks a prior canonical claim replay, new claims, birth and primitive membership during Remove", async () => {
    const h = await fixture(), database = h.database;
    database.authority.runs.enqueue(personLookupQueuedRun());
    const lifecycle = new RunRecordService({ database, clock: h.authority.clock, ids: sequentialIdFactory("e"), publishQueued: () => undefined });
    const command = { commandId: randomUUID(), workerId: h.deps.workerId, workflow: h.deps.workflowId, workerLifetime: testWorkerLifetime(database, h.deps.workflowId, 1).workerLifetime, runtimeConfig: selectRunRuntime(database.authority) };
    const claimed = lifecycle.claimNext(command); expect(claimed.state).toBe("applied");
    if (claimed.state !== "applied") throw new Error("claim refused");
    expect(lifecycle.terminalize({ kind: "cancelled", commandId: randomUUID(), runId: claimed.run.envelope.runId, expectedVersion: claimed.run.version,
      claim: { workerId: h.deps.workerId, claimGeneration: claimed.run.claimGeneration }, endedAt: h.authority.clock.now().toISOString() }, personLookupDescriptor).state).toBe("refused");
    database.authority.runs.requestCancellation({ runId: claimed.run.envelope.runId, expectedVersion: claimed.run.version, now: h.authority.clock.now().toISOString() });
    const current = database.authority.runs.get(claimed.run.envelope.runId); if (current === undefined) throw new Error("missing run");
    expect(lifecycle.terminalize({ kind: "cancelled", commandId: randomUUID(), runId: current.envelope.runId, expectedVersion: current.version,
      claim: { workerId: h.deps.workerId, claimGeneration: current.claimGeneration }, endedAt: h.authority.clock.now().toISOString() }, personLookupDescriptor).state).toBe("applied");
    admit(h, h.deps.workerId, "remove-worker");
    const generation = database.getMeta().authorityGeneration;
    expect(lifecycle.claimNext(command)).toMatchObject({ state: "refused", refusal: { reason: "none-eligible" } });
    expect(() => database.authority.runs.claimNext({ workerId: h.deps.workerId, workflow: h.deps.workflowId, now: h.authority.clock.now().toISOString() })).toThrow("lifecycle-reserved");
    expect(() => database.authority.workerSlots.allocate({ workflow: h.deps.workflowId, poolIndex: 2, commandId: randomUUID(), now: h.authority.clock.now().toISOString() })).toThrow("reserved");
    expect(database.getMeta().authorityGeneration).toBe(generation);
  });
  it("records Retry next-generation starting without pool change or work and rejects omitted descriptor readiness", async () => {
    const h = await fixture(), beforePool = h.database.authority.workerPools.get(h.deps.workflowId);
    const owner = await owned(h, h.deps.workerId);
    stopped(h, h.deps.workerId); owner.children.at(-1)?.emitExit(1, null);
    const record = admit(h, h.deps.workerId, "retry-worker");
    if (record.lifecycle === undefined) throw new Error("missing retry binding");
    expect(() => h.database.settleWorkerRetry(record.commandId, forgedEffect, record.admittedAt, randomUUID())).toThrow("effect-authority-unavailable");
    const proof = await owner.retryWorker(record.lifecycle);
    const settled = h.database.settleWorkerRetry(record.commandId, proof, record.admittedAt, randomUUID());
    expect(settled.phase).toMatchObject({ state: "succeeded", acknowledgement: { kind: "retry", oldLeaseGeneration: 2, leaseGeneration: 3 } });
    expect(h.database.authority.workerPools.get(h.deps.workflowId)).toEqual(beforePool);
    expect(h.database.authority.runs.listByWorkflow(h.deps.workflowId)).toEqual([]);
    expect(() => h.database.authority.runs.claimNext({ workerId: h.deps.workerId, workflow: h.deps.workflowId, now: record.admittedAt })).toThrow("initialization-pending");
    expect(() => { Reflect.apply(h.database.completeWorkerInitialization.bind(h.database), h.database, [record.commandId, 3, [], record.admittedAt]); }).toThrow();
    expect(() => h.database.completeWorkerInitialization(record.commandId, 3, personLookupDescriptor, record.admittedAt)).toThrow("browser-proof-unavailable");
    expect(h.database.authority.workerLeases.get(h.deps.workerId)?.lifecycle.state).toBe("starting");
  });
  it("releases initialization binding before warm browser control and a genuine next run", async () => {
    const h = await fixture(), f = await retryStarting(h, "initialize", true);
    if (f.binding.operation.kind !== "retry") throw new Error("missing retry");
    const configFingerprint = f.binding.operation.configFingerprint;
    h.database.authority.runs.enqueue(personLookupQueuedRun());
    let controlled = false;
    const report = await runWorkerLoop({ ...h.deps,
      browserObservation: observation => { h.database.authority.workerControls.observe({ ...observation, leaseGeneration: f.lease.leaseGeneration }); },
      initialize: async (sessions, signal) => {
        await initializeRetryWorker({ database: h.database, commandId: f.record.commandId, leaseGeneration: f.lease.leaseGeneration,
          descriptor: personLookupDescriptor, configFingerprint, sessions, signal, clock: h.authority.clock, scheduler: h.scheduler });
        expect(h.database.authority.workerControls.get(f.record.commandId)?.readiness?.state).toBe("ready");
        const browser = h.database.authority.workerControls.browsers(h.deps.workerId).find(value => value.health === "authenticated");
        if (browser === undefined) throw new Error("missing physical warm resource");
        await sessions.controlBrowser("refresh-browser", browser.sessionId, signal);
        controlled = true;
      },
    });
    expect(controlled).toBe(true);
    expect(report.outcomes.map(outcome => outcome.state)).toEqual(["done"]);
    expect(h.database.authority.workerControls.get(f.record.commandId)?.phase.state).toBe("succeeded");
  });

  it("Stop aborts actual Retry authentication and durably releases readiness before the next real claim", async () => {
    const h = await fixture(), f = await retryStarting(h, "initialize", true);
    if (f.binding.operation.kind !== "retry") throw new Error("missing retry");
    const configFingerprint = f.binding.operation.configFingerprint;
    let entered!: () => void;
    const authenticating = new Promise<void>(resolve => { entered = resolve; });
    let authSignal: AbortSignal | undefined;
    let calls = 0;
    const sessionFactory = { open: async (input: Parameters<typeof h.deps.sessionFactory.open>[0]) => {
      const resource = await h.deps.sessionFactory.open(input);
      return { ...resource, authentication: { authenticate: async (...args: Parameters<typeof resource.authentication.authenticate>) => {
        calls += 1;
        if (calls !== 1) return resource.authentication.authenticate(...args);
        const signal = args[1].signal;
        if (signal === undefined) throw new Error("authentication signal missing");
        authSignal = signal;
        entered();
        return new Promise<never>((_resolve, reject) => {
          if (signal.aborted) reject(new Error("controlled-auth-aborted", { cause: signal.reason }));
          else signal.addEventListener("abort", () => { reject(new Error("controlled-auth-aborted", { cause: signal.reason })); }, { once: true });
        });
      } } };
    } };
    const lifecycle = new RunRecordService({ database: h.database, clock: h.authority.clock, ids: sequentialIdFactory("e"), publishQueued: () => undefined });
    const resetId = randomUUID();
    let claimedAfterReset = false;
    const loop = runWorkerLoop({ ...h.deps, sessionFactory,
      resetOwner: { member: f.binding.member, lifetime: { leaseGeneration: f.lease.leaseGeneration, processId: f.lease.processId, startedAt: f.lease.lifecycle.startedAt } },
      browserObservation: observation => { h.database.authority.workerControls.observe({ ...observation, leaseGeneration: f.lease.leaseGeneration }); },
      pendingReset: () => h.database.authority.workerControls.resetForWorker(h.deps.workerId)?.reset,
      resetControl: createWorkerResetControl({ database: h.database, workerId: h.deps.workerId, leaseGeneration: f.lease.leaseGeneration, clock: h.authority.clock, lifecycle }),
      initialize: (sessions, signal) => initializeRetryWorker({ database: h.database, commandId: f.record.commandId, leaseGeneration: f.lease.leaseGeneration,
        descriptor: personLookupDescriptor, configFingerprint, sessions, signal, clock: h.authority.clock, scheduler: h.scheduler }),
      claimNext: request => {
        expect(h.database.authority.workerControls.get(f.record.commandId)?.readiness).toMatchObject({ state: "cancelled", leaseGeneration: f.lease.leaseGeneration });
        expect(h.database.authority.workerControls.get(resetId)?.phase.state).toBe("succeeded");
        claimedAfterReset = true;
        return h.deps.claimNext(request);
      },
    });
    await authenticating;
    const lease = h.database.authority.workerLeases.get(h.deps.workerId); if (lease === undefined) throw new Error("missing initialization owner");
    const reset = h.database.withAuthorityTransaction(repositories => admitWorkerReset(repositories, {
      commandId: resetId, family: "worker-browser", type: "stop-worker", source: "dashboard", requestedBy: "local-operator", requestedAt: f.record.admittedAt,
      target: { workerId: lease.workerId, membershipRevision: f.binding.member.membershipRevision, controlBasis: { leaseGeneration: lease.leaseGeneration, controlRevision: lease.controlRevision } },
    }, randomUUID(), f.record.admittedAt));
    expect(reset.commandId).toBe(resetId);
    h.database.authority.runs.enqueue(personLookupQueuedRun());
    h.authority.clock.advanceMonotonic(h.deps.idleRepollMs);
    for (const timer of h.scheduler.pending()) timer.fire();
    const report = await loop;
    expect(authSignal?.aborted).toBe(true);
    expect(h.stop.signal.aborted).toBe(false);
    expect(claimedAfterReset).toBe(true);
    expect(report.outcomes.map(outcome => outcome.state)).toEqual(["done"]);
    expect(h.database.authority.workerControls.get(f.record.commandId)?.phase).toMatchObject({ state: "succeeded", acknowledgement: { kind: "retry" } });
    const late = new WorkerSessionManager({ workerId: h.deps.workerId, workflowId: h.deps.workflowId, stores: h.deps.stores, factory: h.deps.sessionFactory,
      clock: h.authority.clock, scheduler: h.scheduler, acquireDeadlineMs: h.deps.sessionAcquireMs, duoCeremony: h.deps.duoCeremony });
    const opens = h.sessions.opens();
    await expect(initializeRetryWorker({ database: h.database, commandId: f.record.commandId, leaseGeneration: f.lease.leaseGeneration,
      descriptor: personLookupDescriptor, configFingerprint, sessions: late, signal: h.stop.signal, clock: h.authority.clock, scheduler: h.scheduler })).rejects.toThrow("authority-unavailable");
    expect(h.sessions.opens()).toBe(opens);
  });

  it("accepts heartbeat advancement and settles owned Remove independently of client replay", async () => {
    const h = await fixture(), owner = await owned(h, h.deps.workerId);
    const pool = createWorkerPoolRuntimeExecutor(owner.supervisor, h.database.authority.workerSlots, { database: h.database, clock: h.authority.clock });
    const kernel = kernelOver(h.database, h.authority.clock, pool);
    let release!: () => void;
    owner.gates.beforeClose = () => new Promise<void>(resolve => { release = resolve; });
    const command = request(h, h.deps.workerId, "remove-worker");
    const beforeHeartbeat = h.database.authority.workerLeases.get(h.deps.workerId);
    if (beforeHeartbeat === undefined) throw new Error("missing heartbeat owner");
    h.database.authority.workerLeases.reportLifecycle({ workerId: beforeHeartbeat.workerId, leaseGeneration: beforeHeartbeat.leaseGeneration,
      lifecycle: { state: "idle", startedAt: beforeHeartbeat.lifecycle.startedAt, heartbeatAt: command.requestedAt }, now: command.requestedAt });
    expect(h.database.authority.workerLeases.get(h.deps.workerId)?.version).toBeGreaterThan(beforeHeartbeat.version);
    expect(await kernel.executeWorkerPool(command)).toEqual({ state: "pending", commandId: command.commandId });
    expect(await kernel.executeWorkerPool(command)).toEqual({ state: "pending", commandId: command.commandId });
    expect(h.database.authority.commandAudits.findByCommand(command.commandId)).toBeUndefined();
    expect(h.database.authority.workerPools.get(h.deps.workflowId)?.desiredWorkers).toBe(1);
    expect(h.database.authority.workerSlots.get(h.deps.workerId)?.retiredAt).toBeNull();
    expect(() => h.database.authority.workerSlots.allocate({ workflow: h.deps.workflowId, poolIndex: 2, commandId: randomUUID(), now: command.requestedAt })).toThrow("reserved");
    release();
    for (let turn = 0; turn < 20 && h.database.authority.workerControls.get(command.commandId)?.phase.state !== "succeeded"; turn += 1) await new Promise<void>(resolve => { setImmediate(resolve); });
    expect(owner.faults).toEqual([]);
    expect(h.database.authority.workerControls.get(command.commandId)?.phase.state).toBe("succeeded");
    expect(h.database.authority.workerPools.get(h.deps.workflowId)?.desiredWorkers).toBe(0);
    expect(await kernel.executeWorkerPool(command)).toMatchObject({ state: "already-applied", commandId: command.commandId });
    expect(owner.children).toHaveLength(1);
  });

  it("refuses unowned or wrong-phase lifecycle requests before command or control mutation", async () => {
    const h = await fixture();
    const unowned = createDashboardWorkerProcessSupervisor({
    onExit: () => undefined,
      birth: { pollMs: 50, timeoutMs: 1000 }, launch: { command: "/node", environment: {}, prefixArgs: [], cwd: "/test" }, clock: h.authority.clock, scheduler: h.scheduler,
      spawn: () => { throw new Error("must not spawn"); }, leases: { observe: () => undefined },
      gracefulStop: { request: () => { throw new Error("must not stop"); } }, proveRetirement: () => { throw new Error("must not retire"); }, onFault: error => { throw error; },
    });
    const pool = createWorkerPoolRuntimeExecutor(unowned, h.database.authority.workerSlots, { database: h.database, clock: h.authority.clock });
    const kernel = kernelOver(h.database, h.authority.clock, pool);
    for (const type of ["remove-worker", "retry-worker"] as const) {
      const command = request(h, h.deps.workerId, type), generation = h.database.getMeta().authorityGeneration;
      expect(await kernel.executeWorkerPool(command)).toMatchObject({ state: "rejected", commandId: command.commandId });
      expect(h.database.authority.commands.get(command.commandId)).toBeUndefined();
      expect(h.database.authority.workerControls.get(command.commandId)).toBeUndefined();
      expect(h.database.getMeta().authorityGeneration).toBe(generation);
    }
  });

  it("allows unrelated claimed writes and preserves safely parked UNKNOWN in the same workflow", async () => {
    const h = await fixture(), database = h.database;
    seedAtomicWriteOwner(database, ATOMIC_WRITE_COMMIT, h.authority.path, 2);
    fenceWriteFixture(database, { intent: WRITE_INTENT_ATTEMPTING, attempt: WRITE_ATTEMPT });
    const slot = database.withAuthorityTransaction(repositories => admitDirectWorker(repositories, {
      commandId: randomUUID(), workflow: WRITE_INTENT_ATTEMPTING.workflowId, poolIndex: 1,
      expectedPoolVersion: repositories.workerPools.get(WRITE_INTENT_ATTEMPTING.workflowId)?.version ?? 0,
      processId: process.pid, processAcquisitionId: randomUUID(), authorityPath: realpathSync(h.authority.path),
      processLockRoot: join(dirname(realpathSync(h.authority.path)), "locks"), now: h.authority.clock.now().toISOString(),
    }, randomUUID()));
    const run = database.authority.runs.get(WRITE_INTENT_ATTEMPTING.runId), before = database.authority.writeIntents.get(WRITE_INTENT_ATTEMPTING.writeIntentId);
    if (run === undefined) throw new Error("missing write owner");
    const claim = runClaim(run); if (claim === undefined) throw new Error("missing current claim");
    expect(claim.workerId).not.toBe(slot.workerId);
    expect(() => database.assertWorkerLifecycleRelease(slot.workerId)).not.toThrow();
    expect(database.authority.writeIntents.get(WRITE_INTENT_ATTEMPTING.writeIntentId)).toEqual(before);
    database.authority.writeIntents.parkAttempt({ writeIntentId: WRITE_INTENT_ATTEMPTING.writeIntentId, generation: 1, expectedVersion: 1,
      code: "unknown", message: "controlled unknown", authorityReason: deriveWriteAuthorityReason("recovery-probe-unknown", "probe", "controlled unknown"), now: h.authority.clock.now().toISOString() });
    expect(database.authority.runs.transition({ runId: run.envelope.runId, expectedVersion: run.version, claim: { workerId: claim.workerId, claimGeneration: claim.claimGeneration },
      lifecycle: { state: "parked-write", writeIntentId: WRITE_INTENT_ATTEMPTING.writeIntentId, intentGeneration: 1,
        parkedAt: h.authority.clock.now().toISOString(), code: "unknown", message: "controlled unknown" }, now: h.authority.clock.now().toISOString() }).state).toBe("applied");
    const parked = database.authority.writeIntents.get(WRITE_INTENT_ATTEMPTING.writeIntentId);
    expect(() => database.assertWorkerLifecycleRelease(slot.workerId)).not.toThrow();
    expect(database.authority.writeIntents.get(WRITE_INTENT_ATTEMPTING.writeIntentId)).toEqual(parked);
    expect(database.authority.runs.get(run.envelope.runId)?.lifecycle.state).toBe("parked-write");
  });

  it("retains uncertain closure failure and never redispatches the original Remove", async () => {
    const h = await fixture(), owner = await owned(h, h.deps.workerId);
    const pool = createWorkerPoolRuntimeExecutor(owner.supervisor, h.database.authority.workerSlots, { database: h.database, clock: h.authority.clock });
    const kernel = kernelOver(h.database, h.authority.clock, pool);
    let closes = 0;
    owner.gates.beforeClose = async () => { closes += 1; throw new Error("controlled-close-unproved"); };
    const command = request(h, h.deps.workerId, "remove-worker");
    expect(await kernel.executeWorkerPool(command)).toMatchObject({ state: "pending" });
    for (let turn = 0; turn < 20 && h.database.authority.workerControls.get(command.commandId)?.phase.state !== "uncertain"; turn += 1) await new Promise<void>(resolve => { setImmediate(resolve); });
    expect(h.database.authority.workerControls.get(command.commandId)?.phase.state).toBe("uncertain");
    expect(h.database.authority.workerSlots.get(h.deps.workerId)?.retiredAt).toBeNull();
    expect(h.database.authority.workerPools.get(h.deps.workflowId)?.desiredWorkers).toBe(1);
    expect(h.database.authority.commandAudits.findByCommand(command.commandId)).toBeUndefined();
    expect(await kernel.executeWorkerPool(command)).toMatchObject({ state: "pending", commandId: command.commandId });
    expect(closes).toBe(1);
    expect(owner.faults.map(error => error.message)).toEqual(["controlled-close-unproved"]);
    expect(() => h.database.authority.workerLeases.start({ workerId: h.deps.workerId, workflow: h.deps.workflowId, browserSystems: [], processId: process.pid,
      requestedBy: "local-operator", now: command.requestedAt })).toThrow("lifecycle-reserved");
  });

  it("retains Remove after closure expiry without stopping the still-owned child", async () => {
    const h = await fixture(), owner = await owned(h, h.deps.workerId);
    owner.gates.close = createWorkerBrowserChannel({ database: h.database, clock: h.authority.clock, scheduler: h.scheduler }).closeForRemoval;
    const pool = createWorkerPoolRuntimeExecutor(owner.supervisor, h.database.authority.workerSlots, { database: h.database, clock: h.authority.clock });
    const kernel = kernelOver(h.database, h.authority.clock, pool), command = request(h, h.deps.workerId, "remove-worker");
    expect(await kernel.executeWorkerPool(command)).toMatchObject({ state: "pending" });
    h.authority.clock.advanceWall(300000); h.authority.clock.advanceMonotonic(300000);
    for (const timer of h.scheduler.pending()) timer.fire();
    await new Promise<void>(resolve => { setImmediate(resolve); });
    expect(h.database.authority.workerControls.get(command.commandId)?.phase.state).toBe("uncertain");
    expect(h.database.authority.workerSlots.get(h.deps.workerId)?.retiredAt).toBeNull();
    expect(h.database.authority.workerPools.get(h.deps.workflowId)?.desiredWorkers).toBe(1);
    expect(h.database.authority.commandAudits.findByCommand(command.commandId)).toBeUndefined();
    expect(owner.children[0]?.signalsSent).toEqual([]);
    expect(await kernel.executeWorkerPool(command)).toMatchObject({ state: "pending" });
    expect(owner.faults.map(error => error.message)).toEqual(["worker-removal-closure-unproved"]);
  });

  it("refuses lifecycle release while actual Duo custody is held", async () => {
    const h = await fixture(), key = "ab".repeat(32), now = h.authority.clock.now().toISOString();
    const acquired = h.database.authority.duoCeremonyLeases.acquire({ credentialKey: key, workerId: h.deps.workerId, system: "ucpath", ttlMs: 60000, now });
    expect(acquired.state).toBe("acquired"); if (acquired.state !== "acquired") throw new Error("lease held elsewhere");
    expect(() => h.database.assertWorkerLifecycleRelease(h.deps.workerId)).toThrow("release-unproved");
    expect(h.database.authority.duoCeremonyLeases.get(key)?.state).toBe("held");
    expect(h.database.authority.duoCeremonyLeases.release({ token: acquired.token, now }).state).toBe("released");
    expect(() => h.database.assertWorkerLifecycleRelease(h.deps.workerId)).not.toThrow();
  });

  it("initializes the shared browserless replacement mode without authentication or work", async () => {
    const h = await fixture(), f = await retryStarting(h, "browserless");
    if (f.binding.operation.kind !== "retry") throw new Error("missing retry binding");
    const sessions = new WorkerSessionManager({ workerId: h.deps.workerId, workflowId: h.deps.workflowId, stores: h.deps.stores, factory: h.deps.sessionFactory,
      clock: h.authority.clock, scheduler: h.scheduler, acquireDeadlineMs: h.deps.sessionAcquireMs, duoCeremony: h.deps.duoCeremony });
    await initializeRetryWorker({ database: h.database, commandId: f.record.commandId, leaseGeneration: f.lease.leaseGeneration,
      descriptor: personLookupDescriptor, configFingerprint: f.binding.operation.configFingerprint, sessions, signal: h.stop.signal, clock: h.authority.clock, scheduler: h.scheduler });
    expect(h.sessions.opens()).toBe(0); expect(h.sessions.logins()).toBe(0);
    expect(h.database.authority.workerLeases.get(h.deps.workerId)).toMatchObject({ leaseGeneration: f.lease.leaseGeneration, lifecycle: { state: "idle" } });
    expect(h.database.authority.workerControls.get(f.record.commandId)?.readiness?.state).toBe("ready");
    expect(h.database.authority.runs.listByWorkflow(h.deps.workflowId)).toEqual([]);
  });

  it("retains exit-before-tombstone reservation across database reopen without reconstructing effect proof", async () => {
    const h = await fixture(), owner = await owned(h, h.deps.workerId), record = admit(h, h.deps.workerId, "remove-worker");
    if (record.lifecycle === undefined) throw new Error("missing binding");
    const originalPool = h.database.authority.workerPools.get(h.deps.workflowId);
    const proof = await owner.removeWorker(record.lifecycle, WorkerStopDirectiveContextSchema.parse({ commandId: record.commandId, requestedAt: record.admittedAt, requestedBy: "local-operator" }));
    expect(owner.supervisor.memberEvidence(record.lifecycle.member)).toMatchObject({ state: "exited", reportedBy: "os" });
    expect(h.database.authority.workerControls.get(record.commandId)?.closure).toBeDefined();
    h.authority.closeDatabase();
    const reopened = AuthorityDatabase.open({ path: h.authority.path, busyTimeoutMs: 250, migrationOwner: "unit-test" }, h.authority.clock);
    try {
      expect(reopened.authority.workerSlots.get(h.deps.workerId)?.retiredAt).toBeNull();
      expect(reopened.authority.workerPools.get(h.deps.workflowId)).toEqual(originalPool);
      expect(reopened.authority.workerControls.pending(record.scope)).toHaveLength(1);
      expect(reopened.authority.commandAudits.findByCommand(record.commandId)).toBeUndefined();
      const serialized = JSON.parse(JSON.stringify(proof)) as unknown;
      expect(() => { Reflect.apply(reopened.settleWorkerRemoval.bind(reopened), reopened, [record.commandId, serialized, record.admittedAt, randomUUID()]); }).toThrow("effect-authority-unavailable");
      expect(() => reopened.authority.workerLeases.start({ workerId: h.deps.workerId, workflow: h.deps.workflowId, browserSystems: [], processId: process.pid,
        requestedBy: "local-operator", now: record.admittedAt })).toThrow("lifecycle-reserved");
      expect(reopened.authority.workerControls.get(record.commandId)?.phase.state).toBe("executing");
    } finally { reopened.close(); }
  });

  it("rejects a stale owned lifetime before Remove closure and a consumed proof after success", async () => {
    const h = await fixture(), owner = await owned(h, h.deps.workerId), record = admit(h, h.deps.workerId, "remove-worker");
    if (record.lifecycle === undefined) throw new Error("missing binding");
    const directive = WorkerStopDirectiveContextSchema.parse({ commandId: record.commandId, requestedAt: record.admittedAt, requestedBy: "local-operator" });
    const stale = WorkerLifecycleBindingSchema.parse({ ...record.lifecycle, lifetime: { ...record.lifecycle.lifetime, processId: record.lifecycle.lifetime.processId + 1 } });
    await expect(owner.removeWorker(stale, directive)).rejects.toThrow("lifetime-conflict");
    expect(h.database.authority.workerControls.get(record.commandId)?.closure).toBeUndefined();
    expect(owner.children[0]?.signalsSent).toEqual([]);
    const proof = await owner.removeWorker(record.lifecycle, directive);
    h.database.settleWorkerRemoval(record.commandId, proof, record.admittedAt, randomUUID());
    expect(() => h.database.settleWorkerRemoval(record.commandId, proof, record.admittedAt, randomUUID())).toThrow();
    expect(h.database.authority.workerPools.get(h.deps.workflowId)?.desiredWorkers).toBe(0);
  });

  it("retains Retry starting confirmation after authentication fails without releasing claims or inventing a run", async () => {
    const h = await fixture(), f = await retryStarting(h);
    if (f.binding.operation.kind !== "retry") throw new Error("missing retry binding");
    const sessions = new WorkerSessionManager({ workerId: h.deps.workerId, workflowId: h.deps.workflowId, stores: h.deps.stores,
      factory: { open: async input => {
        const resource = await h.deps.sessionFactory.open(input);
        return { ...resource, authentication: { authenticate: async () => { throw new Error("controlled-initialization-auth-failed"); } } };
      } }, clock: h.authority.clock, scheduler: h.scheduler, acquireDeadlineMs: h.deps.sessionAcquireMs, duoCeremony: h.deps.duoCeremony,
      onObservation: observation => { h.database.authority.workerControls.observe({ ...observation, leaseGeneration: f.lease.leaseGeneration }); },
    });
    await expect(initializeRetryWorker({ database: h.database, commandId: f.record.commandId, leaseGeneration: f.lease.leaseGeneration,
      descriptor: personLookupDescriptor, configFingerprint: f.binding.operation.configFingerprint, sessions, signal: h.stop.signal, clock: h.authority.clock, scheduler: h.scheduler })).rejects.toThrow("controlled-initialization-auth-failed");
    sessions.bindRunConfigFingerprint(FingerprintSchema.parse("ef".repeat(32)));
    sessions.releaseRunConfigFingerprint();
    await sessions.closeAll("worker-stop");
    expect(h.database.authority.workerControls.get(f.record.commandId)).toMatchObject({ phase: { state: "succeeded", acknowledgement: { kind: "retry" } }, readiness: { state: "initializing" } });
    expect(h.database.authority.runs.listByWorkflow(h.deps.workflowId)).toEqual([]);
    expect(() => h.database.authority.runs.claimNext({ workerId: h.deps.workerId, workflow: h.deps.workflowId, now: f.record.admittedAt })).toThrow("initialization-pending");
    stopped(h, h.deps.workerId); f.owner.children.at(-1)?.emitExit(1, null);
    expect(h.database.authority.workerLeases.get(h.deps.workerId)).toMatchObject({ leaseGeneration: f.lease.leaseGeneration, lifecycle: { state: "stopped", reason: "crashed" } });
    expect(() => h.database.completeWorkerInitialization(f.record.commandId, f.lease.leaseGeneration, personLookupDescriptor, f.record.admittedAt)).toThrow("lifetime-conflict");
    expect(h.database.authority.commandAudits.findByCommand(f.record.commandId)?.result.state).toBe("applied");
  });

  it("blocks prior canonical claim replay during Retry initialization without reviving its settled run", async () => {
    const h = await fixture(), owner = await owned(h, h.deps.workerId), database = h.database;
    const lifecycle = new RunRecordService({ database, clock: h.authority.clock, ids: sequentialIdFactory("e"), publishQueued: () => undefined });
    database.authority.runs.enqueue(personLookupQueuedRun());
    const command = { commandId: randomUUID(), workerId: h.deps.workerId, workflow: h.deps.workflowId, workerLifetime: testWorkerLifetime(database, h.deps.workflowId, 1).workerLifetime, runtimeConfig: selectRunRuntime(database.authority) };
    const claimed = lifecycle.claimNext(command);
    if (claimed.state !== "applied") throw new Error("prior claim refused");
    database.authority.runs.requestCancellation({ runId: claimed.run.envelope.runId, expectedVersion: claimed.run.version, now: h.authority.clock.now().toISOString() });
    const current = database.authority.runs.get(claimed.run.envelope.runId); if (current === undefined) throw new Error("missing current");
    expect(lifecycle.terminalize({ kind: "cancelled", commandId: randomUUID(), runId: current.envelope.runId, expectedVersion: current.version,
      claim: { workerId: h.deps.workerId, claimGeneration: current.claimGeneration }, endedAt: h.authority.clock.now().toISOString() }, personLookupDescriptor).state).toBe("applied");
    const settledRun = database.authority.runs.get(current.envelope.runId);
    stopped(h, h.deps.workerId); owner.children.at(-1)?.emitExit(1, null);
    const record = admit(h, h.deps.workerId, "retry-worker"); if (record.lifecycle === undefined) throw new Error("missing retry");
    const proof = await owner.retryWorker(record.lifecycle);
    database.settleWorkerRetry(record.commandId, proof, record.admittedAt, randomUUID());
    const generation = database.getMeta().authorityGeneration;
    expect(lifecycle.claimNext(command)).toMatchObject({ state: "refused", refusal: { reason: "none-eligible" } });
    expect(database.authority.runs.get(current.envelope.runId)).toEqual(settledRun);
    expect(database.getMeta().authorityGeneration).toBe(generation);
  });

  it("refuses old lease-generation ABA before any lifecycle reservation", async () => {
    const h = await fixture(), command = request(h, h.deps.workerId, "remove-worker"), owner = await owned(h, h.deps.workerId);
    const pool = createWorkerPoolRuntimeExecutor(owner.supervisor, h.database.authority.workerSlots, { database: h.database, clock: h.authority.clock });
    const kernel = kernelOver(h.database, h.authority.clock, pool), generation = h.database.getMeta().authorityGeneration;
    expect(await kernel.executeWorkerPool(command)).toMatchObject({ state: "rejected" });
    expect(h.database.authority.commands.get(command.commandId)).toBeUndefined();
    expect(h.database.authority.workerControls.get(command.commandId)).toBeUndefined();
    expect(h.database.getMeta().authorityGeneration).toBe(generation);
    expect(owner.children[0]?.signalsSent).toEqual([]); expect(h.sessions.opens()).toBe(0);
  });

  it("retains actual warm-browser close ownership beyond Remove expiry without tombstoning", async () => {
    const h = await fixture(), owner = await owned(h, h.deps.workerId);
    const slot = h.database.authority.workerSlots.get(h.deps.workerId), lease = h.database.authority.workerLeases.get(h.deps.workerId), active = h.database.authority.runtimeConfig.get();
    if (slot === undefined || lease === undefined || active === undefined) throw new Error("missing owner authority");
    let closing!: () => void, release!: () => void;
    const entered = new Promise<void>(resolve => { closing = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
    const manager = new WorkerSessionManager({ workerId: h.deps.workerId, workflowId: h.deps.workflowId, stores: h.deps.stores,
      factory: { open: async input => {
        const resource = await h.deps.sessionFactory.open(input);
        return { ...resource, close: async options => { closing(); await held; return resource.close(options); } };
      } }, clock: h.authority.clock, scheduler: h.scheduler, acquireDeadlineMs: h.deps.sessionAcquireMs, duoCeremony: h.deps.duoCeremony,
      resetOwner: { member: workerPoolMember(slot), lifetime: { leaseGeneration: lease.leaseGeneration, processId: lease.processId, startedAt: lease.lifecycle.startedAt } },
      onObservation: observation => { h.database.authority.workerControls.observe({ ...observation, leaseGeneration: lease.leaseGeneration }); },
    });
    await withBoundRunConfigFingerprint(manager, active.configFingerprint, () => manager.withDriver({ system: "ucpath", access: "read", session: "reuse-worker" }, "prod", h.stop.signal, async () => undefined));
    owner.gates.close = createWorkerBrowserChannel({ database: h.database, clock: h.authority.clock, scheduler: h.scheduler }).closeForRemoval;
    const pool = createWorkerPoolRuntimeExecutor(owner.supervisor, h.database.authority.workerSlots, { database: h.database, clock: h.authority.clock });
    const kernel = kernelOver(h.database, h.authority.clock, pool), command = request(h, h.deps.workerId, "remove-worker");
    expect(await kernel.executeWorkerPool(command)).toMatchObject({ state: "pending" });
    let settled = false;
    const actualClose = createWorkerBrowserControl({ database: h.database, workerId: lease.workerId, leaseGeneration: lease.leaseGeneration, clock: h.authority.clock, signal: h.stop.signal })(manager).then(() => { settled = true; });
    await entered;
    expect(h.database.authority.workerControls.get(command.commandId)?.closure).toBeUndefined();
    h.authority.clock.advanceWall(300000); h.authority.clock.advanceMonotonic(300000);
    for (const timer of h.scheduler.pending()) timer.fire();
    await new Promise<void>(resolve => { setImmediate(resolve); });
    expect(settled).toBe(false);
    expect(h.database.authority.workerControls.get(command.commandId)?.phase.state).toBe("uncertain");
    expect(h.database.authority.workerSlots.get(h.deps.workerId)?.retiredAt).toBeNull();
    expect(h.database.authority.workerLeases.get(h.deps.workerId)?.control.directive).toBe("run");
    expect(owner.children[0]?.signalsSent).toEqual([]);
    release(); await actualClose;
    expect(settled).toBe(true);
    expect(h.database.authority.workerControls.get(command.commandId)?.closure?.closedSessionIds).toHaveLength(1);
    expect(h.database.authority.workerControls.get(command.commandId)?.phase.state).toBe("uncertain");
    expect(h.database.authority.workerSlots.get(h.deps.workerId)?.retiredAt).toBeNull();
    expect(h.sessions.closeReasons()).toEqual(["worker-stop"]);
    expect(await kernel.executeWorkerPool(command)).toMatchObject({ state: "pending" });
  });

  it("does not birth Retry outside a drain snapshot after held preflight resumes", async () => {
    const h = await fixture(), owner = await owned(h, h.deps.workerId);
    stopped(h, h.deps.workerId); owner.children[0]?.emitExit(1, null);
    let entered!: () => void, release!: () => void;
    const preparing = new Promise<void>(resolve => { entered = resolve; });
    owner.gates.beforeBirth = async () => { entered(); await new Promise<void>(resolve => { release = resolve; }); };
    const pool = createWorkerPoolRuntimeExecutor(owner.supervisor, h.database.authority.workerSlots, { database: h.database, clock: h.authority.clock });
    const kernel = kernelOver(h.database, h.authority.clock, pool), command = request(h, h.deps.workerId, "retry-worker");
    expect(await kernel.executeWorkerPool(command)).toMatchObject({ state: "pending" }); await preparing;
    const drain = owner.supervisor.drainOwnedChildren(WorkerStopDirectiveContextSchema.parse({ requestedAt: command.requestedAt, requestedBy: "local-operator" }));
    const failedDrain = expect(drain).rejects.toThrow("could not observe every owned worker exit");
    release(); await failedDrain;
    expect(owner.children).toHaveLength(1);
    expect(h.database.authority.workerLeases.get(h.deps.workerId)?.leaseGeneration).toBe(2);
    expect(h.database.authority.workerControls.get(command.commandId)?.phase.state).toBe("uncertain");
    expect(h.database.authority.commandAudits.findByCommand(command.commandId)).toBeUndefined();
    expect(await kernel.executeWorkerPool(command)).toMatchObject({ state: "pending" });
  });

  it("lets an existing drain own shutdown when Remove closure resumes", async () => {
    const h = await fixture(), owner = await owned(h, h.deps.workerId);
    let entered!: () => void, release!: () => void;
    const closing = new Promise<void>(resolve => { entered = resolve; });
    owner.gates.beforeClose = async () => { entered(); await new Promise<void>(resolve => { release = resolve; }); };
    const pool = createWorkerPoolRuntimeExecutor(owner.supervisor, h.database.authority.workerSlots, { database: h.database, clock: h.authority.clock });
    const kernel = kernelOver(h.database, h.authority.clock, pool), command = request(h, h.deps.workerId, "remove-worker");
    expect(await kernel.executeWorkerPool(command)).toMatchObject({ state: "pending" }); await closing;
    const drain = owner.supervisor.drainOwnedChildren(WorkerStopDirectiveContextSchema.parse({ commandId: command.commandId, requestedAt: command.requestedAt, requestedBy: "local-operator" }));
    const failedDrain = expect(drain).rejects.toThrow("could not observe every owned worker exit");
    release(); await failedDrain;
    expect(h.database.authority.workerControls.get(command.commandId)?.phase.state).toBe("uncertain");
    expect(h.database.authority.workerSlots.get(h.deps.workerId)?.retiredAt).toBeNull();
    expect(h.database.authority.commandAudits.findByCommand(command.commandId)).toBeUndefined();
    expect(owner.children).toHaveLength(1);
    expect(owner.children[0]?.signalsSent).toEqual([]);
  });

  for (const stage of ["birth", "initialization"] as const) {
    it(`refuses changed current settings before Retry ${stage} without run or readiness success`, async () => {
      const h = await fixture(), owner = await owned(h, h.deps.workerId);
      stopped(h, h.deps.workerId); owner.children[0]?.emitExit(1, null);
      const record = admit(h, h.deps.workerId, "retry-worker"), binding = record.lifecycle;
      if (binding?.operation.kind !== "retry") throw new Error("missing retry binding");
      const operation = binding.operation;
      if (stage === "initialization") {
        const proof = await owner.retryWorker(binding);
        h.database.settleWorkerRetry(record.commandId, proof, record.admittedAt, randomUUID());
      }
      const active = h.database.authority.runtimeConfig.get(); if (active === undefined) throw new Error("missing active settings");
      const config = { ...CONFIG_SNAPSHOT.config, browser: { ...CONFIG_SNAPSHOT.config.browser, headless: !CONFIG_SNAPSHOT.config.browser.headless } };
      const snapshot = { ...CONFIG_SNAPSHOT, configSnapshotId: randomUUID(), config, fingerprint: sha256Hex(canonicalJsonStringify(config)) };
      h.database.authority.configSnapshots.insert(snapshot);
      h.database.authority.runtimeConfig.activate({ settingsRevision: active.settingsRevision, settingsFingerprint: active.settingsFingerprint,
        configSnapshotId: snapshot.configSnapshotId, configFingerprint: snapshot.fingerprint, activatedAt: record.admittedAt });
      const before = h.database.authority.workerLeases.get(h.deps.workerId);
      if (stage === "birth") {
        expect(() => h.database.authority.workerLeases.start({ commandId: record.commandId, workerId: h.deps.workerId, workflow: h.deps.workflowId,
          browserSystems: operation.systems, processId: process.pid, requestedBy: "local-operator", now: record.admittedAt })).toThrow("birth-binding-conflict");
        expect(h.database.authority.commandAudits.findByCommand(record.commandId)).toBeUndefined();
      } else {
        if (before === undefined) throw new Error("missing born lease");
        const sessions = new WorkerSessionManager({ workerId: h.deps.workerId, workflowId: h.deps.workflowId, stores: h.deps.stores, factory: h.deps.sessionFactory,
          clock: h.authority.clock, scheduler: h.scheduler, acquireDeadlineMs: h.deps.sessionAcquireMs, duoCeremony: h.deps.duoCeremony });
        await expect(initializeRetryWorker({ database: h.database, commandId: record.commandId, leaseGeneration: before.leaseGeneration,
          descriptor: personLookupDescriptor, configFingerprint: operation.configFingerprint, sessions, signal: h.stop.signal, clock: h.authority.clock, scheduler: h.scheduler })).rejects.toThrow("settings-changed");
        expect(h.database.authority.workerControls.get(record.commandId)?.readiness?.state).toBe("initializing");
      }
      expect(h.database.authority.workerLeases.get(h.deps.workerId)).toEqual(before);
      expect(h.database.authority.runs.listByWorkflow(h.deps.workflowId)).toEqual([]);
      expect(h.sessions.opens()).toBe(0);
    });
  }

  it("rechecks settings activated during actual authentication before durable Retry ready", async () => {
    const h = await fixture(), f = await retryStarting(h);
    if (f.binding.operation.kind !== "retry") throw new Error("missing retry binding");
    let entered!: () => void, release!: () => void;
    const authenticating = new Promise<void>(resolve => { entered = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
    const manager = new WorkerSessionManager({ workerId: h.deps.workerId, workflowId: h.deps.workflowId, stores: h.deps.stores,
      factory: { open: async input => {
        const resource = await h.deps.sessionFactory.open(input);
        return { ...resource, authentication: { authenticate: async (...args: Parameters<typeof resource.authentication.authenticate>) => {
          entered(); await held; return resource.authentication.authenticate(...args);
        } } };
      } }, clock: h.authority.clock, scheduler: h.scheduler, acquireDeadlineMs: h.deps.sessionAcquireMs, duoCeremony: h.deps.duoCeremony,
      onObservation: observation => { h.database.authority.workerControls.observe({ ...observation, leaseGeneration: f.lease.leaseGeneration }); },
    });
    const initialization = initializeRetryWorker({ database: h.database, commandId: f.record.commandId, leaseGeneration: f.lease.leaseGeneration,
      descriptor: personLookupDescriptor, configFingerprint: f.binding.operation.configFingerprint, sessions: manager, signal: h.stop.signal, clock: h.authority.clock, scheduler: h.scheduler });
    const refusal = expect(initialization).rejects.toThrow("current-authority-changed");
    await authenticating;
    const active = h.database.authority.runtimeConfig.get(); if (active === undefined) throw new Error("missing active settings");
    const config = { ...CONFIG_SNAPSHOT.config, browser: { ...CONFIG_SNAPSHOT.config.browser, headless: !CONFIG_SNAPSHOT.config.browser.headless } };
    const snapshot = { ...CONFIG_SNAPSHOT, configSnapshotId: randomUUID(), config, fingerprint: sha256Hex(canonicalJsonStringify(config)) };
    h.database.authority.configSnapshots.insert(snapshot);
    h.database.authority.runtimeConfig.activate({ settingsRevision: active.settingsRevision, settingsFingerprint: active.settingsFingerprint,
      configSnapshotId: snapshot.configSnapshotId, configFingerprint: snapshot.fingerprint, activatedAt: f.record.admittedAt });
    release(); await refusal;
    expect(h.database.authority.workerControls.get(f.record.commandId)).toMatchObject({ phase: { state: "succeeded", acknowledgement: { kind: "retry" } }, readiness: { state: "initializing" } });
    expect(h.database.authority.workerLeases.get(h.deps.workerId)?.lifecycle.state).toBe("starting");
    expect(h.database.authority.runs.listByWorkflow(h.deps.workflowId)).toEqual([]);
    expect(() => h.database.authority.runs.claimNext({ workerId: h.deps.workerId, workflow: h.deps.workflowId, now: f.record.admittedAt })).toThrow("initialization-pending");
    await manager.closeAll("worker-stop");
    expect(h.database.authority.workerControls.browsers(h.deps.workerId).every(browser => browser.health === "closed")).toBe(true);
  });

});
