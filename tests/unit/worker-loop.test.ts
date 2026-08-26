/**
 * Ref execution-and-sessions §3 worker loop: claim → execute → next, one active item, heartbeat
 * renewal during long operations, claim-loss abort, and worker-stop session
 * closure — plus the Phase-1 `WorkerRuntimeExecutor` seam.
 */
import { fixtureDuoCeremonyGates } from "./fixtures/duo-ceremony-fixtures.js";
import assert from "node:assert/strict";
import { setImmediate } from "node:timers";
import { afterEach, describe, it } from "vitest";
import {
  createPhase1WorkerRuntimeExecutor,
  createWorkerPoolRuntimeExecutor,
  phase1WorkerId,
  poolWorkerId,
  runWorkerLoop,
  type WorkerLoopDependencies,
} from "../../src/core/worker-loop.js";
import { CommandRequestSchema } from "../../src/domain/commands.js";
import { PositiveIntSchema, WorkflowIdSchema } from "../../src/domain/ids.js";
import { taskStoreRegistry } from "../../src/stores/index.js";
import { personLookupDescriptor } from "../../src/workflows/person-lookup/descriptor.js";
import { sequentialIdFactory, ITEM_ID, RUN_ID, WORKFLOW_ID } from "./fixtures/phase1f-run-fixtures.js";
import { UUID_5, UUID_7, NOW } from "./fixtures/phase1c-contract-fixtures.js";
import {
  EXECUTOR_WORKER_ID,
  happySessionHarness,
  healthyCrmDriver,
  healthyUcpathDriver,
  ManualScheduler,
  openAuthorityHarness,
  personLookupQueuedRun,
  recordingEmitter,
  recordingLogger,
  sessionFactoryHarness,
  type SessionFactoryHarness,
} from "./fixtures/phase1f-executor-harness.js";

const disposers: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});

function loopHarness(options: Readonly<{
  sessions?: SessionFactoryHarness;
  heartbeatIntervalMs?: number;
  exitWhenIdle?: boolean;
}> = {}) {
  const authority = openAuthorityHarness();
  disposers.push(authority.dispose);
  const sessions = options.sessions ?? happySessionHarness();
  const scheduler = new ManualScheduler(authority.clock, 0);
  const emitter = recordingEmitter();
  const stop = new AbortController();
  const deps: WorkerLoopDependencies = {
    workflowId: WorkflowIdSchema.parse(WORKFLOW_ID),
    workerId: EXECUTOR_WORKER_ID,
    descriptor: personLookupDescriptor,
    stores: taskStoreRegistry,
    authority: authority.database,
    sessionFactory: sessions.factory,
    emitter: emitter.emitter,
    clock: authority.clock,
    ids: sequentialIdFactory("c"),
    scheduler,
    taskDeadlineMs: 60_000,
    sessionAcquireMs: 20_000,
    duoCeremony: fixtureDuoCeremonyGates(authority.clock),
    heartbeatIntervalMs: options.heartbeatIntervalMs ?? 500,
    idleRepollMs: 1_000,
    log: recordingLogger().log,
    stopSignal: stop.signal,
    exitWhenIdle: options.exitWhenIdle ?? true,
  };
  return { authority, sessions, scheduler, emitter, stop, deps };
}

describe("worker run loop", () => {
  it("drains two queued items sequentially — one active item — and closes sessions at stop", async () => {
    const harness = loopHarness();
    const { database } = harness.authority;
    database.authority.runs.enqueue(personLookupQueuedRun());
    database.authority.runs.enqueue(personLookupQueuedRun({ runId: UUID_5, itemId: UUID_7 }));

    const report = await runWorkerLoop(harness.deps);
    assert.equal(report.stopped, "idle");
    assert.deepEqual(report.outcomes.map(({ state }) => state), ["done", "done"]);

    // Warm reuse across sequential items: one session per system for BOTH
    // runs, closed only at worker stop (ref execution-and-sessions §5).
    assert.equal(harness.sessions.opens("ucpath"), 1);
    assert.equal(harness.sessions.opens("crm"), 1);
    assert.deepEqual(harness.sessions.closeReasons(), ["worker-stop", "worker-stop"]);

    const events = harness.emitter.events();
    const claims = events.filter((event) => event.t === "run.claimed");
    assert.deepEqual(claims.map((event) => event.runId), [RUN_ID, UUID_5]);
    const worker = events.filter((event) => "workerId" in event && event.workerId === EXECUTOR_WORKER_ID
      && (event.t === "span.started" || event.t === "span.ended")
      && "kind" in event && event.kind === "worker");
    assert.equal(worker.length, 2);
    assert.equal(worker[0]?.t, "span.started");
    assert.equal(worker.at(-1)?.t, "span.ended");
    const browserStarts = events.filter((event) => "kind" in event && event.kind === "browser"
      && event.t === "span.started");
    assert.equal(browserStarts.length, 2);
  });

  it("renews exactly its one active claim while a long task runs", async () => {
    let releaseDriver: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      releaseDriver = resolve;
    });
    let started: (() => void) | undefined;
    const driverStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const sessions = sessionFactoryHarness({
      ucpath: () => {
        const driver = healthyUcpathDriver();
        return {
          ...driver,
          searchPersonOrg: async (...args: Parameters<typeof driver.searchPersonOrg>) => {
            started?.();
            await gate;
            return driver.searchPersonOrg(...args);
          },
        };
      },
      crm: () => healthyCrmDriver(),
    });
    const harness = loopHarness({ sessions, heartbeatIntervalMs: 500 });
    const { database, clock } = harness.authority;
    database.authority.runs.enqueue(personLookupQueuedRun());

    const looping = runWorkerLoop(harness.deps);
    await driverStarted;

    const before = database.authority.runs.get(RUN_ID);
    assert.ok(before && before.lifecycle.state === "running");
    const heartbeatBefore = "heartbeatAt" in before.lifecycle ? before.lifecycle.heartbeatAt : undefined;
    clock.advanceWall(5_000);
    const heartbeat = harness.scheduler.pending()
      .find((entry) => entry.deadlineMonotonicMs === clock.monotonicMs() + 500);
    assert.ok(heartbeat, "the heartbeat tick must be scheduled while the run executes");
    heartbeat.fire();
    const after = database.authority.runs.get(RUN_ID);
    assert.ok(after && "heartbeatAt" in after.lifecycle);
    assert.notEqual(after.lifecycle.heartbeatAt, heartbeatBefore);
    assert.equal(after.claimGeneration, 1);

    releaseDriver?.();
    const report = await looping;
    assert.deepEqual(report.outcomes.map(({ state }) => state), ["done"]);
  });

  it("aborts the run when the heartbeat reports a lost claim, without terminalizing over it", async () => {
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
    const harness = loopHarness({ sessions });
    const { database, clock } = harness.authority;
    database.authority.runs.enqueue(personLookupQueuedRun());

    const looping = runWorkerLoop(harness.deps);
    await driverStarted;

    // The operator cancels the running tree: the run goes terminal without
    // the worker's claim (exactly what the kernel's cancel arm does).
    const current = database.authority.runs.get(RUN_ID);
    assert.ok(current);
    const cancelled = database.authority.runs.transition({
      runId: RUN_ID,
      expectedVersion: current.version,
      lifecycle: { state: "terminal", outcome: "cancelled", endedAt: clock.now().toISOString() },
      now: clock.now().toISOString(),
    });
    assert.equal(cancelled.state, "applied");

    const heartbeat = harness.scheduler.pending()
      .find((entry) => entry.deadlineMonotonicMs === clock.monotonicMs() + 500);
    assert.ok(heartbeat);
    heartbeat.fire();

    const report = await looping;
    assert.equal(report.outcomes[0]?.state, "abandoned");
    await new Promise((resolve) => setImmediate(resolve));
    // The interrupted lease was poison-closed; the cancelled outcome stands.
    assert.ok(harness.sessions.closeReasons().includes("poisoned"));
    const run = database.authority.runs.get(RUN_ID);
    assert.ok(run && run.lifecycle.state === "terminal");
    assert.equal(run.lifecycle.outcome, "cancelled");
  });
});

describe("durable worker directives (ref dashboard-surfaces §2.4), observed between items", () => {
  it("stops without claiming when the directive says stop", async () => {
    const harness = loopHarness();
    harness.authority.database.authority.runs.enqueue(personLookupQueuedRun());
    const polls: string[] = [];

    const report = await runWorkerLoop({
      ...harness.deps,
      controlPoll: () => {
        polls.push("stop");
        return "stop";
      },
    });

    assert.equal(report.stopped, "stop-directive");
    assert.deepEqual(report.outcomes, []);
    assert.deepEqual(polls, ["stop"]);
    // The queued row was never claimed: a stop directive is not a claim gate
    // the loop can race past.
    assert.equal(harness.authority.database.authority.runs.get(RUN_ID)?.lifecycle.state, "queued");
    assert.equal(harness.sessions.opens(), 0);
  });

  it("claims nothing while paused and re-polls on the bounded idle cadence", async () => {
    // exitWhenIdle=false so the pause branch is the ONLY reason it loops.
    const harness = loopHarness({ exitWhenIdle: false });
    harness.authority.database.authority.runs.enqueue(personLookupQueuedRun());
    let polls = 0;

    const looping = runWorkerLoop({
      ...harness.deps,
      controlPoll: () => {
        polls += 1;
        // The bounded idle wait resolves on abort, which ends the loop.
        if (polls === 1) queueMicrotask(() => harness.stop.abort(new Error("operator stop")));
        return "pause";
      },
    });
    const report = await looping;

    assert.equal(report.stopped, "stop-signal");
    assert.deepEqual(report.outcomes, []);
    assert.equal(harness.authority.database.authority.runs.get(RUN_ID)?.lifecycle.state, "queued");
    assert.equal(harness.sessions.opens(), 0);
  });

  it("refuses to run when the directive cannot be read", async () => {
    const harness = loopHarness();
    harness.authority.database.authority.runs.enqueue(personLookupQueuedRun());
    await assert.rejects(
      runWorkerLoop({
        ...harness.deps,
        controlPoll: () => {
          throw new Error("worker lease disappeared");
        },
      }),
      /worker lease disappeared/,
    );
    assert.equal(harness.authority.database.authority.runs.get(RUN_ID)?.lifecycle.state, "queued");
  });

  it("refuses two competing write-sequencer seams", async () => {
    const harness = loopHarness();
    const sequencer = {
      executeTransaction: () => Promise.resolve(undefined),
      executeDryRun: () => Promise.resolve(undefined),
    };
    await assert.rejects(
      runWorkerLoop({ ...harness.deps, writeSequencer: sequencer, writeSequencerFor: () => sequencer }),
      /exactly one seam may own the sequencer/,
    );
  });
});

function workerBrowserCommand(request: unknown) {
  const parsed = CommandRequestSchema.parse(request);
  if (parsed.family !== "worker-browser") throw new Error("fixture must be a worker-browser command");
  return parsed;
}

describe("pool worker identity", () => {
  it("mints stable identities from the workflow and pool index", () => {
    const workflowId = WorkflowIdSchema.parse(WORKFLOW_ID);

    assert.deepEqual(
      [1, 2].map((poolIndex) => poolWorkerId(workflowId, PositiveIntSchema.parse(poolIndex))),
      ["person-lookup-worker-1", "person-lookup-worker-2"],
    );
  });
});

describe("pool-capable worker runtime executor seam", () => {
  const requestedAt = NOW;
  const envelope = {
    commandId: UUID_7,
    requestedBy: "local-operator",
    requestedAt,
    source: "dashboard",
  };

  it("plans three deterministic members only after the supervisor acknowledges their lifecycle facts", () => {
    const requests: unknown[] = [];
    const executor = createWorkerPoolRuntimeExecutor({
      execute: (request) => {
        requests.push(request);
        return {
          command: "plan-worker-count",
          state: "acknowledged",
          desiredWorkers: 3,
          members: [
            {
              member: {
                workflowId: WORKFLOW_ID,
                poolIndex: 1,
                workerId: "person-lookup-worker-1",
              },
              stage: "running",
              ownership: "supervised",
            },
            {
              member: {
                workflowId: WORKFLOW_ID,
                poolIndex: 2,
                workerId: "person-lookup-worker-2",
              },
              stage: "running",
              ownership: "external",
            },
            {
              member: {
                workflowId: WORKFLOW_ID,
                poolIndex: 3,
                workerId: "person-lookup-worker-3",
              },
              stage: "unmet",
              reason: "crashed",
            },
          ],
        };
      },
    });
    const plan = workerBrowserCommand({
      ...envelope,
      family: "worker-browser",
      type: "plan-worker-count",
      target: { workflowId: WORKFLOW_ID, expectedVersion: 1 },
      payload: { desiredWorkers: 3 },
    });

    assert.deepEqual(executor.planWorkerCount({ command: plan, now: requestedAt }), {
      state: "accepted",
      workerIds: [
        "person-lookup-worker-1",
        "person-lookup-worker-2",
        "person-lookup-worker-3",
      ],
    });
    assert.deepEqual(requests, [{
      command: "plan-worker-count",
      workflowId: WORKFLOW_ID,
      desiredWorkers: 3,
      members: [
        { workflowId: WORKFLOW_ID, poolIndex: 1, workerId: "person-lookup-worker-1" },
        { workflowId: WORKFLOW_ID, poolIndex: 2, workerId: "person-lookup-worker-2" },
        { workflowId: WORKFLOW_ID, poolIndex: 3, workerId: "person-lookup-worker-3" },
      ],
    }]);
  });

  it("spawns only the explicit pool member acknowledged as started", () => {
    const requests: unknown[] = [];
    const executor = createWorkerPoolRuntimeExecutor({
      execute: (request) => {
        requests.push(request);
        return {
          command: "spawn-worker",
          state: "acknowledged",
          member: {
            workflowId: WORKFLOW_ID,
            poolIndex: 2,
            workerId: "person-lookup-worker-2",
          },
          stage: "started",
        };
      },
    });
    const spawn = workerBrowserCommand({
      ...envelope,
      family: "worker-browser",
      type: "spawn-worker",
      target: { workflowId: WORKFLOW_ID, expectedVersion: 1 },
      payload: { workerId: "person-lookup-worker-2" },
    });

    assert.deepEqual(executor.spawnWorker({ command: spawn, now: requestedAt }), { state: "accepted" });
    assert.deepEqual(requests, [{
      command: "spawn-worker",
      member: {
        workflowId: WORKFLOW_ID,
        poolIndex: 2,
        workerId: "person-lookup-worker-2",
      },
    }]);
  });

  it("requests a bounded graceful stop for the explicit member", () => {
    const requests: unknown[] = [];
    const executor = createWorkerPoolRuntimeExecutor({
      execute: (request) => {
        requests.push(request);
        return {
          command: "stop-worker",
          state: "acknowledged",
          member: {
            workflowId: WORKFLOW_ID,
            poolIndex: 2,
            workerId: "person-lookup-worker-2",
          },
          stage: "graceful-stop-requested",
          escalation: [
            { stage: "graceful-stop-requested", timeoutMs: 120_000 },
            { stage: "sigterm-sent", timeoutMs: 30_000 },
            { stage: "sigkill-sent" },
          ],
        };
      },
    });
    const stop = workerBrowserCommand({
      ...envelope,
      family: "worker-browser",
      type: "stop-worker",
      target: { workerId: "person-lookup-worker-2", expectedVersion: 1 },
    });

    assert.deepEqual(executor.stopWorker({ command: stop, now: requestedAt }), { state: "accepted" });
    assert.deepEqual(requests, [{
      command: "stop-worker",
      member: {
        workflowId: WORKFLOW_ID,
        poolIndex: 2,
        workerId: "person-lookup-worker-2",
      },
      escalation: [
        { stage: "graceful-stop-requested", timeoutMs: 120_000 },
        { stage: "sigterm-sent", timeoutMs: 30_000 },
        { stage: "sigkill-sent" },
      ],
    }]);
  });
});

describe("phase-1 worker runtime executor seam", () => {
  const requestedAt = NOW;
  const envelope = {
    commandId: UUID_7,
    requestedBy: "local-operator",
    requestedAt,
    source: "dashboard",
  };

  it("acknowledges a single-worker plan and refuses any other count", () => {
    const executor = createPhase1WorkerRuntimeExecutor({ spawnWorker: () => undefined });
    const plan = workerBrowserCommand({
      ...envelope,
      family: "worker-browser",
      type: "plan-worker-count",
      target: { workflowId: WORKFLOW_ID, expectedVersion: 1 },
      payload: { desiredWorkers: 1 },
    });
    const acknowledged = executor.planWorkerCount({ command: plan, now: requestedAt });
    assert.deepEqual(acknowledged, {
      state: "accepted",
      workerIds: [phase1WorkerId(WorkflowIdSchema.parse(WORKFLOW_ID))],
    });

    const twoWorkers = workerBrowserCommand({
      ...envelope,
      family: "worker-browser",
      type: "plan-worker-count",
      target: { workflowId: WORKFLOW_ID, expectedVersion: 1 },
      payload: { desiredWorkers: 2 },
    });
    assert.throws(
      () => executor.planWorkerCount({ command: twoWorkers, now: requestedAt }),
      /exactly one worker per workflow/,
    );
  });

  it("spawns through the injected supervisor and fails loud on unwired browser arms", () => {
    const spawned: string[] = [];
    const executor = createPhase1WorkerRuntimeExecutor({
      spawnWorker: (input) => {
        spawned.push(`${input.workflowId}:${input.workerId}`);
      },
    });
    const spawn = workerBrowserCommand({
      ...envelope,
      family: "worker-browser",
      type: "spawn-worker",
      target: { workflowId: WORKFLOW_ID, expectedVersion: 1 },
      payload: { workerId: EXECUTOR_WORKER_ID },
    });
    assert.deepEqual(executor.spawnWorker({ command: spawn, now: requestedAt }), { state: "accepted" });
    assert.deepEqual(spawned, [`${WORKFLOW_ID}:${EXECUTOR_WORKER_ID}`]);

    const refresh = workerBrowserCommand({
      ...envelope,
      family: "worker-browser",
      type: "refresh-browser",
      target: { workerId: EXECUTOR_WORKER_ID, browserSessionId: ITEM_ID, expectedVersion: 1 },
    });
    assert.throws(
      () => executor.refreshBrowser({ command: refresh, now: requestedAt }),
      /refusing to acknowledge an effect that did not happen/,
    );
  });
});
