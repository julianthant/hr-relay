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

function poolMemberFixture(poolIndex: number, workflowId = WORKFLOW_ID) {
  return {
    workflowId,
    poolIndex,
    workerId: `${workflowId}-worker-${String(poolIndex)}`,
  };
}

const OBSERVED_GRACEFUL = [{ stage: "graceful-stop-requested", at: NOW }] as const;

const STOP_ESCALATION = [
  { stage: "graceful-stop-requested", timeoutMs: 120_000 },
  { stage: "sigterm-sent", timeoutMs: 30_000 },
  { stage: "sigkill-sent" },
] as const;

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

  it("plans three deterministic members only after the supervisor acknowledges their lifecycle facts", async () => {
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
              ownership: "supervised",
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

    assert.deepEqual(await executor.planWorkerCount({ command: plan, now: requestedAt }), {
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
      excessMembers: [],
    }]);
  });

  it("acknowledges scale-down by selecting higher member indices for bounded stop", async () => {
    const executor = createWorkerPoolRuntimeExecutor({
      execute: () => ({
        command: "plan-worker-count",
        state: "acknowledged",
        desiredWorkers: 1,
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
            stage: "graceful-stop-requested",
            ownership: "supervised",
            escalation: [
              { stage: "graceful-stop-requested", timeoutMs: 120_000 },
              { stage: "sigterm-sent", timeoutMs: 30_000 },
              { stage: "sigkill-sent" },
            ],
            observed: [{ stage: "graceful-stop-requested", at: NOW }],
          },
          {
            member: {
              workflowId: WORKFLOW_ID,
              poolIndex: 3,
              workerId: "person-lookup-worker-3",
            },
            stage: "graceful-stop-requested",
            ownership: "supervised",
            escalation: [
              { stage: "graceful-stop-requested", timeoutMs: 120_000 },
              { stage: "sigterm-sent", timeoutMs: 30_000 },
              { stage: "sigkill-sent" },
            ],
            observed: [{ stage: "graceful-stop-requested", at: NOW }],
          },
        ],
      }),
    });
    const plan = workerBrowserCommand({
      ...envelope,
      family: "worker-browser",
      type: "plan-worker-count",
      target: { workflowId: WORKFLOW_ID, expectedVersion: 1 },
      payload: { desiredWorkers: 1 },
    });

    assert.deepEqual(await executor.planWorkerCount({ command: plan, now: requestedAt }), {
      state: "accepted",
      workerIds: ["person-lookup-worker-1"],
    });
  });

  it("spawns only the explicit pool member acknowledged as started", async () => {
    const requests: unknown[] = [];
    const executor = createWorkerPoolRuntimeExecutor({
      execute: (request) => {
        requests.push(request);
        return {
          command: "spawn-worker",
          state: "acknowledged",
          ownership: "supervised",
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

    assert.deepEqual(await executor.spawnWorker({ command: spawn, now: requestedAt }), { state: "accepted" });
    assert.deepEqual(requests, [{
      command: "spawn-worker",
      member: {
        workflowId: WORKFLOW_ID,
        poolIndex: 2,
        workerId: "person-lookup-worker-2",
      },
    }]);
  });

  it("requests a bounded graceful stop for the explicit member", async () => {
    const requests: unknown[] = [];
    const executor = createWorkerPoolRuntimeExecutor({
      execute: (request) => {
        requests.push(request);
        return {
          command: "stop-worker",
          state: "acknowledged",
          ownership: "supervised",
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
          observed: [{ stage: "graceful-stop-requested", at: NOW }],
        };
      },
    });
    const stop = workerBrowserCommand({
      ...envelope,
      family: "worker-browser",
      type: "stop-worker",
      target: { workerId: "person-lookup-worker-2", expectedVersion: 1 },
    });

    assert.deepEqual(await executor.stopWorker({ command: stop, now: requestedAt }), { state: "accepted" });
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

  it("acknowledges pause only at the explicit member's requested stage", async () => {
    const requests: unknown[] = [];
    const executor = createWorkerPoolRuntimeExecutor({
      execute: (request) => {
        requests.push(request);
        return {
          command: "pause-worker",
          state: "acknowledged",
          ownership: "supervised",
          member: {
            workflowId: WORKFLOW_ID,
            poolIndex: 1,
            workerId: "person-lookup-worker-1",
          },
          stage: "pause-requested",
        };
      },
    });
    const pause = workerBrowserCommand({
      ...envelope,
      family: "worker-browser",
      type: "pause-worker",
      target: { workerId: "person-lookup-worker-1", expectedVersion: 1 },
    });

    assert.deepEqual(await executor.pauseWorker({ command: pause, now: requestedAt }), { state: "accepted" });
    assert.deepEqual(requests, [{
      command: "pause-worker",
      member: {
        workflowId: WORKFLOW_ID,
        poolIndex: 1,
        workerId: "person-lookup-worker-1",
      },
    }]);
  });

  it("acknowledges resume only at the explicit member's requested stage", async () => {
    const requests: unknown[] = [];
    const executor = createWorkerPoolRuntimeExecutor({
      execute: (request) => {
        requests.push(request);
        return {
          command: "resume-worker",
          state: "acknowledged",
          ownership: "supervised",
          member: {
            workflowId: WORKFLOW_ID,
            poolIndex: 3,
            workerId: "person-lookup-worker-3",
          },
          stage: "resume-requested",
        };
      },
    });
    const resume = workerBrowserCommand({
      ...envelope,
      family: "worker-browser",
      type: "resume-worker",
      target: { workerId: "person-lookup-worker-3", expectedVersion: 1 },
    });

    assert.deepEqual(await executor.resumeWorker({ command: resume, now: requestedAt }), { state: "accepted" });
    assert.deepEqual(requests, [{
      command: "resume-worker",
      member: {
        workflowId: WORKFLOW_ID,
        poolIndex: 3,
        workerId: "person-lookup-worker-3",
      },
    }]);
  });

  it("acknowledges refresh only after the explicit member session is refreshed", async () => {
    const requests: unknown[] = [];
    const executor = createWorkerPoolRuntimeExecutor({
      execute: (request) => {
        requests.push(request);
        return {
          command: "refresh-browser",
          state: "acknowledged",
          ownership: "supervised",
          member: {
            workflowId: WORKFLOW_ID,
            poolIndex: 2,
            workerId: "person-lookup-worker-2",
          },
          browserSessionId: ITEM_ID,
          stage: "refreshed",
        };
      },
    });
    const refresh = workerBrowserCommand({
      ...envelope,
      family: "worker-browser",
      type: "refresh-browser",
      target: { workerId: "person-lookup-worker-2", browserSessionId: ITEM_ID, expectedVersion: 1 },
    });

    assert.deepEqual(await executor.refreshBrowser({ command: refresh, now: requestedAt }), { state: "accepted" });
    assert.deepEqual(requests, [{
      command: "refresh-browser",
      member: {
        workflowId: WORKFLOW_ID,
        poolIndex: 2,
        workerId: "person-lookup-worker-2",
      },
      browserSessionId: ITEM_ID,
    }]);
  });

  it("acknowledges reopen only after the explicit member session is reopened", async () => {
    const requests: unknown[] = [];
    const executor = createWorkerPoolRuntimeExecutor({
      execute: (request) => {
        requests.push(request);
        return {
          command: "reopen-browser",
          state: "acknowledged",
          ownership: "supervised",
          member: {
            workflowId: WORKFLOW_ID,
            poolIndex: 3,
            workerId: "person-lookup-worker-3",
          },
          browserSessionId: ITEM_ID,
          stage: "reopened",
        };
      },
    });
    const reopen = workerBrowserCommand({
      ...envelope,
      family: "worker-browser",
      type: "reopen-browser",
      target: { workerId: "person-lookup-worker-3", browserSessionId: ITEM_ID, expectedVersion: 1 },
    });

    assert.deepEqual(await executor.reopenBrowser({ command: reopen, now: requestedAt }), { state: "accepted" });
    assert.deepEqual(requests, [{
      command: "reopen-browser",
      member: {
        workflowId: WORKFLOW_ID,
        poolIndex: 3,
        workerId: "person-lookup-worker-3",
      },
      browserSessionId: ITEM_ID,
    }]);
  });

  it("acknowledges a stop with the timestamped observed graceful stage, policy carried separately", async () => {
    const requests: unknown[] = [];
    const executor = createWorkerPoolRuntimeExecutor({
      execute: (request) => {
        requests.push(request);
        return {
          command: "stop-worker",
          state: "acknowledged",
          member: poolMemberFixture(2),
          ownership: "supervised",
          escalation: STOP_ESCALATION,
          observed: [{ stage: "graceful-stop-requested", at: NOW }],
        };
      },
    });
    const stop = workerBrowserCommand({
      ...envelope,
      family: "worker-browser",
      type: "stop-worker",
      target: { workerId: "person-lookup-worker-2", expectedVersion: 1 },
    });

    assert.deepEqual(await executor.stopWorker({ command: stop, now: requestedAt }), { state: "accepted" });
    assert.deepEqual(requests, [{
      command: "stop-worker",
      member: poolMemberFixture(2),
      escalation: STOP_ESCALATION,
    }]);
  });

  it("refuses an initial stop acknowledgement claiming future escalation stages", async () => {
    const executor = createWorkerPoolRuntimeExecutor({
      execute: () => ({
        command: "stop-worker",
        state: "acknowledged",
        member: poolMemberFixture(2),
        ownership: "supervised",
        escalation: STOP_ESCALATION,
        observed: [
          { stage: "graceful-stop-requested", at: NOW },
          { stage: "sigterm-sent", at: NOW },
        ],
      }),
    });
    const stop = workerBrowserCommand({
      ...envelope,
      family: "worker-browser",
      type: "stop-worker",
      target: { workerId: "person-lookup-worker-2", expectedVersion: 1 },
    });

    await assert.rejects(
      () => executor.stopWorker({ command: stop, now: requestedAt }),
      /may acknowledge only the observed graceful-stop-requested stage.*recorded as they occur/,
    );
  });

  it("refuses a stop observation that short-circuits past the graceful stage", async () => {
    const executor = createWorkerPoolRuntimeExecutor({
      execute: () => ({
        command: "stop-worker",
        state: "acknowledged",
        member: poolMemberFixture(2),
        ownership: "supervised",
        escalation: STOP_ESCALATION,
        observed: [{ stage: "sigkill-sent", at: NOW }],
      }),
    });
    const stop = workerBrowserCommand({
      ...envelope,
      family: "worker-browser",
      type: "stop-worker",
      target: { workerId: "person-lookup-worker-2", expectedVersion: 1 },
    });

    await assert.rejects(
      () => executor.stopWorker({ command: stop, now: requestedAt }),
      /must follow the escalation policy in order/,
    );
  });

  it("refuses an illegal escalation transition in a reconciliation fact", async () => {
    const executor = createWorkerPoolRuntimeExecutor({
      execute: () => ({
        command: "plan-worker-count",
        state: "acknowledged",
        desiredWorkers: 1,
        members: [
          { member: poolMemberFixture(1), stage: "running", ownership: "supervised" },
          {
            member: poolMemberFixture(2),
            stage: "graceful-stop-requested",
            ownership: "supervised",
            escalation: STOP_ESCALATION,
            observed: [
              { stage: "graceful-stop-requested", at: NOW },
              // sigterm-sent skipped: graceful cannot jump straight to SIGKILL.
              { stage: "sigkill-sent", at: NOW },
            ],
          },
          {
            member: poolMemberFixture(3),
            stage: "graceful-stop-requested",
            ownership: "supervised",
            escalation: STOP_ESCALATION,
            observed: [{ stage: "graceful-stop-requested", at: NOW }],
          },
        ],
      }),
    });
    const plan = workerBrowserCommand({
      ...envelope,
      family: "worker-browser",
      type: "plan-worker-count",
      target: { workflowId: WORKFLOW_ID, expectedVersion: 1 },
      payload: { desiredWorkers: 1 },
    });

    await assert.rejects(
      () => executor.planWorkerCount({ command: plan, now: requestedAt }),
      /must follow the escalation policy in order/,
    );
  });

  it("refuses observed escalation stages with regressing timestamps", async () => {
    const executor = createWorkerPoolRuntimeExecutor({
      execute: () => ({
        command: "plan-worker-count",
        state: "acknowledged",
        desiredWorkers: 1,
        members: [
          { member: poolMemberFixture(1), stage: "running", ownership: "supervised" },
          {
            member: poolMemberFixture(2),
            stage: "graceful-stop-requested",
            ownership: "supervised",
            escalation: STOP_ESCALATION,
            observed: [
              { stage: "graceful-stop-requested", at: "2026-07-31T17:05:00.000Z" },
              { stage: "sigterm-sent", at: NOW },
            ],
          },
          {
            member: poolMemberFixture(3),
            stage: "graceful-stop-requested",
            ownership: "supervised",
            escalation: STOP_ESCALATION,
            observed: [{ stage: "graceful-stop-requested", at: NOW }],
          },
        ],
      }),
    });
    const plan = workerBrowserCommand({
      ...envelope,
      family: "worker-browser",
      type: "plan-worker-count",
      target: { workflowId: WORKFLOW_ID, expectedVersion: 1 },
      payload: { desiredWorkers: 1 },
    });

    await assert.rejects(
      () => executor.planWorkerCount({ command: plan, now: requestedAt }),
      /non-decreasing timestamps/,
    );
  });

  it("records later escalation stages in reconciliation facts as they occurred", async () => {
    const executor = createWorkerPoolRuntimeExecutor({
      execute: () => ({
        command: "plan-worker-count",
        state: "acknowledged",
        desiredWorkers: 1,
        members: [
          { member: poolMemberFixture(1), stage: "running", ownership: "supervised" },
          {
            member: poolMemberFixture(2),
            stage: "graceful-stop-requested",
            ownership: "supervised",
            escalation: STOP_ESCALATION,
            observed: [
              { stage: "graceful-stop-requested", at: NOW },
              { stage: "sigterm-sent", at: "2026-07-31T17:02:00.000Z" },
            ],
          },
          {
            member: poolMemberFixture(3),
            stage: "graceful-stop-requested",
            ownership: "supervised",
            escalation: STOP_ESCALATION,
            observed: [{ stage: "graceful-stop-requested", at: NOW }],
          },
        ],
      }),
    });
    const plan = workerBrowserCommand({
      ...envelope,
      family: "worker-browser",
      type: "plan-worker-count",
      target: { workflowId: WORKFLOW_ID, expectedVersion: 1 },
      payload: { desiredWorkers: 1 },
    });

    assert.deepEqual(await executor.planWorkerCount({ command: plan, now: requestedAt }), {
      state: "accepted",
      workerIds: ["person-lookup-worker-1"],
    });
  });

  it("refuses a plan acknowledgement reporting a running member under external ownership", async () => {
    const executor = createWorkerPoolRuntimeExecutor({
      execute: () => ({
        command: "plan-worker-count",
        state: "acknowledged",
        desiredWorkers: 2,
        members: [
          { member: poolMemberFixture(1), stage: "running", ownership: "supervised" },
          { member: poolMemberFixture(2), stage: "running", ownership: "external" },
          { member: poolMemberFixture(3), stage: "graceful-stop-requested", ownership: "supervised", escalation: STOP_ESCALATION, observed: OBSERVED_GRACEFUL },
        ],
      }),
    });
    const plan = workerBrowserCommand({
      ...envelope,
      family: "worker-browser",
      type: "plan-worker-count",
      target: { workflowId: WORKFLOW_ID, expectedVersion: 1 },
      payload: { desiredWorkers: 2 },
    });

    await assert.rejects(
      () => executor.planWorkerCount({ command: plan, now: requestedAt }),
      /plan-worker-count touches externally owned member person-lookup-worker-2/,
    );
  });

  it("refuses a stop acknowledgement for an externally owned member", async () => {
    const executor = createWorkerPoolRuntimeExecutor({
      execute: () => ({
        command: "stop-worker",
        state: "acknowledged",
        member: poolMemberFixture(2),
        ownership: "external",
        escalation: STOP_ESCALATION,
        observed: OBSERVED_GRACEFUL,
      }),
    });
    const stop = workerBrowserCommand({
      ...envelope,
      family: "worker-browser",
      type: "stop-worker",
      target: { workerId: "person-lookup-worker-2", expectedVersion: 1 },
    });

    await assert.rejects(
      () => executor.stopWorker({ command: stop, now: requestedAt }),
      /stop-worker touches externally owned member person-lookup-worker-2/,
    );
  });

  it("refuses a spawn acknowledgement for a member an external process already owns", async () => {
    const executor = createWorkerPoolRuntimeExecutor({
      execute: () => ({
        command: "spawn-worker",
        state: "acknowledged",
        member: poolMemberFixture(2),
        ownership: "external",
        stage: "started",
      }),
    });
    const spawn = workerBrowserCommand({
      ...envelope,
      family: "worker-browser",
      type: "spawn-worker",
      target: { workflowId: WORKFLOW_ID, expectedVersion: 1 },
      payload: { workerId: "person-lookup-worker-2" },
    });

    await assert.rejects(
      () => executor.spawnWorker({ command: spawn, now: requestedAt }),
      /spawn-worker touches externally owned member person-lookup-worker-2/,
    );
  });

  it("names the authoritative excess members in a scale-down plan request", async () => {
    const requests: unknown[] = [];
    const executor = createWorkerPoolRuntimeExecutor({
      execute: (request) => {
        requests.push(request);
        return {
          command: "plan-worker-count",
          state: "acknowledged",
          desiredWorkers: 1,
          members: [
            { member: poolMemberFixture(1), stage: "running", ownership: "supervised" },
            { member: poolMemberFixture(2), stage: "graceful-stop-requested", ownership: "supervised", escalation: STOP_ESCALATION, observed: OBSERVED_GRACEFUL },
            { member: poolMemberFixture(3), stage: "graceful-stop-requested", ownership: "supervised", escalation: STOP_ESCALATION, observed: OBSERVED_GRACEFUL },
          ],
        };
      },
    });
    const plan = workerBrowserCommand({
      ...envelope,
      family: "worker-browser",
      type: "plan-worker-count",
      target: { workflowId: WORKFLOW_ID, expectedVersion: 1 },
      payload: { desiredWorkers: 1 },
    });

    assert.deepEqual(await executor.planWorkerCount({ command: plan, now: requestedAt }), {
      state: "accepted",
      workerIds: ["person-lookup-worker-1"],
    });
    assert.deepEqual(requests, [{
      command: "plan-worker-count",
      workflowId: WORKFLOW_ID,
      desiredWorkers: 1,
      members: [poolMemberFixture(1)],
      excessMembers: [poolMemberFixture(2), poolMemberFixture(3)],
    }]);
  });

  it("accepts a scale-down acknowledgement reporting an honest unmet excess member", async () => {
    // D271: a crashed member's declaration stays visibly unmet. An excess
    // member that crashed or never started has no process to stop — the honest
    // `unmet` fact satisfies stop coverage instead of coercing a fabricated
    // graceful-stop observation.
    const executor = createWorkerPoolRuntimeExecutor({
      execute: () => ({
        command: "plan-worker-count",
        state: "acknowledged",
        desiredWorkers: 1,
        members: [
          { member: poolMemberFixture(1), stage: "running", ownership: "supervised" },
          { member: poolMemberFixture(2), stage: "unmet", reason: "crashed" },
          { member: poolMemberFixture(3), stage: "graceful-stop-requested", ownership: "supervised", escalation: STOP_ESCALATION, observed: OBSERVED_GRACEFUL },
        ],
      }),
    });
    const plan = workerBrowserCommand({
      ...envelope,
      family: "worker-browser",
      type: "plan-worker-count",
      target: { workflowId: WORKFLOW_ID, expectedVersion: 1 },
      payload: { desiredWorkers: 1 },
    });

    assert.deepEqual(await executor.planWorkerCount({ command: plan, now: requestedAt }), {
      state: "accepted",
      workerIds: ["person-lookup-worker-1"],
    });
  });

  it("refuses a scale-down acknowledgement that omits an authoritative excess member", async () => {
    const executor = createWorkerPoolRuntimeExecutor({
      execute: () => ({
        command: "plan-worker-count",
        state: "acknowledged",
        desiredWorkers: 1,
        members: [
          { member: poolMemberFixture(1), stage: "running", ownership: "supervised" },
          { member: poolMemberFixture(2), stage: "graceful-stop-requested", ownership: "supervised", escalation: STOP_ESCALATION, observed: OBSERVED_GRACEFUL },
          // person-lookup-worker-3 silently omitted: its stop is never covered.
        ],
      }),
    });
    const plan = workerBrowserCommand({
      ...envelope,
      family: "worker-browser",
      type: "plan-worker-count",
      target: { workflowId: WORKFLOW_ID, expectedVersion: 1 },
      payload: { desiredWorkers: 1 },
    });

    await assert.rejects(
      () => executor.planWorkerCount({ command: plan, now: requestedAt }),
      /requires a bounded graceful stop acknowledgement for excess member person-lookup-worker-3 at index 3/,
    );
  });

  it("refuses a supervisor that mutates the spawn request member after submission", async () => {
    const executor = createWorkerPoolRuntimeExecutor({
      execute: (request) => {
        // An adversarial supervisor rewrites the submitted member in place and
        // acknowledges the rewritten member, hoping the executor compares the
        // acknowledgement against its own mutation instead of the original.
        const mutable = request as unknown as { member: { poolIndex: number; workerId: string } };
        mutable.member.poolIndex = 2;
        mutable.member.workerId = "person-lookup-worker-2";
        return {
          command: "spawn-worker",
          state: "acknowledged",
          ownership: "supervised",
          member: poolMemberFixture(2),
          stage: "started",
        };
      },
    });
    const spawn = workerBrowserCommand({
      ...envelope,
      family: "worker-browser",
      type: "spawn-worker",
      target: { workflowId: WORKFLOW_ID, expectedVersion: 1 },
      payload: { workerId: "person-lookup-worker-1" },
    });

    await assert.rejects(() => executor.spawnWorker({ command: spawn, now: requestedAt }));
  });

  it("refuses a supervisor that mutates the plan request roster after submission", async () => {
    const executor = createWorkerPoolRuntimeExecutor({
      execute: (request) => {
        // Rewriting a submitted roster entry must never leak into the accepted
        // plan's workerIds — the acknowledged ids are the ORIGINAL scalars.
        const mutable = request as unknown as { members: { workerId: string }[] };
        const second = mutable.members[1];
        if (second === undefined) throw new Error("fixture expected a three-member roster");
        second.workerId = "person-lookup-worker-hijacked";
        return {
          command: "plan-worker-count",
          state: "acknowledged",
          desiredWorkers: 3,
          members: [1, 2, 3].map((poolIndex) => ({
            member: poolMemberFixture(poolIndex),
            stage: "running",
            ownership: "supervised",
          })),
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

    await assert.rejects(() => executor.planWorkerCount({ command: plan, now: requestedAt }));
  });

  it("awaits an asynchronous supervisor effect before acknowledging a spawn", async () => {
    let effectProved = false;
    const executor = createWorkerPoolRuntimeExecutor({
      execute: async () => {
        await new Promise((resolve) => setImmediate(resolve));
        effectProved = true;
        return {
          command: "spawn-worker",
          state: "acknowledged",
          ownership: "supervised",
          member: poolMemberFixture(2),
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

    const acknowledged = await executor.spawnWorker({ command: spawn, now: requestedAt });
    assert.equal(effectProved, true, "the acknowledgement settled before the supervisor proved the effect");
    assert.deepEqual(acknowledged, { state: "accepted" });
  });

  it("never settles the acknowledgement before the supervisor's effect settles", async () => {
    let release: (() => void) | undefined;
    const effect = new Promise<void>((resolve) => {
      release = resolve;
    });
    const executor = createWorkerPoolRuntimeExecutor({
      execute: () => effect.then(() => ({
        command: "spawn-worker",
        state: "acknowledged",
        ownership: "supervised",
        member: poolMemberFixture(2),
        stage: "started",
      })),
    });
    const spawn = workerBrowserCommand({
      ...envelope,
      family: "worker-browser",
      type: "spawn-worker",
      target: { workflowId: WORKFLOW_ID, expectedVersion: 1 },
      payload: { workerId: "person-lookup-worker-2" },
    });

    let settled = false;
    const acknowledging = (async () => executor.spawnWorker({ command: spawn, now: requestedAt }))();
    const watched = acknowledging.then(
      (value) => {
        settled = true;
        return value;
      },
      (error: unknown) => {
        settled = true;
        throw error;
      },
    );
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(settled, false, "the spawn was acknowledged while the process effect was still pending");
    release?.();
    assert.deepEqual(await watched, { state: "accepted" });
  });

  it("propagates a failed asynchronous effect instead of fabricating success", async () => {
    const executor = createWorkerPoolRuntimeExecutor({
      execute: () => Promise.reject(new Error("spawn failed: EAGAIN forking person-lookup-worker-2")),
    });
    const spawn = workerBrowserCommand({
      ...envelope,
      family: "worker-browser",
      type: "spawn-worker",
      target: { workflowId: WORKFLOW_ID, expectedVersion: 1 },
      payload: { workerId: "person-lookup-worker-2" },
    });

    await assert.rejects(
      () => executor.spawnWorker({ command: spawn, now: requestedAt }),
      /EAGAIN forking person-lookup-worker-2/,
    );
  });

  it("refuses a plan above the proved three-member cap before calling the supervisor", async () => {
    let calls = 0;
    const executor = createWorkerPoolRuntimeExecutor({
      execute: () => {
        calls += 1;
        throw new Error("supervisor must not be called");
      },
    });
    const plan = workerBrowserCommand({
      ...envelope,
      family: "worker-browser",
      type: "plan-worker-count",
      target: { workflowId: WORKFLOW_ID, expectedVersion: 1 },
      payload: { desiredWorkers: 4 },
    });

    await assert.rejects(
      () => executor.planWorkerCount({ command: plan, now: requestedAt }),
      /worker pool size must not exceed 3/,
    );
    assert.equal(calls, 0);
  });

  it.each([
    { workerId: "person-lookup-worker", message: /explicit positive pool index/ },
    { workerId: "person-lookup-worker-4", message: /worker pool size must not exceed 3/ },
    { workerId: "onboarding-worker-1", message: /not a pool member of workflow person-lookup/ },
  ])("refuses noncanonical spawn identity $workerId before calling the supervisor", async ({ workerId, message }) => {
    let calls = 0;
    const executor = createWorkerPoolRuntimeExecutor({
      execute: () => {
        calls += 1;
        throw new Error("supervisor must not be called");
      },
    });
    const spawn = workerBrowserCommand({
      ...envelope,
      family: "worker-browser",
      type: "spawn-worker",
      target: { workflowId: WORKFLOW_ID, expectedVersion: 1 },
      payload: { workerId },
    });

    await assert.rejects(() => executor.spawnWorker({ command: spawn, now: requestedAt }), message);
    assert.equal(calls, 0);
  });

  it.each([
    {
      name: "different desired count",
      desiredWorkers: 2,
      acknowledgement: {
        command: "plan-worker-count",
        state: "acknowledged",
        desiredWorkers: 1,
        members: [{ member: poolMemberFixture(1), stage: "running", ownership: "supervised" }],
      },
      message: /requested 2 workers but the supervisor acknowledged 1/,
    },
    {
      name: "missing desired member",
      desiredWorkers: 2,
      acknowledgement: {
        command: "plan-worker-count",
        state: "acknowledged",
        desiredWorkers: 2,
        members: [{ member: poolMemberFixture(1), stage: "running", ownership: "supervised" }],
      },
      message: /requires acknowledgement for desired member person-lookup-worker-2 at index 2/,
    },
    {
      name: "out-of-order member",
      desiredWorkers: 2,
      acknowledgement: {
        command: "plan-worker-count",
        state: "acknowledged",
        desiredWorkers: 2,
        members: [
          { member: poolMemberFixture(2), stage: "running", ownership: "supervised" },
          { member: poolMemberFixture(1), stage: "running", ownership: "supervised" },
        ],
      },
      message: /requested member person-lookup-worker-1 at index 1.*acknowledged person-lookup-worker-2 at index 2/,
    },
    {
      name: "stop on a desired member",
      desiredWorkers: 2,
      acknowledgement: {
        command: "plan-worker-count",
        state: "acknowledged",
        desiredWorkers: 2,
        members: [
          { member: poolMemberFixture(1), stage: "graceful-stop-requested", ownership: "supervised", escalation: STOP_ESCALATION, observed: OBSERVED_GRACEFUL },
          { member: poolMemberFixture(2), stage: "running", ownership: "supervised" },
        ],
      },
      message: /cannot stop desired member person-lookup-worker-1 at index 1/,
    },
    {
      name: "running excess member without stop coverage",
      desiredWorkers: 1,
      acknowledgement: {
        command: "plan-worker-count",
        state: "acknowledged",
        desiredWorkers: 1,
        members: [
          { member: poolMemberFixture(1), stage: "running", ownership: "supervised" },
          { member: poolMemberFixture(2), stage: "running", ownership: "supervised" },
        ],
      },
      message: /must select running excess member person-lookup-worker-2 for bounded graceful stop/,
    },
  ])("refuses a plan acknowledgement with $name", async ({ desiredWorkers, acknowledgement, message }) => {
    const executor = createWorkerPoolRuntimeExecutor({ execute: () => acknowledgement });
    const plan = workerBrowserCommand({
      ...envelope,
      family: "worker-browser",
      type: "plan-worker-count",
      target: { workflowId: WORKFLOW_ID, expectedVersion: 1 },
      payload: { desiredWorkers },
    });

    await assert.rejects(() => executor.planWorkerCount({ command: plan, now: requestedAt }), message);
  });

  it.each([
    {
      type: "spawn-worker",
      command: {
        ...envelope,
        family: "worker-browser",
        type: "spawn-worker",
        target: { workflowId: WORKFLOW_ID, expectedVersion: 1 },
        payload: { workerId: "person-lookup-worker-1" },
      },
      acknowledgement: {
        command: "spawn-worker",
        state: "acknowledged",
        ownership: "supervised",
        member: poolMemberFixture(2),
        stage: "started",
      },
      message: /requested member person-lookup-worker-1 at index 1.*acknowledged person-lookup-worker-2 at index 2/,
    },
    {
      type: "stop-worker",
      command: {
        ...envelope,
        family: "worker-browser",
        type: "stop-worker",
        target: { workerId: "person-lookup-worker-1", expectedVersion: 1 },
      },
      acknowledgement: {
        command: "stop-worker",
        state: "acknowledged",
        ownership: "supervised",
        member: poolMemberFixture(2),
        escalation: STOP_ESCALATION,
        observed: OBSERVED_GRACEFUL,
      },
      message: /requested member person-lookup-worker-1 at index 1.*acknowledged person-lookup-worker-2 at index 2/,
    },
    {
      type: "pause-worker",
      command: {
        ...envelope,
        family: "worker-browser",
        type: "pause-worker",
        target: { workerId: "person-lookup-worker-1", expectedVersion: 1 },
      },
      acknowledgement: {
        command: "pause-worker",
        state: "acknowledged",
        ownership: "supervised",
        member: poolMemberFixture(2),
        stage: "pause-requested",
      },
      message: /requested member person-lookup-worker-1 at index 1.*acknowledged person-lookup-worker-2 at index 2/,
    },
    {
      type: "resume-worker",
      command: {
        ...envelope,
        family: "worker-browser",
        type: "resume-worker",
        target: { workerId: "person-lookup-worker-1", expectedVersion: 1 },
      },
      acknowledgement: {
        command: "resume-worker",
        state: "acknowledged",
        ownership: "supervised",
        member: poolMemberFixture(2),
        stage: "resume-requested",
      },
      message: /requested member person-lookup-worker-1 at index 1.*acknowledged person-lookup-worker-2 at index 2/,
    },
    {
      type: "refresh-browser",
      command: {
        ...envelope,
        family: "worker-browser",
        type: "refresh-browser",
        target: { workerId: "person-lookup-worker-1", browserSessionId: ITEM_ID, expectedVersion: 1 },
      },
      acknowledgement: {
        command: "refresh-browser",
        state: "acknowledged",
        ownership: "supervised",
        member: poolMemberFixture(1),
        browserSessionId: UUID_5,
        stage: "refreshed",
      },
      message: new RegExp(`requested session ${ITEM_ID}.*acknowledged ${UUID_5}`),
    },
    {
      type: "reopen-browser",
      command: {
        ...envelope,
        family: "worker-browser",
        type: "reopen-browser",
        target: { workerId: "person-lookup-worker-1", browserSessionId: ITEM_ID, expectedVersion: 1 },
      },
      acknowledgement: {
        command: "reopen-browser",
        state: "acknowledged",
        ownership: "supervised",
        member: poolMemberFixture(2),
        browserSessionId: ITEM_ID,
        stage: "reopened",
      },
      message: /requested member person-lookup-worker-1 at index 1.*acknowledged person-lookup-worker-2 at index 2/,
    },
  ])("refuses mismatched $type acknowledgement facts", async ({ type, command: request, acknowledgement, message }) => {
    const command = workerBrowserCommand(request);
    const context = { command, now: requestedAt };
    const executor = createWorkerPoolRuntimeExecutor({ execute: () => acknowledgement });

    switch (type) {
      case "spawn-worker":
        await assert.rejects(() => executor.spawnWorker(context), message);
        break;
      case "stop-worker":
        await assert.rejects(() => executor.stopWorker(context), message);
        break;
      case "pause-worker":
        await assert.rejects(() => executor.pauseWorker(context), message);
        break;
      case "resume-worker":
        await assert.rejects(() => executor.resumeWorker(context), message);
        break;
      case "refresh-browser":
        await assert.rejects(() => executor.refreshBrowser(context), message);
        break;
      case "reopen-browser":
        await assert.rejects(() => executor.reopenBrowser(context), message);
        break;
    }
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
        return {
          command: "spawn-worker",
          state: "acknowledged",
          ownership: "supervised",
          member: input,
          stage: "started",
        };
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

  it("refuses a pending phase-1 supervisor promise instead of acknowledging an unproved spawn", () => {
    const executor = createPhase1WorkerRuntimeExecutor({
      spawnWorker: (input) => Promise.resolve({
        command: "spawn-worker",
        state: "acknowledged",
        ownership: "supervised",
        member: input,
        stage: "started",
      }),
    });
    const spawn = workerBrowserCommand({
      ...envelope,
      family: "worker-browser",
      type: "spawn-worker",
      target: { workflowId: WORKFLOW_ID, expectedVersion: 1 },
      payload: { workerId: EXECUTOR_WORKER_ID },
    });

    assert.throws(
      () => executor.spawnWorker({ command: spawn, now: requestedAt }),
      /pending promise/,
    );
  });

  it("refuses a void supervisor result instead of accepting an unproved spawn", () => {
    const executor = createPhase1WorkerRuntimeExecutor({ spawnWorker: () => undefined });
    const spawn = workerBrowserCommand({
      ...envelope,
      family: "worker-browser",
      type: "spawn-worker",
      target: { workflowId: WORKFLOW_ID, expectedVersion: 1 },
      payload: { workerId: EXECUTOR_WORKER_ID },
    });

    assert.throws(
      () => executor.spawnWorker({ command: spawn, now: requestedAt }),
      /spawn-worker supervisor acknowledgement/,
    );
  });
});
