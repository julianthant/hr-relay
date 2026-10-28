import { WriteIntentRecordSchema } from "../../../../src/rules/write-safety/write-safety.js";
import { descriptorRuntimeNodes } from "../../../../src/workflow-kit/workflow.js";
import { createDurableChildRunExecutor } from "../../../../src/backend/runtime/execution/durable-child-executor.js";
import { childUnawaitedModules } from "../../../support/fixtures/child-execution-workflows.js";
import { Plan1Input, plan1Stores } from "../../../support/fixtures/plan1-operation-workflows.js";
import { childExecutionBuildManifest } from "../../../support/fixtures/child-execution-build-manifest.js";
import { canonicalChildExecution } from "../../../support/helpers/backend/canonical-child-execution.js";
import { testAdmittedWorker } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import { WorkerResetBindingSchema } from "../../../../src/models/run/worker-control.js";
import { seedAtomicWriteOwner, atomicWriteCheckpoint } from "../../../support/helpers/timeline-write-fixture.js";
import { fenceWriteFixture } from "../../../support/helpers/write-fence-fixture.js";
import { ATOMIC_WRITE_COMMIT, WRITE_INTENT_ATTEMPTING, WRITE_ATTEMPT } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { DatabaseSync } from "node:sqlite";
import { RunRecordSchema, runClaim } from "../../../../src/models/run/record.js";
import { deriveWriteAuthorityReason } from "../../../../src/rules/write-safety/write-authority-reason.js";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { createWorkerDirectiveTestWorld } from "../../../support/helpers/backend/worker-directive-world.js";
import { createWorkerResetControl, createWorkerResetObserver } from "../../../../src/backend/runtime/workers/worker-browser-control.js";
import { RunRecordService } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { sequentialIdFactory } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { admitWorkerReset } from "../../../../src/backend/storage/sqlite/worker-control.js";
import { WorkerSessionManager } from "../../../../src/backend/runtime/workers/worker-sessions.js";
import { runWorkerLoop } from "../../../../src/backend/runtime/workers/worker-loop.js";
import { workerPoolMember } from "../../../../src/models/run/worker-slot.js";
import { healthyUcpathDriver, healthyCrmDriver, sessionFactoryHarness, personLookupQueuedRun } from "../../../support/helpers/phase1f-executor-harness.js";

const tick = () => new Promise<void>(resolve => { setImmediate(resolve); });
const world = createWorkerDirectiveTestWorld();
afterEach(world.cleanup);
describe("same-lifetime durable reset settlement", () => {
  for (const outcome of ["resolved", "rejected"] as const) {
    it(`settles Stop after a timed-out read callback is actually ${outcome}`, async () => {
      let release!: () => void, started!: () => void;
      const held = new Promise<void>(resolve => { release = resolve; });
      const starting = new Promise<void>(resolve => { started = resolve; });
      const driver = healthyUcpathDriver();
      const sessions = sessionFactoryHarness({ ucpath: () => ({ ...driver,
        searchPersonOrg: async (...args: Parameters<typeof driver.searchPersonOrg>) => {
          started(); await held;
          if (outcome === "rejected") throw new Error("late read rejection");
          return driver.searchPersonOrg(...args);
        },
      }), crm: () => healthyCrmDriver() });
      const h = await world.loopHarness({ sessions, exitWhenIdle: false });
      const database = h.authority.database, workerId = h.deps.workerId;
      const slot = database.authority.workerSlots.get(workerId), lease = database.authority.workerLeases.get(workerId);
      if (slot === undefined || lease === undefined) throw new Error("missing owner");
      const lifecycle = new RunRecordService({ database, clock: h.authority.clock, ids: sequentialIdFactory("e"), publishQueued: () => undefined });
      const observer = createWorkerResetObserver({ database, workerId, leaseGeneration: lease.leaseGeneration,
        clock: h.authority.clock, scheduler: h.scheduler, onFailure: error => { h.stop.abort(error); } });
      const run = RunRecordSchema.parse(personLookupQueuedRun());
      database.authority.runs.enqueue(run);
      let resetCommandId: string | undefined;
      let claimedAfterReset = false;
      const loop = runWorkerLoop({ ...h.deps, taskDeadlineMs: 5000,
        resetOwner: { member: workerPoolMember(slot), lifetime: { leaseGeneration: lease.leaseGeneration, processId: lease.processId, startedAt: lease.lifecycle.startedAt } },
        pendingReset: observer, activeWorkReset: () => observer() !== undefined,
        browserObservation: observation => { database.authority.workerControls.observe({ ...observation, leaseGeneration: lease.leaseGeneration }); },
        resetControl: createWorkerResetControl({ database, workerId, leaseGeneration: lease.leaseGeneration, clock: h.authority.clock, lifecycle }),
        claimNext: request => {
          if (resetCommandId !== undefined) {
            expect(database.authority.workerControls.get(resetCommandId)?.phase.state).toBe("succeeded");
            expect(database.authority.workerLeases.get(workerId)?.lifecycle.state).toBe("idle");
            expect(h.stop.signal.aborted).toBe(false);
            claimedAfterReset = true;
          }
          return h.deps.claimNext(request);
        },
      });
      try {
        await starting;
        const deadline = h.scheduler.pending().find(timer => timer.deadlineMonotonicMs === h.authority.clock.monotonicMs() + 5000);
        expect(deadline).toBeDefined(); deadline?.fire();
        await tick();
        expect(database.authority.runs.get(run.envelope.runId)?.lifecycle.state).toBe("terminal");
        const currentLease = database.authority.workerLeases.get(workerId);
        if (currentLease === undefined) throw new Error("missing current owner");
        const record = database.withAuthorityTransaction(repositories => admitWorkerReset(repositories, {
          commandId: randomUUID(), family: "worker-browser", type: "stop-worker", source: "dashboard", requestedBy: "local-operator",
          requestedAt: h.authority.clock.now().toISOString(), target: { workerId, membershipRevision: slot.membershipRevision,
            controlBasis: { leaseGeneration: currentLease.leaseGeneration, controlRevision: currentLease.controlRevision } },
        }, randomUUID(), h.authority.clock.now().toISOString()));
        resetCommandId = record.commandId;
        expect(record.reset?.work.kind).toBe("absent");
        for (const timer of h.scheduler.pending().filter(timer => timer.deadlineMonotonicMs === h.authority.clock.monotonicMs() + h.deps.idleRepollMs)) timer.fire();
        await tick();
        expect(database.authority.workerControls.get(record.commandId)?.phase.state).toBe("executing");
        expect(database.authority.workerControls.pending(record.scope)).toHaveLength(1);
        expect(database.authority.commandAudits.findByCommand(record.commandId)).toBeUndefined();
        expect(database.authority.workerLeases.get(workerId)?.lifecycle.state).not.toBe("idle");
        expect(claimedAfterReset).toBe(false);
        release(); await tick();
        for (const timer of h.scheduler.pending().filter(timer => timer.deadlineMonotonicMs === h.authority.clock.monotonicMs() + h.deps.idleRepollMs)) timer.fire();
        await tick();
        expect(database.authority.workerControls.get(record.commandId)?.phase.state).toBe("succeeded");
        expect(database.authority.commandAudits.findByCommand(record.commandId)?.result.state).toBe("applied");
        expect(database.authority.workerControls.pending(record.scope)).toEqual([]);
        expect(database.authority.workerLeases.get(workerId)).toMatchObject({ leaseGeneration: lease.leaseGeneration, lifecycle: { state: "idle" } });
        expect(claimedAfterReset).toBe(true);
        expect(h.stop.signal.aborted).toBe(false);
      } finally {
        release(); h.stop.abort(new Error("owned test cleanup")); await loop; observer.stop();
      }
    });
  }
  for (const mode of ["idle", "current", "paused"] as const) {
    it(`settles ${mode} without a client and records idle before next claim`, async () => {
      const h = await world.loopHarness();
      const database = h.authority.database, workerId = h.deps.workerId;
      const lifecycle = new RunRecordService({ database, clock: h.authority.clock, ids: sequentialIdFactory("e"), publishQueued: () => undefined });
      const current = mode === "current";
      if (mode === "paused") {
        const lease = database.authority.workerLeases.get(workerId);
        if (lease === undefined) throw new Error("missing pause owner");
        const now = h.authority.clock.now().toISOString();
        database.authority.workerLeases.control({ workerId, expectedVersion: lease.version, control: { directive: "pause", requestedBy: "local-operator", requestedAt: now }, now });
        database.authority.workerLeases.reportLifecycle({ workerId, leaseGeneration: lease.leaseGeneration, lifecycle: { state: "paused", startedAt: lease.lifecycle.startedAt, heartbeatAt: now, pausedAt: now }, now });
      }
      if (current) {
        database.authority.runs.enqueue(personLookupQueuedRun());
        const result = database.authority.runs.claimNext({ workerId, workflow: h.deps.workflowId, workerLifetime: { membershipRevision: database.authority.workerSlots.get(workerId)?.membershipRevision, leaseGeneration: database.authority.workerLeases.get(workerId)?.leaseGeneration }, now: h.authority.clock.now().toISOString() });
        expect(result.state).toBe("claimed");
      }
      const slot = database.authority.workerSlots.get(workerId), lease = database.authority.workerLeases.get(workerId);
      if (slot === undefined || lease === undefined) throw new Error("missing lifetime");
      const record = database.withAuthorityTransaction(repositories => admitWorkerReset(repositories, {
        commandId: randomUUID(), family: "worker-browser", type: "stop-worker", source: "dashboard", requestedBy: "local-operator",
        requestedAt: h.authority.clock.now().toISOString(), target: { workerId, membershipRevision: slot.membershipRevision,
          controlBasis: { leaseGeneration: lease.leaseGeneration, controlRevision: lease.controlRevision } },
      }, randomUUID(), h.authority.clock.now().toISOString()));
      let observedMilestone = false;
      const report = await runWorkerLoop({ ...h.deps,
        resetOwner: record.reset === undefined ? undefined : { member: record.reset.member, lifetime: record.reset.lifetime },
        pendingReset: () => database.authority.workerControls.resetForWorker(workerId)?.reset,
        resetControl: createWorkerResetControl({ database, workerId, leaseGeneration: lease.leaseGeneration, clock: h.authority.clock, lifecycle }),
        claimNext: request => {
          expect(database.authority.workerControls.get(record.commandId)).toMatchObject({ phase: { state: "succeeded", acknowledgement: { kind: "reset" } } });
          expect(database.authority.commandAudits.findByCommand(record.commandId)?.result.state).toBe("applied");
          expect(database.authority.workerLeases.get(workerId)).toMatchObject({ leaseGeneration: lease.leaseGeneration, lifecycle: { state: "idle" }, control: { directive: "run" } });
          observedMilestone = true;
          return h.deps.claimNext(request);
        },
      });
      expect(observedMilestone).toBe(true);
      expect(report.stopped).toBe("idle");
      expect(database.authority.workerControls.pending(record.scope)).toEqual([]);
      if (current && record.reset?.work.kind === "current") expect(database.authority.runs.get(record.reset.work.current.runId)?.lifecycle).toMatchObject({ state: "terminal", outcome: "cancelled" });
    });
  }
});

describe("authenticated reset closure", () => {
  async function fixture() {
    const h = await world.loopHarness();
    const database = h.authority.database, workerId = h.deps.workerId;
    const slot = database.authority.workerSlots.get(workerId), lease = database.authority.workerLeases.get(workerId);
    if (slot === undefined || lease === undefined) throw new Error("missing lifetime");
    const record = database.withAuthorityTransaction(repositories => admitWorkerReset(repositories, {
      commandId: randomUUID(), family: "worker-browser", type: "stop-worker", source: "dashboard", requestedBy: "local-operator",
      requestedAt: h.authority.clock.now().toISOString(), target: { workerId, membershipRevision: slot.membershipRevision,
        controlBasis: { leaseGeneration: lease.leaseGeneration, controlRevision: lease.controlRevision } },
    }, randomUUID(), h.authority.clock.now().toISOString()));
    const reset = record.reset;
    if (reset === undefined) throw new Error("reset missing");
    database.authority.workerControls.transition(record.commandId, "admitted", { state: "executing", startedAt: record.admittedAt });
    const manager = (owner = { member: reset.member, lifetime: reset.lifetime }) => new WorkerSessionManager({
      workerId: h.deps.workerId, workflowId: h.deps.workflowId, stores: h.deps.stores, factory: h.deps.sessionFactory,
      clock: h.authority.clock, scheduler: h.scheduler, acquireDeadlineMs: h.deps.sessionAcquireMs, duoCeremony: h.deps.duoCeremony, resetOwner: owner,
    });
    return { h, database, record, reset, manager };
  }
  for (const change of ["absent", "replaced"] as const) {
    it(`does not dispatch the original reset when its pending binding is ${change} after settlement`, async () => {
      const f = await fixture();
      const replacement = change === "absent" ? undefined : WorkerResetBindingSchema.parse({ ...f.reset, commandId: randomUUID() });
      let reads = 0, calls = 0;
      await runWorkerLoop({ ...f.h.deps,
        pendingReset: () => {
          reads += 1;
          if (reads === 1) return f.reset;
          if (reads === 2) return replacement;
          f.h.stop.abort(new Error("owned test shutdown after revalidation"));
          return undefined;
        },
        resetControl: async () => { calls += 1; },
      });
      expect(calls).toBe(0);
      expect(f.database.authority.workerControls.pending(f.record.scope)).toHaveLength(1);
      expect(f.database.authority.commandAudits.findByCommand(f.record.commandId)).toBeUndefined();
    });
  }
  it("rejects forged, wrong-command and stale-lifetime proofs without releasing the reservation", async () => {
    const f = await fixture(), manager = f.manager();
    expect(() => f.database.settleWorkerReset(f.record.commandId, { kind: "worker-control-owner-closure" }, f.record.admittedAt, randomUUID())).toThrow();
    const wrong = await manager.closeForReset(WorkerResetBindingSchema.parse({ ...f.reset, commandId: randomUUID() }));
    expect(() => f.database.settleWorkerReset(f.record.commandId, wrong, f.record.admittedAt, randomUUID())).toThrow();
    await expect(f.manager(WorkerResetBindingSchema.parse({ ...f.reset, basis: { ...f.reset.basis, leaseGeneration: f.reset.lifetime.leaseGeneration + 1 }, lifetime: { ...f.reset.lifetime, leaseGeneration: f.reset.lifetime.leaseGeneration + 1 } })).closeForReset(f.reset)).rejects.toThrow("member-conflict");
    await expect(f.manager(WorkerResetBindingSchema.parse({ ...f.reset, member: { ...f.reset.member, membershipRevision: f.reset.member.membershipRevision + 1 } })).closeForReset(f.reset)).rejects.toThrow("member-conflict");
    expect(f.database.authority.workerControls.pending(f.record.scope)).toHaveLength(1);
  });
  it("invalidates closure on a new driver request and consumes only a successful settlement", async () => {
    const f = await fixture(), manager = f.manager();
    const proof = await manager.closeForReset(f.reset);
    await expect(manager.withDriver({ system: "ucpath", access: "read", session: "reuse-worker" }, "prod", new AbortController().signal, async () => undefined)).rejects.toThrow("bound config fingerprint");
    expect(() => f.database.settleWorkerReset(f.record.commandId, proof, f.record.admittedAt, randomUUID())).toThrow();
    const fresh = await manager.closeForReset(f.reset);
    expect(() => f.database.settleWorkerReset(f.record.commandId, fresh, "invalid", randomUUID())).toThrow();
    f.database.settleWorkerReset(f.record.commandId, fresh, f.record.admittedAt, randomUUID());
    expect(() => f.database.settleWorkerReset(f.record.commandId, fresh, f.record.admittedAt, randomUUID())).toThrow();
    expect(f.database.authority.workerControls.get(f.record.commandId)?.phase).toMatchObject({ state: "succeeded", acknowledgement: { kind: "reset", closedSessionIds: [] } });
  });
});

describe("reset owns active and late callbacks through browser closure", () => {
  for (const stage of ["read", "acquisition", "sign-in"] as const) {
    it(`keeps ${stage} work pending through expiry, then settles after actual callback rejection/release`, async () => {
      let release!: () => void, started!: () => void;
      const held = new Promise<void>(resolve => { release = resolve; });
      const starting = new Promise<void>(resolve => { started = resolve; });
      let signal: AbortSignal | undefined;
      const driver = healthyUcpathDriver();
      const base = sessionFactoryHarness({ ucpath: () => stage === "read" ? { ...driver,
        searchPersonOrg: async () => { started(); await held; throw new Error("actual read callback rejected after reset"); },
      } : driver, crm: () => healthyCrmDriver() });
      const h = await world.loopHarness({ sessions: { ...base, factory: { probeProfile: async () => undefined, open: async input => {
        signal = input.signal;
        if (stage === "acquisition") { signal = input.signal; started(); await held; }
        const resource = await base.factory.open(input);
        return stage === "sign-in" ? { ...resource, authentication: { authenticate: async (_system, options) => {
          signal = options.signal; started(); await held; return "logged-in" as const;
        } } } : resource;
      } } } });
      const database = h.authority.database, workerId = h.deps.workerId;
      const slot = database.authority.workerSlots.get(workerId), lease = database.authority.workerLeases.get(workerId);
      if (slot === undefined || lease === undefined) throw new Error("missing owner");
      const lifecycle = new RunRecordService({ database, clock: h.authority.clock, ids: sequentialIdFactory("e"), publishQueued: () => undefined });
      const owner = { member: workerPoolMember(slot), lifetime: { leaseGeneration: lease.leaseGeneration, processId: lease.processId, startedAt: lease.lifecycle.startedAt } };
      const observer = createWorkerResetObserver({ database, workerId, leaseGeneration: lease.leaseGeneration, clock: h.authority.clock, scheduler: h.scheduler, onFailure: error => { h.stop.abort(error); } });
      database.authority.runs.enqueue(personLookupQueuedRun());
      let finished = false;
      let settlementError: unknown;
      const settle = createWorkerResetControl({ database, workerId, leaseGeneration: lease.leaseGeneration, clock: h.authority.clock, lifecycle });
      const loop = runWorkerLoop({ ...h.deps, resetOwner: owner, pendingReset: observer, activeWorkReset: () => observer() !== undefined,
        browserObservation: observation => { database.authority.workerControls.observe({ ...observation, leaseGeneration: lease.leaseGeneration }); },
        resetControl: async (sessions, reset) => { try { await settle(sessions, reset); } catch (error) { settlementError = error; h.stop.abort(error); throw error; } },
      }).then(report => { finished = true; return report; });
      await starting;
      const record = database.withAuthorityTransaction(repositories => admitWorkerReset(repositories, {
        commandId: randomUUID(), family: "worker-browser", type: "stop-worker", source: "dashboard", requestedBy: "local-operator",
        requestedAt: h.authority.clock.now().toISOString(), target: { workerId, membershipRevision: slot.membershipRevision,
          controlBasis: { leaseGeneration: lease.leaseGeneration, controlRevision: lease.controlRevision } },
      }, randomUUID(), h.authority.clock.now().toISOString()));
      for (const timer of h.scheduler.pending().filter(timer => timer.deadlineMonotonicMs === h.authority.clock.monotonicMs() + 1000)) timer.fire();
      await tick();
      if (stage !== "read") expect(signal?.aborted).toBe(true);
      expect(h.stop.signal.aborted).toBe(false);
      expect(finished).toBe(false);
      expect(database.authority.commandAudits.findByCommand(record.commandId)).toBeUndefined();
      h.authority.clock.advanceWall(Date.parse(record.expiresAt) - h.authority.clock.nowMs() + 1);
      const expiry = h.scheduler.pending().find(timer => timer.deadlineMonotonicMs > h.authority.clock.monotonicMs() + 1000);
      expect(expiry).toBeDefined();
      expiry?.fire();
      expect(database.authority.workerControls.get(record.commandId)).toMatchObject({ reset: record.reset, phase: { state: "uncertain" } });
      expect(database.authority.workerControls.pending(record.scope)).toHaveLength(1);
      release();
      const report = await loop;
      observer.stop();
      expect(settlementError).toBeUndefined();
      expect(report.closure).toBe("proved");
      expect(database.authority.workerControls.get(record.commandId)?.phase.state).toBe("succeeded");
      expect(database.authority.workerControls.browsers(workerId).every(observation => observation.health === "closed")).toBe(true);
      expect(database.authority.workerLeases.get(workerId)?.lifecycle.state).toBe("idle");
    });
  }
});

describe("reset preserves fenced durable write outcomes", () => {
  for (const outcome of ["committed", "unknown", "unknown-generation", "unknown-intent", "unknown-attempt"] as const) {
    it(`${outcome.startsWith("unknown-") ? "refuses malformed" : "allows browserless idle with unchanged"} ${outcome} authority after the admitted callback settles`, async () => {
      const h = await world.loopHarness(), database = h.authority.database;
      seedAtomicWriteOwner(database, ATOMIC_WRITE_COMMIT, h.authority.path);
      fenceWriteFixture(database, { intent: WRITE_INTENT_ATTEMPTING, attempt: WRITE_ATTEMPT });
      const run = database.authority.runs.get(WRITE_INTENT_ATTEMPTING.runId);
      const claim = run === undefined ? undefined : runClaim(run);
      if (run === undefined || claim === undefined) throw new Error("missing write owner");
      const workerId = claim.workerId;
      const slot = database.authority.workerSlots.get(workerId), lease = database.authority.workerLeases.get(workerId);
      if (slot === undefined || lease === undefined) throw new Error("missing lifetime");
      const record = database.withAuthorityTransaction(repositories => admitWorkerReset(repositories, {
        commandId: randomUUID(), family: "worker-browser", type: "stop-worker", source: "dashboard", requestedBy: "local-operator",
        requestedAt: h.authority.clock.now().toISOString(), target: { workerId, membershipRevision: slot.membershipRevision,
          controlBasis: { leaseGeneration: lease.leaseGeneration, controlRevision: lease.controlRevision } },
      }, randomUUID(), h.authority.clock.now().toISOString()));
      if (outcome === "committed") database.commitWriteAttempt(ATOMIC_WRITE_COMMIT, atomicWriteCheckpoint(ATOMIC_WRITE_COMMIT));
      else {
        database.authority.writeIntents.parkAttempt({ writeIntentId: WRITE_INTENT_ATTEMPTING.writeIntentId, generation: 1, expectedVersion: 1,
          code: "unknown", message: "controlled unknown callback", authorityReason: deriveWriteAuthorityReason("recovery-probe-unknown", "probe", "controlled unknown callback"), now: h.authority.clock.now().toISOString() });
        const result = database.authority.runs.transition({ runId: run.envelope.runId, expectedVersion: run.version, claim: { workerId, claimGeneration: claim.claimGeneration },
          lifecycle: { state: "parked-write", writeIntentId: WRITE_INTENT_ATTEMPTING.writeIntentId, intentGeneration: 1,
            parkedAt: h.authority.clock.now().toISOString(), code: "unknown", message: "controlled unknown callback" }, now: h.authority.clock.now().toISOString() });
        expect(result.state).toBe("applied");
      }
      let restoreParkedBinding = false, restoreIntentRunAttempt = false;
      const undamagedRun = database.authority.runs.get(run.envelope.runId);
      const undamagedIntent = WriteIntentRecordSchema.parse(database.authority.writeIntents.get(WRITE_INTENT_ATTEMPTING.writeIntentId));
      if (undamagedRun === undefined) throw new Error("missing undamaged write fixture");
      if (undamagedIntent.status === "observed-present") throw new Error("corruption probe requires an attempt-bearing intent");
      if (outcome === "unknown-generation" || outcome === "unknown-intent") {
        restoreParkedBinding = true;
        const parked = database.authority.runs.get(run.envelope.runId);
        if (parked?.lifecycle.state !== "parked-write") throw new Error("missing parked fixture");
        expect(database.authority.runs.transition({ runId: run.envelope.runId, expectedVersion: parked.version,
          lifecycle: { ...parked.lifecycle, ...(outcome === "unknown-generation" ? { intentGeneration: 2 } : { writeIntentId: randomUUID() }) },
          now: h.authority.clock.now().toISOString() }).state).toBe("applied");
      }
      if (outcome === "unknown-attempt") {
        restoreIntentRunAttempt = true;
        const raw = new DatabaseSync(h.authority.path);
        try { raw.prepare("UPDATE write_intents SET payload_json=json_set(payload_json,'$.runAttempt',2) WHERE id=?").run(WRITE_INTENT_ATTEMPTING.writeIntentId); }
        finally { raw.close(); }
      }
      const retained = () => ({ intent: database.authority.writeIntents.get(WRITE_INTENT_ATTEMPTING.writeIntentId),
        attempt: database.authority.writeAttempts.get(WRITE_ATTEMPT.writeAttemptId), publication: database.authority.writeIntents.getPublication(WRITE_INTENT_ATTEMPTING.writeIntentId) });
      const before = retained();
      if (record.reset === undefined) throw new Error("missing reset");
      const reset = record.reset;
      const manager = new WorkerSessionManager({ workerId: slot.workerId, workflowId: slot.workflow, stores: h.deps.stores, factory: h.deps.sessionFactory,
        clock: h.authority.clock, scheduler: h.scheduler, acquireDeadlineMs: h.deps.sessionAcquireMs, duoCeremony: h.deps.duoCeremony,
        resetOwner: { member: record.reset.member, lifetime: record.reset.lifetime } });
      const lifecycle = new RunRecordService({ database, clock: h.authority.clock, ids: sequentialIdFactory("e"), publishQueued: () => undefined });
      const settle = createWorkerResetControl({ database, workerId, leaseGeneration: lease.leaseGeneration, clock: h.authority.clock, lifecycle });
      if (outcome.startsWith("unknown-")) {
        await using _restoration = { async [Symbol.asyncDispose]() {
          if (restoreParkedBinding) {
            const current = database.authority.runs.get(run.envelope.runId);
            if (current === undefined) throw new Error("missing corrupt write fixture");
            expect(database.authority.runs.transition({ runId: current.envelope.runId, expectedVersion: current.version,
              lifecycle: undamagedRun.lifecycle, now: h.authority.clock.now().toISOString() }).state).toBe("applied");
          }
          if (restoreIntentRunAttempt) {
            using raw = new DatabaseSync(h.authority.path);
            const repaired = raw.prepare("UPDATE write_intents SET payload_json=json_set(payload_json,'$.runAttempt',?) WHERE id=?")
                .run(undamagedIntent.runAttempt, undamagedIntent.writeIntentId);
            expect(repaired.changes).toBe(1);
          }
          expect(database.authority.writeIntents.get(undamagedIntent.writeIntentId)).toEqual(undamagedIntent);
          await settle(manager, reset);
        } };
        await expect(settle(manager, record.reset)).rejects.toThrow("parked-write-authority-unavailable");
        const proof = await manager.closeForReset(record.reset);
        const generation = database.getMeta().authorityGeneration;
        expect(() => database.settleWorkerReset(record.commandId, proof, h.authority.clock.now().toISOString(), randomUUID())).toThrow("parked-write-authority-unavailable");
        expect(database.getMeta().authorityGeneration).toBe(generation);
        expect(database.authority.workerControls.pending(record.scope)).toHaveLength(1);
        expect(database.authority.commandAudits.findByCommand(record.commandId)).toBeUndefined();
        expect(retained()).toEqual(before);
        return;
      }
      await settle(manager, record.reset);
      expect(retained()).toEqual(before);
      expect(database.authority.runs.get(run.envelope.runId)?.lifecycle).toMatchObject(outcome === "unknown" ? { state: "parked-write" } : { state: "terminal", outcome: "cancelled" });
      expect(database.authority.workerLeases.get(workerId)?.lifecycle.state).toBe("idle");
      expect(database.authority.workerControls.get(record.commandId)?.phase.state).toBe("succeeded");
      expect(database.authority.commandAudits.findByCommand(record.commandId)?.result.state).toBe("applied");
    });
  }
});

it("marks held actual browser close uncertain at its scheduled expiry without releasing custody", async () => {
  const h = await world.loopHarness(), database = h.authority.database, workerId = h.deps.workerId;
  const slot = database.authority.workerSlots.get(workerId), lease = database.authority.workerLeases.get(workerId);
  if (slot === undefined || lease === undefined) throw new Error("missing owner");
  let release!: () => void, started!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const starting = new Promise<void>(resolve => { started = resolve; });
  const factory = h.deps.sessionFactory;
  const manager = new WorkerSessionManager({ workerId, workflowId: h.deps.workflowId, stores: h.deps.stores,
    factory: { probeProfile: async () => undefined, open: async input => { const resource = await factory.open(input); return { ...resource, close: async input => { started(); await held; return resource.close(input); } }; } },
    clock: h.authority.clock, scheduler: h.scheduler, acquireDeadlineMs: h.deps.sessionAcquireMs, duoCeremony: h.deps.duoCeremony,
    resetOwner: { member: workerPoolMember(slot), lifetime: { leaseGeneration: lease.leaseGeneration, processId: lease.processId, startedAt: lease.lifecycle.startedAt } },
    onObservation: observation => { database.authority.workerControls.observe({ ...observation, leaseGeneration: lease.leaseGeneration }); },
  });
  manager.bindRunConfigFingerprint(RunRecordSchema.parse(personLookupQueuedRun()).envelope.configFingerprint);
  await manager.withDriver({ system: "ucpath", access: "read", session: "reuse-worker" }, "prod", new AbortController().signal, async () => undefined);
  const record = database.withAuthorityTransaction(repositories => admitWorkerReset(repositories, {
    commandId: randomUUID(), family: "worker-browser", type: "stop-worker", source: "dashboard", requestedBy: "local-operator",
    requestedAt: h.authority.clock.now().toISOString(), target: { workerId, membershipRevision: slot.membershipRevision,
      controlBasis: { leaseGeneration: lease.leaseGeneration, controlRevision: lease.controlRevision } },
  }, randomUUID(), h.authority.clock.now().toISOString()));
  const observer = createWorkerResetObserver({ database, workerId, leaseGeneration: lease.leaseGeneration, clock: h.authority.clock, scheduler: h.scheduler, onFailure: error => { h.stop.abort(error); } });
  const reset = observer();
  if (reset === undefined) throw new Error("missing reset");
  const lifecycle = new RunRecordService({ database, clock: h.authority.clock, ids: sequentialIdFactory("e"), publishQueued: () => undefined });
  let done = false;
  const closing = createWorkerResetControl({ database, workerId, leaseGeneration: lease.leaseGeneration, clock: h.authority.clock, lifecycle })(manager, reset).then(() => { done = true; });
  await starting;
  h.authority.clock.advanceWall(Date.parse(record.expiresAt) - h.authority.clock.nowMs() + 1);
  const expiry = h.scheduler.pending().find(timer => timer.deadlineMonotonicMs > h.authority.clock.monotonicMs());
  expect(expiry).toBeDefined(); expiry?.fire();
  expect(database.authority.workerControls.get(record.commandId)?.phase.state).toBe("uncertain");
  expect(database.authority.workerControls.pending(record.scope)).toHaveLength(1);
  expect(database.authority.commandAudits.findByCommand(record.commandId)).toBeUndefined();
  expect(database.authority.workerControls.browsers(workerId).some(value => value.health !== "closed")).toBe(true);
  expect(done).toBe(false);
  release(); await closing;
  observer.stop();
  expect(database.authority.workerControls.get(record.commandId)?.phase.state).toBe("succeeded");
});

it("exposes no raw success setter and atomically cancels a safe queued cascade before idle", async () => {
  const { root, modules } = childUnawaitedModules("cascade");
  const base = await world.loopHarness(), database = base.authority.database;
  const worker = testAdmittedWorker(database, base.authority.clock, { path: base.authority.path, workflow: root.descriptor.id,
    poolIndex: 1, browserSystems: [] });
  const workerId = worker.workerId;
  const h = { ...base, deps: { ...base.deps, workerId, workflowId: root.descriptor.id, descriptor: root.descriptor, stores: plan1Stores } };
  const sessions = new WorkerSessionManager({ workerId, workflowId: h.deps.workflowId, stores: h.deps.stores,
    factory: h.deps.sessionFactory, clock: h.authority.clock, scheduler: h.scheduler,
    acquireDeadlineMs: h.deps.sessionAcquireMs, duoCeremony: h.deps.duoCeremony });
  const resolve = (id: string) => modules.find(module => module.descriptor.id === id)?.descriptor;
  const execution = canonicalChildExecution({ ...h.deps, sessions, buildManifest: childExecutionBuildManifest }, database, h.authority.path, resolve);
  const parent = execution.start(root.descriptor, { emplId: "10000000", text: "Reset fixture", mode: Plan1Input.shape.mode.options[0] }, { dryRun: false });
  expect(database.authority.runs.claimNext({ workerId, workflow: h.deps.workflowId, workerLifetime: { membershipRevision: database.authority.workerSlots.get(workerId)?.membershipRevision, leaseGeneration: database.authority.workerLeases.get(workerId)?.leaseGeneration }, now: h.authority.clock.now().toISOString() }).state).toBe("claimed");
  const node = descriptorRuntimeNodes(root.descriptor).find(node => node.kind === "child-run");
  if (node === undefined || node.kind !== "child-run") throw new Error("missing canonical reset child node");
  let current = database.authority.runs.get(parent.envelope.runId);
  if (current === undefined) throw new Error("missing canonical reset parent");
  const held = runClaim(current);
  if (held === undefined) throw new Error("canonical reset parent claim required");
  expect(held.workerId).toBe(workerId);
  const claim = { workerId: held.workerId, claimGeneration: held.claimGeneration };
  const now = h.authority.clock.now().toISOString();
  for (const state of ["validating", "running"] as const) {
    const transition = execution.lifecycle.workerTransition({ commandId: randomUUID(), runId: parent.envelope.runId, claim,
      lifecycle: { state, workerId, workerLifetime: worker.workerLifetime, claimedAt: now, heartbeatAt: now,
        ...(state === "running" ? { currentNodeId: node.id } : {}) } });
    expect(transition.state).toBe("applied");
  }
  current = database.authority.runs.get(parent.envelope.runId);
  if (current === undefined) throw new Error("missing running reset parent");
  await createDurableChildRunExecutor({ authority: database,
    admission: { admitAndRelease: (context, plan) => execution.lifecycle.admitDelegation(context, plan) },
    resolveTarget: id => { const descriptor = resolve(id); if (descriptor === undefined) throw new Error("missing reset child descriptor"); return descriptor; },
  }).executeChildRun({ descriptor: root.descriptor, node, run: current, claim,
    scope: { input: parent.input.parsed.value, outputs: {} }, signal: new AbortController().signal });
  const child = database.authority.runs.listChildren(parent.envelope.runId)[0];
  expect(child).toBeDefined();
  if (child === undefined) throw new Error("canonical reset child was not admitted");
  const childId = child.envelope.runId;
  await sessions.closeAll("worker-stop");
  const slot = database.authority.workerSlots.get(workerId), lease = database.authority.workerLeases.get(workerId);
  if (slot === undefined || lease === undefined) throw new Error("missing owner");
  const record = database.withAuthorityTransaction(repositories => admitWorkerReset(repositories, {
    commandId: randomUUID(), family: "worker-browser", type: "stop-worker", source: "dashboard", requestedBy: "local-operator", requestedAt: now,
    target: { workerId, membershipRevision: slot.membershipRevision, controlBasis: { leaseGeneration: lease.leaseGeneration, controlRevision: lease.controlRevision } },
  }, randomUUID(), now));
  if (record.reset === undefined) throw new Error("missing reset");
  database.authority.workerControls.transition(record.commandId, "admitted", { state: "executing", startedAt: now });
  expect(Reflect.has(database.authority.workerControls, "settleReset")).toBe(false);
  const manager = new WorkerSessionManager({ workerId, workflowId: h.deps.workflowId, stores: h.deps.stores, factory: h.deps.sessionFactory,
    clock: h.authority.clock, scheduler: h.scheduler, acquireDeadlineMs: h.deps.sessionAcquireMs, duoCeremony: h.deps.duoCeremony,
    resetOwner: { member: record.reset.member, lifetime: record.reset.lifetime } });
  const proof = await manager.closeForReset(record.reset);
  const generation = database.getMeta().authorityGeneration;
  expect(() => database.settleWorkerReset(record.commandId, proof, now, randomUUID())).toThrow("run-release-unproved");
  expect(database.getMeta().authorityGeneration).toBe(generation);
  expect(database.authority.commandAudits.findByCommand(record.commandId)).toBeUndefined();
  expect(() => database.authority.workerControls.transition(record.commandId, "executing", { state: "succeeded", startedAt: now, completedAt: now,
    acknowledgement: { kind: "reset", commandId: record.commandId, leaseGeneration: lease.leaseGeneration, controlRevision: record.reset?.reservedControlRevision,
      membershipRevision: slot.membershipRevision, idleAt: now, closedSessionIds: [], browsersClosed: true, duoReleased: true } })).toThrow();
  const lifecycle = execution.lifecycle;
  lifecycle.settleResetWork(record.reset);
  expect(database.authority.runs.get(childId)?.lifecycle).toMatchObject({ state: "terminal", outcome: "cancelled" });
  expect(database.authority.runs.get(parent.envelope.runId)?.lifecycle).toMatchObject({ state: "terminal", outcome: "cancelled" });
  database.settleWorkerReset(record.commandId, proof, now, randomUUID());
  expect(database.authority.commandAudits.findByCommand(record.commandId)?.result.state).toBe("applied");
});

for (const succeeded of [false, true]) {
  it(`disposes reset expiry before immediate lifetime/database shutdown (${succeeded ? "after success" : "while pending"})`, async () => {
    const h = await world.loopHarness(), database = h.authority.database, workerId = h.deps.workerId;
    const slot = database.authority.workerSlots.get(workerId), lease = database.authority.workerLeases.get(workerId);
    if (slot === undefined || lease === undefined) throw new Error("missing owner");
    const now = h.authority.clock.now().toISOString();
    database.withAuthorityTransaction(repositories => admitWorkerReset(repositories, {
      commandId: randomUUID(), family: "worker-browser", type: "stop-worker", source: "dashboard", requestedBy: "local-operator", requestedAt: now,
      target: { workerId, membershipRevision: slot.membershipRevision, controlBasis: { leaseGeneration: lease.leaseGeneration, controlRevision: lease.controlRevision } },
    }, randomUUID(), now));
    const failures: unknown[] = [];
    const observer = createWorkerResetObserver({ database, workerId, leaseGeneration: lease.leaseGeneration, clock: h.authority.clock, scheduler: h.scheduler,
      onFailure: error => { failures.push(error); h.stop.abort(error); } });
    const reset = observer();
    if (reset === undefined) throw new Error("missing reset");
    const timer = h.scheduler.pending()[0]; expect(timer).toBeDefined();
    if (succeeded) {
      const manager = new WorkerSessionManager({ workerId, workflowId: h.deps.workflowId, stores: h.deps.stores, factory: h.deps.sessionFactory,
        clock: h.authority.clock, scheduler: h.scheduler, acquireDeadlineMs: h.deps.sessionAcquireMs, duoCeremony: h.deps.duoCeremony,
        resetOwner: { member: reset.member, lifetime: reset.lifetime } });
      const lifecycle = new RunRecordService({ database, clock: h.authority.clock, ids: sequentialIdFactory("e"), publishQueued: () => undefined });
      await createWorkerResetControl({ database, workerId, leaseGeneration: lease.leaseGeneration, clock: h.authority.clock, lifecycle })(manager, reset);
    }
    h.stop.abort(new Error("immediate owned shutdown"));
    observer.stop();
    expect(timer?.cancelled()).toBe(true);
    expect(h.scheduler.pending()).toEqual([]);
    h.authority.closeDatabase();
    h.authority.clock.advanceWall(120_000);
    expect(() => timer?.fire()).toThrow("no longer pending");
    expect(failures).toEqual([]);
    expect(observer.failure()).toBeUndefined();
  });
}

it("surfaces timer authority failure through the worker failure seam and retains its cause", async () => {
  const h = await world.loopHarness(), database = h.authority.database, workerId = h.deps.workerId;
  const slot = database.authority.workerSlots.get(workerId), lease = database.authority.workerLeases.get(workerId);
  if (slot === undefined || lease === undefined) throw new Error("missing owner");
  const now = h.authority.clock.now().toISOString();
  database.withAuthorityTransaction(repositories => admitWorkerReset(repositories, {
    commandId: randomUUID(), family: "worker-browser", type: "stop-worker", source: "dashboard", requestedBy: "local-operator", requestedAt: now,
    target: { workerId, membershipRevision: slot.membershipRevision, controlBasis: { leaseGeneration: lease.leaseGeneration, controlRevision: lease.controlRevision } },
  }, randomUUID(), now));
  const failures: unknown[] = [];
  const observer = createWorkerResetObserver({ database, workerId, leaseGeneration: lease.leaseGeneration, clock: h.authority.clock, scheduler: h.scheduler,
    onFailure: error => { failures.push(error); h.stop.abort(error); } });
  observer();
  const timer = h.scheduler.pending()[0]; expect(timer).toBeDefined();
  h.authority.closeDatabase();
  expect(() => timer?.fire()).not.toThrow();
  expect(failures).toHaveLength(1);
  expect(observer.failure()).toBe(failures[0]);
  expect(h.stop.signal.reason).toBe(failures[0]);
  expect(() => observer()).toThrow();
  observer.stop();
});

it("does not redispatch an uncertain owner reset after failed closure authority", async () => {
  const h = await world.loopHarness(), database = h.authority.database, workerId = h.deps.workerId;
  const slot = database.authority.workerSlots.get(workerId), lease = database.authority.workerLeases.get(workerId);
  if (slot === undefined || lease === undefined) throw new Error("missing owner");
  const now = h.authority.clock.now().toISOString();
  const record = database.withAuthorityTransaction(repositories => admitWorkerReset(repositories, {
    commandId: randomUUID(), family: "worker-browser", type: "stop-worker", source: "dashboard", requestedBy: "local-operator", requestedAt: now,
    target: { workerId, membershipRevision: slot.membershipRevision, controlBasis: { leaseGeneration: lease.leaseGeneration, controlRevision: lease.controlRevision } },
  }, randomUUID(), now));
  const lifecycle = new RunRecordService({ database, clock: h.authority.clock, ids: sequentialIdFactory("e"), publishQueued: () => undefined });
  const control = createWorkerResetControl({ database, workerId, leaseGeneration: lease.leaseGeneration, clock: h.authority.clock, lifecycle });
  let calls = 0;
  const loop = runWorkerLoop({ ...h.deps, pendingReset: () => database.authority.workerControls.resetForWorker(workerId)?.reset,
    resetControl: async (sessions, reset) => { calls += 1; await control(sessions, reset); } });
  await tick();
  expect(database.authority.workerControls.get(record.commandId)?.phase.state).toBe("uncertain");
  for (let index = 0; index < 3; index += 1) {
    for (const timer of h.scheduler.pending()) timer.fire();
    await tick();
  }
  expect(calls).toBe(1);
  expect(database.authority.commandAudits.findByCommand(record.commandId)).toBeUndefined();
  expect(database.authority.workerControls.pending(record.scope)).toHaveLength(1);
  h.stop.abort(new Error("owned shutdown after retained uncertainty"));
  await loop;
});


it("ends failed close activity while exact Stop retains and then closes the resource", async () => {
  const h = await world.loopHarness(), database = h.authority.database, workerId = h.deps.workerId;
  const slot = database.authority.workerSlots.get(workerId), lease = database.authority.workerLeases.get(workerId);
  if (slot === undefined || lease === undefined) throw new Error("missing owner");
  const activities = new Map<symbol, string>();
  let closes = 0;
  const factory = h.deps.sessionFactory;
  const manager = new WorkerSessionManager({ workerId, workflowId: h.deps.workflowId, stores: h.deps.stores,
    factory: { probeProfile: async () => undefined, open: async input => { const resource = await factory.open(input); return { ...resource, close: async input => {
      closes += 1;
      if (closes === 1) throw new Error("injected first close failure");
      return resource.close(input);
    } }; } },
    clock: h.authority.clock, scheduler: h.scheduler, acquireDeadlineMs: h.deps.sessionAcquireMs, duoCeremony: h.deps.duoCeremony,
    resetOwner: { member: workerPoolMember(slot), lifetime: { leaseGeneration: lease.leaseGeneration, processId: lease.processId, startedAt: lease.lifecycle.startedAt } },
    onActivity: activity => { const key = Symbol(activity); activities.set(key, activity); return () => { activities.delete(key); }; },
    onObservation: observation => { database.authority.workerControls.observe({ ...observation, leaseGeneration: lease.leaseGeneration }); },
  });
  const fingerprint = RunRecordSchema.parse(personLookupQueuedRun()).envelope.configFingerprint;
  manager.bindRunConfigFingerprint(fingerprint);
  const acquire = () => manager.withDriver({ system: "ucpath", access: "read", session: "reuse-worker" }, "prod", new AbortController().signal, async () => undefined);
  await acquire();
  await expect(manager.closeAll("worker-stop")).rejects.toThrow();
  expect(activities.size).toBe(0);
  expect(database.authority.workerControls.browsers(workerId)).toMatchObject([{ health: "failed" }]);
  expect(manager.activeSystems()).toEqual(["ucpath"]);
  const record = database.withAuthorityTransaction(repositories => admitWorkerReset(repositories, {
    commandId: randomUUID(), family: "worker-browser", type: "stop-worker", source: "dashboard", requestedBy: "local-operator",
    requestedAt: h.authority.clock.now().toISOString(), target: { workerId, membershipRevision: slot.membershipRevision,
      controlBasis: { leaseGeneration: lease.leaseGeneration, controlRevision: lease.controlRevision } },
  }, randomUUID(), h.authority.clock.now().toISOString()));
  if (record.reset === undefined) throw new Error("missing reset");
  database.authority.workerControls.transition(record.commandId, "admitted", { state: "executing", startedAt: record.admittedAt });
  const proof = await manager.closeForReset(record.reset);
  database.settleWorkerReset(record.commandId, proof, record.admittedAt, randomUUID());
  expect(closes).toBe(2);
  expect(activities.size).toBe(0);
  expect(database.authority.workerControls.get(record.commandId)?.phase.state).toBe("succeeded");
  await acquire();
  expect(activities.size).toBe(0);
  expect([...activities.values()]).not.toContain("closing");
  await manager.closeAll("worker-stop");
});
