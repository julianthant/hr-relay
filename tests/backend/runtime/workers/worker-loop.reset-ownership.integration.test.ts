import type { BrowserAuthenticationHandle } from "../../../../src/workflow-kit/session.js";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { createWorkerDirectiveTestWorld } from "../../../support/helpers/backend/worker-directive-world.js";
import { healthyUcpathDriver, healthyCrmDriver, personLookupQueuedRun, sessionFactoryHarness } from "../../../support/helpers/phase1f-executor-harness.js";
import { admitWorkerReset } from "../../../../src/backend/storage/sqlite/worker-control.js";
import { runWorkerLoop } from "../../../../src/backend/runtime/workers/worker-loop.js";

const world = createWorkerDirectiveTestWorld();
afterEach(world.cleanup);
const tick = () => new Promise<void>(resolve => { setImmediate(resolve); });

describe("reset retains actual callback ownership", () => {
  for (const deadlineFirst of [false, true]) {
    it(`retains an uncooperative read callback with no idle proof (${deadlineFirst ? "task deadline wins first" : "reset wins first"})`, async () => {
      let started: () => void = () => undefined;
      const starting = new Promise<void>(resolve => { started = resolve; });
      let release: () => void = () => undefined;
      const held = new Promise<void>(resolve => { release = resolve; });
      const driver = healthyUcpathDriver();
      const sessions = sessionFactoryHarness({ ucpath: () => ({ ...driver, searchPersonOrg: async (...args: Parameters<typeof driver.searchPersonOrg>) => {
        started(); await held; return driver.searchPersonOrg(...args);
      } }), crm: () => healthyCrmDriver() });
      const h = await world.loopHarness({ sessions, exitWhenIdle: false });
      h.authority.database.authority.runs.enqueue(personLookupQueuedRun());
      const database = h.authority.database;
      const workerId = h.deps.workerId;
      let finished = false;
      const looping = runWorkerLoop({ ...h.deps, taskDeadlineMs: 5000,
        pendingReset: () => database.authority.workerControls.resetForWorker(workerId)?.reset,
        activeWorkReset: () => database.authority.workerControls.resetForWorker(workerId) !== undefined,
      }).then(report => { finished = true; return report; });
      await starting;
      if (deadlineFirst) {
        const deadline = h.scheduler.pending().find(entry => entry.deadlineMonotonicMs === h.authority.clock.monotonicMs() + 5000);
        expect(deadline).toBeDefined(); deadline?.fire();
        await tick();
        expect(finished).toBe(false);
      }
      const slot = database.authority.workerSlots.get(workerId), lease = database.authority.workerLeases.get(workerId);
      if (slot === undefined || lease === undefined) throw new Error("missing exact worker authority");
      const record = database.withAuthorityTransaction(repositories => admitWorkerReset(repositories, {
        commandId: randomUUID(), family: "worker-browser", type: "stop-worker", source: "dashboard",
        requestedAt: h.authority.clock.now().toISOString(), requestedBy: "local-operator",
        target: { workerId, membershipRevision: slot.membershipRevision, expectedVersion: lease.version,
          controlBasis: { leaseGeneration: lease.leaseGeneration, controlRevision: lease.controlRevision } },
      }, randomUUID(), h.authority.clock.now().toISOString()));
      for (const entry of h.scheduler.pending().filter(entry => entry.deadlineMonotonicMs === h.authority.clock.monotonicMs() + 1000)) entry.fire();
      await tick();
      expect(finished).toBe(false);
      expect(h.stop.signal.aborted).toBe(false);
      expect(database.authority.workerControls.get(record.commandId)?.phase.state).toBe("admitted");
      expect(database.authority.workerLeases.get(workerId)?.control.directive).toBe("run");
      expect(database.authority.workerControls.pending(record.scope)).toHaveLength(1);
      if (!deadlineFirst) {
        expect(database.authority.workerControls.get(record.commandId)?.reset).toEqual(record.reset);
        const heartbeat = h.scheduler.pending().find(entry => entry.deadlineMonotonicMs === h.authority.clock.monotonicMs() + h.deps.heartbeatIntervalMs);
        expect(heartbeat, "active-run heartbeat must remain owned until the actual callback settles").toBeDefined();
        const before = database.authority.runs.get(record.reset?.work.kind === "current" ? record.reset.work.current.runId : "");
        expect(before).toBeDefined();
        h.authority.clock.advanceWall(100);
        heartbeat?.fire();
        expect(database.authority.runs.get(String(before?.envelope.runId))?.version).toBe(Number(before?.version) + 1);
      }
      release(); await tick();
      expect(h.scheduler.pending().some(entry => entry.deadlineMonotonicMs === h.authority.clock.monotonicMs() + h.deps.heartbeatIntervalMs),
        "actual settlement releases the active-run heartbeat before waiting between runs").toBe(false);
      expect(finished).toBe(false);
      expect(database.authority.workerControls.get(record.commandId)?.phase.state).toBe("admitted");
      h.stop.abort(new Error("owned test lifetime shutdown"));
      await looping;
    });
  }
  for (const stage of ["acquisition", "sign-in"] as const) {
    it(`observes reset during actual session ${stage} without ending the lifetime or releasing its journal`, async () => {
      const base = sessionFactoryHarness({ ucpath: () => healthyUcpathDriver(), crm: () => healthyCrmDriver() });
      let release: () => void = () => undefined;
      const held = new Promise<void>(resolve => { release = resolve; });
      let started: () => void = () => undefined;
      const starting = new Promise<void>(resolve => { started = resolve; });
      let activeSignal: AbortSignal | undefined;
      const sessions = { ...base, factory: { open: async (input: Parameters<typeof base.factory.open>[0]) => {
        if (stage === "acquisition") { activeSignal = input.signal; started(); await held; }
        const resource = await base.factory.open(input);
        return stage === "sign-in" ? { ...resource, authentication: { authenticate: async (_system: Parameters<BrowserAuthenticationHandle["authenticate"]>[0], options: Parameters<BrowserAuthenticationHandle["authenticate"]>[1]) => { activeSignal = options.signal; started(); await held; return "logged-in" as const; } } } : resource;
      } } };
      const h = await world.loopHarness({ sessions, exitWhenIdle: false });
      const database = h.authority.database, workerId = h.deps.workerId;
      database.authority.runs.enqueue(personLookupQueuedRun());
      let finished = false;
      const looping = runWorkerLoop({ ...h.deps,
        pendingReset: () => database.authority.workerControls.resetForWorker(workerId)?.reset,
        activeWorkReset: () => database.authority.workerControls.resetForWorker(workerId) !== undefined,
      }).then(report => { finished = true; return report; });
      await starting;
      expect(activeSignal?.aborted).toBe(false);
      const slot = database.authority.workerSlots.get(workerId), lease = database.authority.workerLeases.get(workerId);
      if (slot === undefined || lease === undefined) throw new Error("missing custody");
      const record = database.withAuthorityTransaction(repositories => admitWorkerReset(repositories, {
        commandId: randomUUID(), family: "worker-browser", type: "stop-worker", source: "dashboard",
        requestedAt: h.authority.clock.now().toISOString(), requestedBy: "local-operator",
        target: { workerId, membershipRevision: slot.membershipRevision, expectedVersion: lease.version,
          controlBasis: { leaseGeneration: lease.leaseGeneration, controlRevision: lease.controlRevision } },
      }, randomUUID(), h.authority.clock.now().toISOString()));
      for (const entry of h.scheduler.pending().filter(entry => entry.deadlineMonotonicMs === h.authority.clock.monotonicMs() + 1000)) entry.fire();
      await tick();
      expect(activeSignal?.aborted, "the actual acquisition/authentication owner must receive reset cancellation").toBe(true);
      expect(finished).toBe(false);
      expect(h.stop.signal.aborted).toBe(false);
      expect(database.authority.workerControls.get(record.commandId)).toEqual(record);
      release(); await tick();
      h.stop.abort(new Error("test lifetime shutdown"));
      await looping;
      expect(database.authority.workerControls.pending(record.scope)).toHaveLength(1);
    });
  }

});
