
import * as credentialStores from "../../../../src/backend/storage/configuration/credential-store.js";
import { RuntimeCustodyUncertainError } from "../../../../src/backend/app/composition/storage-compose.js";
import { createWorkerCompositionTestWorld } from "../../../support/helpers/backend/worker-composition-world.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";


import { afterEach, describe, it, vi } from "vitest";
import { WorkerSessionManager, WorkerSessionClosureUnprovedError } from "../../../../src/backend/runtime/workers/worker-sessions.js";
import { composeWorkerRuntime } from "../../../../src/backend/app/composition/worker-compose.js";
import { admitDirectWorker } from "../../../../src/backend/storage/sqlite/worker-slots.js";
import { PositiveIntSchema } from "../../../../src/rules/identity/ids.js";
import { manualClock, type TestClock } from "../../../../src/rules/time/clock.js";
import { RUN_ID, WORKFLOW_ID } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { happySessionHarness, healthyCrmDriver, personLookupQueuedRun, sessionFactoryHarness, type SessionFactoryHarness } from "../../../support/helpers/phase1f-executor-harness.js";

const {NOW, POOL_INDEX_1, repoRootWithState, seedQueuedRun, reopen, captureSyntheticClosure, workerLifetime, composeInput, cleanup } = createWorkerCompositionTestWorld();


afterEach(cleanup);
const POOL_INDEX_2 = PositiveIntSchema.parse(2);

function admittedWorkerId(stateRoot: string, clock: TestClock, poolIndex = 1) {
  const database = reopen(stateRoot, clock);
  const existing = database.authority.workerSlots.list(WORKFLOW_ID)
    .find(slot => slot.poolIndex === poolIndex && slot.retiredAt === null);
  if (existing !== undefined) return existing.workerId;
  return database.withAuthorityTransaction(repositories => admitDirectWorker(repositories, {
    commandId: randomUUID(), workflow: WORKFLOW_ID, poolIndex,
    expectedPoolVersion: repositories.workerPools.get(WORKFLOW_ID)?.version ?? 0,
    processId: process.pid,
    now: clock.now().toISOString()
}, randomUUID())).workerId;
}

describe("composed worker runtime", () => {

  it("builds the whole dependency graph and drains a queued run to done", async () => {
    const { repoRoot, stateRoot } = await repoRootWithState();
    const clock = manualClock(new Date(NOW));
    seedQueuedRun(stateRoot, clock, personLookupQueuedRun());
    const sessions = happySessionHarness();
    const lines: string[] = [];

    const report = await composeWorkerRuntime(composeInput({
      repoRoot, clock, sessions, lines, poolIndex: POOL_INDEX_1,
    }));

    assert.equal(report.workflowId, WORKFLOW_ID);
    assert.equal(report.workerId, admittedWorkerId(stateRoot, clock));
    assert.equal(report.stopped, "idle");
    assert.deepEqual(report.outcomes.map(({ state }) => state), ["done"]);

    const database = reopen(stateRoot, clock);
    const run = database.authority.runs.get(RUN_ID);
    assert.ok(run && run.lifecycle.state === "terminal");
    assert.equal(run.lifecycle.outcome, "done");
    // The terminal result authority is the composition's, not a fixture's.
    assert.ok(database.authority.runResults.get(RUN_ID));

    // The durable lease: started by this process, settled honestly at exit.
    const lease = database.authority.workerLeases.get(report.workerId);
    assert.ok(lease && lease.lifecycle.state === "stopped");
    assert.equal(lease.lifecycle.reason, "shutdown");
    assert.equal(lease.processId, process.pid);
    assert.equal(lease.workflow, WORKFLOW_ID);

    // Composition persists its own cross-process timeline in authority.
    assert.ok(database.authority.timelineEvents.page({ workflow: WORKFLOW_ID }).length > 0);

    // One browser session per system, closed exactly once at worker stop.
    assert.equal(sessions.opens("ucpath"), 1);
    assert.deepEqual(sessions.closeReasons(), ["worker-stop", "worker-stop"]);
  });

  it("composes distinct stable identities for members of one workflow pool", async () => {
    const { repoRoot, stateRoot } = await repoRootWithState();
    const clock = manualClock(new Date(NOW));

    const first = await composeWorkerRuntime(composeInput({
      repoRoot, clock, sessions: happySessionHarness(), poolIndex: POOL_INDEX_1,
    }));
    const second = await composeWorkerRuntime(composeInput({
      repoRoot, clock, sessions: happySessionHarness(), poolIndex: POOL_INDEX_2,
    }));

    const expected = [
      admittedWorkerId(stateRoot, clock, POOL_INDEX_1),
      admittedWorkerId(stateRoot, clock, POOL_INDEX_2),
    ];
    const database = reopen(stateRoot, clock);
    assert.deepEqual({
      reports: [first.workerId, second.workerId],
      authorityLeases: expected.map((workerId) => database.authority.workerLeases.get(workerId)?.workerId),
    }, {
      reports: expected,
      authorityLeases: expected,
    });
  });

  it("refuses a second process answering to the same worker id", async () => {
    const { repoRoot, stateRoot } = await repoRootWithState();
    const clock = manualClock(new Date(NOW));
    seedQueuedRun(stateRoot, clock, personLookupQueuedRun());
    const workerId = admittedWorkerId(stateRoot, clock, POOL_INDEX_1);
    const database = reopen(stateRoot, clock);
    const lifetime = await workerLifetime(stateRoot, clock, workerId);
    try {
      assert.equal(database.authority.workerLeases.get(workerId)?.processId, lifetime.pid);
      await assert.rejects(
        composeWorkerRuntime(composeInput({
          repoRoot, clock, sessions: happySessionHarness(), poolIndex: POOL_INDEX_1,
        })),
        /a second process may not answer to the same worker id/,
      );
    } finally { await lifetime.close(); }

  });

  it("stops gracefully mid-run: the run is abandoned, never terminalized over a lost claim", async () => {
    const { repoRoot, stateRoot } = await repoRootWithState();
    const clock = manualClock(new Date(NOW));
    seedQueuedRun(stateRoot, clock, personLookupQueuedRun());
    let started: (() => void) | undefined;
    const driverStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const sessions = sessionFactoryHarness({
      ucpath: () => Object.freeze({
        system: "ucpath" as const,
        searchPersonOrg: (): Promise<never> => {
          started?.();
          return new Promise<never>(() => undefined);
        },
      }),
      crm: () => healthyCrmDriver(),
    });
    const stop = new AbortController();

    const running = composeWorkerRuntime(composeInput({
      repoRoot, clock, sessions, stopSignal: stop.signal, poolIndex: POOL_INDEX_1,
    }));
    await Promise.race([driverStarted, running.then(() => { throw new Error("worker settled before driver start"); })]);
    stop.abort(new Error("operator pressed Ctrl-C"));
    const report = await running;

    assert.equal(report.stopped, "stop-signal");
    assert.deepEqual(report.outcomes.map(({ state }) => state), ["abandoned"]);

    assert.deepEqual(sessions.closeReasons(), ["poisoned"]);

    const database = reopen(stateRoot, clock);
    const run = database.authority.runs.get(RUN_ID);
    assert.ok(run && run.lifecycle.state !== "terminal");
    const lease = database.authority.workerLeases.get(admittedWorkerId(stateRoot, clock));
    assert.ok(lease && lease.lifecycle.state === "stopped");
    assert.equal(lease.lifecycle.reason, "shutdown");
  });

  it("refuses unproved closure when worker-stop cannot prove closure, and records the lease as crashed", async () => {
    const { repoRoot, stateRoot } = await repoRootWithState();
    const clock = manualClock(new Date(NOW));
    seedQueuedRun(stateRoot, clock, personLookupQueuedRun());
    const sessions = happySessionHarness(), closes: (() => Promise<unknown>)[] = [];
    const closeFailure = new Error("synthetic fixture context closure failure");
    const unprovable: SessionFactoryHarness = {
      ...sessions,
      factory: { probeProfile: async () => undefined, open: async input => {
        const resource = await sessions.factory.open(input);
        closes.push(async () => {
          const proof = await resource.close({ reason: "worker-stop" });
          assert.equal(proof.sessionId, resource.sessionId); assert.equal(proof.system, resource.system);
          assert.equal(proof.pagesClosed, true); assert.equal(proof.contextClosed, true);
          if (resource.exclusive) assert.equal(proof.exclusiveLeaseReleased, true);
          return proof;
        });
        return { ...resource, close: () => Promise.reject(closeFailure) };
      } },
    };
    const input = composeInput({ repoRoot, clock, sessions: unprovable, poolIndex: POOL_INDEX_1 });
    const descriptor: TypedPropertyDescriptor<WorkerSessionManager["closeAll"]> | undefined = Object.getOwnPropertyDescriptor(WorkerSessionManager.prototype, "closeAll");
    assert.ok(descriptor?.value);
    const closeAll = descriptor.value;
    let sessionFailure: unknown;
    const closeSpy = vi.spyOn(WorkerSessionManager.prototype, "closeAll").mockImplementation(async function (this: WorkerSessionManager, reason) {
      try { await closeAll.call(this, reason); }
      catch (error) { sessionFailure = error; throw error; }
    });
    const captured = captureSyntheticClosure(repoRoot, clock, credentialStores.createCredentialStore);
    const storeSpy = vi.spyOn(credentialStores, "createCredentialStore").mockImplementation(options => captured.createStore(options));
    try {
      await assert.rejects(composeWorkerRuntime({ ...input, openDatabase: (options, openClock) => captured.openDatabase(options, openClock) }), error => {
        assert.ok(error instanceof RuntimeCustodyUncertainError);
        return true;
      });
      assert.ok(sessionFailure instanceof WorkerSessionClosureUnprovedError);
      const contains = (value: unknown): boolean => value === closeFailure
        || value instanceof AggregateError && value.errors.some(member => contains(member));
      assert.equal(contains(sessionFailure), true);
      const report = captured.report; assert.ok(report);
      assert.equal(report.closure, "unproved");
      assert.deepEqual(report.outcomes.map(({ state }) => state), ["done"]);
      const database = reopen(stateRoot, clock);
      const lease = database.authority.workerLeases.get(report.workerId);
      assert.ok(lease && lease.lifecycle.state === "stopped");
      assert.equal(lease.lifecycle.reason, "crashed");
      assert.ok(closes.length > 0);
      captured.assertHeld();
      await captured.closeAfterSyntheticFailure(closes);
    } finally { closeSpy.mockRestore(); captured.restore(); storeSpy.mockRestore(); }
  });

  it("starts a NEW lease generation over a settled one and drains normally", async () => {
    const { repoRoot, stateRoot } = await repoRootWithState();
    const clock = manualClock(new Date(NOW));
    seedQueuedRun(stateRoot, clock, personLookupQueuedRun());
    const workerId = admittedWorkerId(stateRoot, clock);
    const seed = reopen(stateRoot, clock);
    assert.equal(seed.authority.workerLeases.start({
      workerId, workflow: WORKFLOW_ID, browserSystems: ["crm", "ucpath"], processId: process.pid,
      requestedBy: "local-operator", now: NOW,
    }).state, "started");
    assert.equal(seed.authority.workerLeases.reportLifecycle({
      workerId,
      leaseGeneration: 1,
      lifecycle: { state: "stopped", startedAt: NOW, stoppedAt: NOW, reason: "operator" },
      now: NOW,
    }).state, "applied");

    const report = await composeWorkerRuntime(composeInput({
      repoRoot, clock, sessions: happySessionHarness(), poolIndex: POOL_INDEX_1,
    }));
    assert.deepEqual(report.outcomes.map(({ state }) => state), ["done"]);
    const lease = seed.authority.workerLeases.get(workerId);
    assert.ok(lease && lease.leaseGeneration === 2 && lease.processId === process.pid);
  });
});
