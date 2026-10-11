import { admitWorkerPoolRoster } from "../../../../../../src/backend/storage/sqlite/worker-slots.js";
import { workerPoolMember } from "../../../../../../src/models/run/worker-slot.js";
import { testWorkerPorts } from "../../../../../support/fixtures/run-lifecycle-fixtures.js";

import { fixtureDuoCeremonyGates } from "../../../../../support/helpers/duo-ceremony-fixtures.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setImmediate } from "node:timers";
import { afterEach, describe, it } from "vitest";
import {
  createWorkerPoolRuntimeExecutor,
  runWorkerLoop,
  type WorkerLoopDependencies,
} from "../../../../../../src/backend/runtime/workers/worker-loop.js";
import { CommandRequestSchema } from "../../../../../../src/rules/commands/commands.js";
import { WorkflowIdSchema } from "../../../../../../src/rules/identity/ids.js";
import { taskStoreRegistry } from "../../../../../../src/backend/app/registries/task-registry.js";
import { sequentialIdFactory, ITEM_ID, RUN_ID, WORKFLOW_ID } from "../../../../../support/fixtures/phase1f-run-fixtures.js";
import { UUID_5, UUID_7, NOW } from "../../../../../support/fixtures/phase1c-contract-fixtures.js";
import {
  EXECUTOR_WORKER_ID,
  happySessionHarness,
  healthyCrmDriver,
  healthyUcpathDriver,
  ManualScheduler,
  openAuthorityHarness,
  personLookupQueuedRun,
  recordingTimelineEmitter,
  recordingLogger,
  sessionFactoryHarness,
  type SessionFactoryHarness,
} from "../../../../../support/helpers/phase1f-executor-harness.js";
import { personLookupDescriptor } from "../../../../../support/helpers/registered-workflows.js";

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
  const emitter = recordingTimelineEmitter(authority.database, authority.clock);
  const stop = new AbortController();
  const deps: WorkerLoopDependencies = {
    ...testWorkerPorts(authority.database, authority.clock, { path: authority.path, descriptor: personLookupDescriptor, poolIndex: 1 }),
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

function admittedAdapterRoster(workflowId = WORKFLOW_ID) {
  const authority = openAuthorityHarness();
  disposers.push(authority.dispose);
  const command = workerBrowserCommand({ commandId: randomUUID(), requestedBy: "local-operator", requestedAt: NOW,
    source: "dashboard", family: "worker-browser", type: "plan-worker-count",
    target: { workflowId, expectedVersion: 0 }, payload: { desiredWorkers: 3 } });
  if (command.type !== "plan-worker-count") throw new Error("fixture roster command required");
  const roster = authority.database.withAuthorityTransaction(repositories => {
    repositories.commands.insert(command);
    return admitWorkerPoolRoster(repositories, command, NOW);
  });
  return { authority, roster, members: roster.selected.map(workerPoolMember) };
}

function admitAdapterPlan(native: ReturnType<typeof admittedAdapterRoster>, command: ReturnType<typeof workerBrowserCommand>) {
  if (command.type !== "plan-worker-count") throw new Error("fixture plan command required");
  return native.authority.database.withAuthorityTransaction(repositories => {
    repositories.commands.insert(command);
    return admitWorkerPoolRoster(repositories, command, NOW);
  });
}

const OBSERVED_GRACEFUL = [{ stage: "graceful-stop-requested", at: NOW }] as const;

const STOP_ESCALATION = [
  { stage: "graceful-stop-requested", timeoutMs: 120_000 },
  { stage: "sigterm-sent", timeoutMs: 30_000 },
  { stage: "sigkill-sent" },
] as const;



describe("pool-capable worker runtime executor seam", () => {
  const requestedAt = NOW;
  const envelope = {
    commandId: UUID_7,
    requestedBy: "local-operator",
    requestedAt,
    source: "dashboard",
  };

  

  it("plans three deterministic members only after the supervisor acknowledges their lifecycle facts", async () => {
    const authority = openAuthorityHarness();
    disposers.push(authority.dispose);
    const plan = workerBrowserCommand({
      ...envelope, family: "worker-browser", type: "plan-worker-count",
      target: { workflowId: WORKFLOW_ID, expectedVersion: 0 }, payload: { desiredWorkers: 3 },
    });
    if (plan.type !== "plan-worker-count") throw new Error("fixture plan command required");
    const roster = authority.database.withAuthorityTransaction(repositories => {
      repositories.commands.insert(plan);
      return admitWorkerPoolRoster(repositories, plan, requestedAt);
    });
    const members = roster.selected.map(workerPoolMember);
    assert.deepEqual(members.map(({ ordinal, membershipRevision }) => ({ ordinal, membershipRevision })),
      [{ ordinal: 1, membershipRevision: 1 }, { ordinal: 2, membershipRevision: 1 }, { ordinal: 3, membershipRevision: 1 }]);
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
              member: members[0],
              stage: "running",
              ownership: "supervised",
            },
            {
              member: members[1],
              stage: "running",
              ownership: "supervised",
            },
            {
              member: members[2],
              stage: "unmet",
              reason: "crashed",
            },
          ],
        };
      },
    }, authority.database.authority.workerSlots);

    assert.deepEqual(await executor.planPoolWorkerCount({ command: plan, now: requestedAt, roster }), {
      state: "accepted",
      retirements: [],
      workerIds: [
        "person-lookup-worker-1",
        "person-lookup-worker-2",
        "person-lookup-worker-3",
      ],
    });
    assert.deepEqual(requests, [{
      command: "plan-worker-count",
      commandId: "77777777-7777-4777-8777-777777777777",
      workflowId: WORKFLOW_ID,
      desiredWorkers: 3,
      members: [
        { workflowId: WORKFLOW_ID, poolIndex: 1, ordinal: 1, membershipRevision: 1, workerId: "person-lookup-worker-1" },
        { workflowId: WORKFLOW_ID, poolIndex: 2, ordinal: 2, membershipRevision: 1, workerId: "person-lookup-worker-2" },
        { workflowId: WORKFLOW_ID, poolIndex: 3, ordinal: 3, membershipRevision: 1, workerId: "person-lookup-worker-3" },
      ],
      excessMembers: [],
      directive: { commandId: "77777777-7777-4777-8777-777777777777", requestedAt: NOW, requestedBy: "local-operator" },
    }]);
  });

  it("selects actual excess members for bounded stop but refuses count reduction without retirement proof", async () => {
    const authority = openAuthorityHarness();
    disposers.push(authority.dispose);
    const initial = workerBrowserCommand({ ...envelope, commandId: randomUUID(), family: "worker-browser",
      type: "plan-worker-count", target: { workflowId: WORKFLOW_ID, expectedVersion: 0 }, payload: { desiredWorkers: 3 } });
    if (initial.type !== "plan-worker-count") throw new Error("fixture initial roster command required");
    authority.database.withAuthorityTransaction(repositories => {
      repositories.commands.insert(initial);
      admitWorkerPoolRoster(repositories, initial, requestedAt);
    });
    const plan = workerBrowserCommand({ ...envelope, family: "worker-browser", type: "plan-worker-count",
      target: { workflowId: WORKFLOW_ID, expectedVersion: 1 }, payload: { desiredWorkers: 1 } });
    if (plan.type !== "plan-worker-count") throw new Error("fixture shrink command required");
    const roster = authority.database.withAuthorityTransaction(repositories => {
      repositories.commands.insert(plan);
      return admitWorkerPoolRoster(repositories, plan, requestedAt);
    });
    const members = [...roster.selected, ...roster.excess].map(workerPoolMember);
    const before = authority.database.authority.workerPools.get(WORKFLOW_ID);
    assert.equal(before?.desiredWorkers, 3);
    const requests: unknown[] = [];
    const executor = createWorkerPoolRuntimeExecutor({
      execute: request => { requests.push(request); return ({
        command: "plan-worker-count",
        state: "acknowledged",
        desiredWorkers: 1,
        members: [
          {
            member: members[0],
            stage: "running",
            ownership: "supervised",
          },
          {
            member: members[1],
            stage: "graceful-stop-requested",
            ownership: "supervised",
            phase: "initiating",
            escalation: STOP_ESCALATION,
            observed: OBSERVED_GRACEFUL,
          },
          {
            member: members[2],
            stage: "graceful-stop-requested",
            ownership: "supervised",
            phase: "initiating",
            escalation: STOP_ESCALATION,
            observed: OBSERVED_GRACEFUL,
          },
        ],
      }); },
    }, authority.database.authority.workerSlots);
    await assert.rejects(() => executor.planPoolWorkerCount({ command: plan, now: requestedAt, roster }), /worker-retirement-not-proved/u);
    assert.deepEqual(requests, [{ command: "plan-worker-count", commandId: plan.commandId,
      workflowId: WORKFLOW_ID, desiredWorkers: 1, members: members.slice(0, 1), excessMembers: members.slice(1),
      directive: { commandId: plan.commandId, requestedAt: NOW, requestedBy: "local-operator" } }]);
    assert.deepEqual(authority.database.authority.workerPools.get(WORKFLOW_ID), before);
    assert.deepEqual(authority.database.authority.workerSlots.list(WORKFLOW_ID), [...roster.selected, ...roster.excess]);
  });

  it("spawns only the explicit pool member acknowledged as started", async () => {
    const native = admittedAdapterRoster();
    const member = native.members[1];
    const requests: unknown[] = [];
    const executor = createWorkerPoolRuntimeExecutor({
      execute: (request) => {
        requests.push(request);
        return {
          command: "spawn-worker",
          state: "acknowledged",
          ownership: "supervised",
          member,
          stage: "started",
        };
      },
    }, native.authority.database.authority.workerSlots);
    const spawn = workerBrowserCommand({
      ...envelope,
      family: "worker-browser",
      type: "spawn-worker",
      target: { workflowId: WORKFLOW_ID, expectedVersion: 1 },
      payload: { workerId: "person-lookup-worker-2" },
    });

    assert.deepEqual(await executor.spawnPoolWorker({ command: spawn, now: requestedAt }), { state: "accepted" });
    assert.deepEqual(requests, [{
      command: "spawn-worker",
      commandId: "77777777-7777-4777-8777-777777777777",
      member: {
        workflowId: WORKFLOW_ID,
        poolIndex: 2,
        ordinal: 2,
        membershipRevision: 1,
        workerId: "person-lookup-worker-2",
      },
    }]);
  });

  it("requests a bounded graceful stop for the explicit member", async () => {
    const native = admittedAdapterRoster();
    const member = native.members[1];
    const requests: unknown[] = [];
    const executor = createWorkerPoolRuntimeExecutor({
      execute: (request) => {
        requests.push(request);
        return {
          command: "stop-worker",
          state: "acknowledged",
          ownership: "supervised",
          member,
          escalation: STOP_ESCALATION,
          observed: OBSERVED_GRACEFUL,
        };
      },
    }, native.authority.database.authority.workerSlots);
    const stop = workerBrowserCommand({
      ...envelope,
      family: "worker-browser",
      type: "stop-worker",
      target: { workerId: "person-lookup-worker-2", expectedVersion: 1 },
    });

    assert.deepEqual(await executor.stopPoolWorker({ command: stop, now: requestedAt }), { state: "accepted" });
    assert.deepEqual(requests, [{
      command: "stop-worker",
      commandId: "77777777-7777-4777-8777-777777777777",
      member: {
        workflowId: WORKFLOW_ID,
        poolIndex: 2,
        ordinal: 2,
        membershipRevision: 1,
        workerId: "person-lookup-worker-2",
      },
      escalation: STOP_ESCALATION,
      directive: { commandId: "77777777-7777-4777-8777-777777777777", requestedAt: NOW, requestedBy: "local-operator" },
    }]);
  });

  it("acknowledges pause only at the explicit member's requested stage", async () => {
    const native = admittedAdapterRoster();
    const member = native.members[0];
    const requests: unknown[] = [];
    const executor = createWorkerPoolRuntimeExecutor({
      execute: (request) => {
        requests.push(request);
        return {
          command: "pause-worker",
          state: "acknowledged",
          ownership: "supervised",
          member,
          stage: "pause-requested",
        };
      },
    }, native.authority.database.authority.workerSlots);
    const pause = workerBrowserCommand({
      ...envelope,
      family: "worker-browser",
      type: "pause-worker",
      target: { workerId: "person-lookup-worker-1", expectedVersion: 1 },
    });

    assert.deepEqual(await executor.pausePoolWorker({ command: pause, now: requestedAt }), { state: "accepted" });
    assert.deepEqual(requests, [{
      command: "pause-worker",
      commandId: "77777777-7777-4777-8777-777777777777",
      member: {
        workflowId: WORKFLOW_ID,
        poolIndex: 1,
        ordinal: 1,
        membershipRevision: 1,
        workerId: "person-lookup-worker-1",
      },
    }]);
  });

  it("acknowledges resume only at the explicit member's requested stage", async () => {
    const native = admittedAdapterRoster();
    const member = native.members[2];
    const requests: unknown[] = [];
    const executor = createWorkerPoolRuntimeExecutor({
      execute: (request) => {
        requests.push(request);
        return {
          command: "resume-worker",
          state: "acknowledged",
          ownership: "supervised",
          member,
          stage: "resume-requested",
        };
      },
    }, native.authority.database.authority.workerSlots);
    const resume = workerBrowserCommand({
      ...envelope,
      family: "worker-browser",
      type: "resume-worker",
      target: { workerId: "person-lookup-worker-3", expectedVersion: 1 },
    });

    assert.deepEqual(await executor.resumePoolWorker({ command: resume, now: requestedAt }), { state: "accepted" });
    assert.deepEqual(requests, [{
      command: "resume-worker",
      commandId: "77777777-7777-4777-8777-777777777777",
      member: {
        workflowId: WORKFLOW_ID,
        poolIndex: 3,
        ordinal: 3,
        membershipRevision: 1,
        workerId: "person-lookup-worker-3",
      },
    }]);
  });

  it("acknowledges refresh only after the explicit member session is refreshed", async () => {
    const native = admittedAdapterRoster();
    const member = native.members[1];
    const requests: unknown[] = [];
    const executor = createWorkerPoolRuntimeExecutor({
      execute: (request) => {
        requests.push(request);
        return {
          command: "refresh-browser",
          state: "acknowledged",
          ownership: "supervised",
          member,
          browserSessionId: ITEM_ID,
          stage: "refreshed",
        };
      },
    }, native.authority.database.authority.workerSlots);
    const refresh = workerBrowserCommand({
      ...envelope,
      family: "worker-browser",
      type: "refresh-browser",
      target: { workerId: "person-lookup-worker-2", browserSessionId: ITEM_ID, expectedVersion: 1 },
    });

    assert.deepEqual(await executor.refreshPoolBrowser({ command: refresh, now: requestedAt }), { state: "accepted" });
    assert.deepEqual(requests, [{
      command: "refresh-browser",
      commandId: "77777777-7777-4777-8777-777777777777",
      member: {
        workflowId: WORKFLOW_ID,
        poolIndex: 2,
        ordinal: 2,
        membershipRevision: 1,
        workerId: "person-lookup-worker-2",
      },
      browserSessionId: ITEM_ID,
    }]);
  });

  it("acknowledges reopen only after the explicit member session is reopened", async () => {
    const native = admittedAdapterRoster();
    const member = native.members[2];
    const requests: unknown[] = [];
    const executor = createWorkerPoolRuntimeExecutor({
      execute: (request) => {
        requests.push(request);
        return {
          command: "reopen-browser",
          state: "acknowledged",
          ownership: "supervised",
          member,
          browserSessionId: ITEM_ID,
          stage: "reopened",
        };
      },
    }, native.authority.database.authority.workerSlots);
    const reopen = workerBrowserCommand({
      ...envelope,
      family: "worker-browser",
      type: "reopen-browser",
      target: { workerId: "person-lookup-worker-3", browserSessionId: ITEM_ID, expectedVersion: 1 },
    });

    assert.deepEqual(await executor.reopenPoolBrowser({ command: reopen, now: requestedAt }), { state: "accepted" });
    assert.deepEqual(requests, [{
      command: "reopen-browser",
      commandId: "77777777-7777-4777-8777-777777777777",
      member: {
        workflowId: WORKFLOW_ID,
        poolIndex: 3,
        ordinal: 3,
        membershipRevision: 1,
        workerId: "person-lookup-worker-3",
      },
      browserSessionId: ITEM_ID,
    }]);
  });

  it("acknowledges a stop with the timestamped observed graceful stage, policy carried separately", async () => {
    const native = admittedAdapterRoster();
    const requests: unknown[] = [];
    const executor = createWorkerPoolRuntimeExecutor({
      execute: (request) => {
        requests.push(request);
        return {
          command: "stop-worker",
          state: "acknowledged",
          member: native.members[1],
          ownership: "supervised",
          escalation: STOP_ESCALATION,
          observed: OBSERVED_GRACEFUL,
        };
      },
    }, native.authority.database.authority.workerSlots);
    const stop = workerBrowserCommand({
      ...envelope,
      family: "worker-browser",
      type: "stop-worker",
      target: { workerId: "person-lookup-worker-2", expectedVersion: 1 },
    });

    assert.deepEqual(await executor.stopPoolWorker({ command: stop, now: requestedAt }), { state: "accepted" });
    assert.deepEqual(requests, [{
      command: "stop-worker",
      commandId: "77777777-7777-4777-8777-777777777777",
      member: native.members[1],
      escalation: STOP_ESCALATION,
      directive: { commandId: "77777777-7777-4777-8777-777777777777", requestedAt: NOW, requestedBy: "local-operator" },
    }]);
  });

  it.each([
    {
      seam: "stop",
      acknowledgement: (native: ReturnType<typeof admittedAdapterRoster>) => ({
        command: "stop-worker",
        state: "acknowledged",
        member: native.members[1],
        ownership: "supervised",
        escalation: STOP_ESCALATION,
        observed: [{ stage: "graceful-stop-requested", at: "2026-07-31T17:00:00.001Z" }],
      }),
      request: {
        family: "worker-browser",
        type: "stop-worker",
        target: { workerId: "person-lookup-worker-2", expectedVersion: 1 },
      },
    },
    {
      seam: "plan",
      acknowledgement: (native: ReturnType<typeof admittedAdapterRoster>) => ({
        command: "plan-worker-count",
        state: "acknowledged",
        desiredWorkers: 1,
        members: [
          { member: native.members[0], stage: "running", ownership: "supervised" },
          {
            member: native.members[1],
            stage: "graceful-stop-requested",
            ownership: "supervised",
            phase: "initiating",
            escalation: STOP_ESCALATION,
            observed: [{ stage: "graceful-stop-requested", at: "2026-07-31T17:00:00.001Z" }],
          },
          { member: native.members[2], stage: "graceful-stop-requested", ownership: "supervised", phase: "initiating", escalation: STOP_ESCALATION, observed: OBSERVED_GRACEFUL },
        ],
      }),
      request: {
        family: "worker-browser",
        type: "plan-worker-count",
        target: { workflowId: WORKFLOW_ID, expectedVersion: 1 },
        payload: { desiredWorkers: 1 },
      },
    },
  ])("refuses a $seam observation timestamped after the command's now", async ({ seam, acknowledgement, request }) => {
    const native = admittedAdapterRoster();
    // An observation is a record of something that HAPPENED; one postdating
    // the command's own clock is a claim about the future dressed as a fact.
    const executor = createWorkerPoolRuntimeExecutor({ execute: () => acknowledgement(native) }, native.authority.database.authority.workerSlots);
    const command = workerBrowserCommand({ ...envelope, ...request });
    const invoke = seam === "stop"
      ? () => executor.stopPoolWorker({ command, now: requestedAt })
      : () => executor.planPoolWorkerCount({ command, now: requestedAt, roster: admitAdapterPlan(native, command) });

    await assert.rejects(
      invoke,
      /person-lookup-worker-2 reports graceful-stop-requested observed at 2026-07-31T17:00:00\.001Z, after the command's now/,
    );
  });

  it("refuses an initial stop acknowledgement claiming future escalation stages", async () => {
    const native = admittedAdapterRoster();
    const executor = createWorkerPoolRuntimeExecutor({
      execute: () => ({
        command: "stop-worker",
        state: "acknowledged",
        member: native.members[1],
        ownership: "supervised",
        escalation: STOP_ESCALATION,
        observed: [
          { stage: "graceful-stop-requested", at: NOW },
          { stage: "sigterm-sent", at: NOW },
        ],
      }),
    }, native.authority.database.authority.workerSlots);
    const stop = workerBrowserCommand({
      ...envelope,
      family: "worker-browser",
      type: "stop-worker",
      target: { workerId: "person-lookup-worker-2", expectedVersion: 1 },
    });

    await assert.rejects(
      () => executor.stopPoolWorker({ command: stop, now: requestedAt }),
      /may acknowledge only the observed graceful-stop-requested stage.*recorded as they occur/,
    );
  });

  it("refuses a stop observation that short-circuits past the graceful stage", async () => {
    const native = admittedAdapterRoster();
    const executor = createWorkerPoolRuntimeExecutor({
      execute: () => ({
        command: "stop-worker",
        state: "acknowledged",
        member: native.members[1],
        ownership: "supervised",
        escalation: STOP_ESCALATION,
        observed: [{ stage: "sigkill-sent", at: NOW }],
      }),
    }, native.authority.database.authority.workerSlots);
    const stop = workerBrowserCommand({
      ...envelope,
      family: "worker-browser",
      type: "stop-worker",
      target: { workerId: "person-lookup-worker-2", expectedVersion: 1 },
    });

    await assert.rejects(
      () => executor.stopPoolWorker({ command: stop, now: requestedAt }),
      /must follow the escalation policy in order/,
    );
  });

  it("refuses an illegal escalation transition in a reconciliation fact", async () => {
    const native = admittedAdapterRoster();
    const executor = createWorkerPoolRuntimeExecutor({
      execute: () => ({
        command: "plan-worker-count",
        state: "acknowledged",
        desiredWorkers: 1,
        members: [
          { member: native.members[0], stage: "running", ownership: "supervised" },
          {
            member: native.members[1],
            stage: "graceful-stop-requested",
            ownership: "supervised",
            phase: "reconciling",
            escalation: STOP_ESCALATION,
            observed: [
              { stage: "graceful-stop-requested", at: NOW },
              // sigterm-sent skipped: graceful cannot jump straight to SIGKILL.
              { stage: "sigkill-sent", at: NOW },
            ],
          },
          {
            member: native.members[2],
            stage: "graceful-stop-requested",
            ownership: "supervised",
            phase: "initiating",
            escalation: STOP_ESCALATION,
            observed: OBSERVED_GRACEFUL,
          },
        ],
      }),
    }, native.authority.database.authority.workerSlots);
    const plan = workerBrowserCommand({
      ...envelope,
      family: "worker-browser",
      type: "plan-worker-count",
      target: { workflowId: WORKFLOW_ID, expectedVersion: 1 },
      payload: { desiredWorkers: 1 },
    });

    await assert.rejects(
      () => executor.planPoolWorkerCount({ command: plan, now: requestedAt, roster: admitAdapterPlan(native, plan) }),
      /must follow the escalation policy in order/,
    );
  });

  it("refuses observed escalation stages with regressing timestamps", async () => {
    const native = admittedAdapterRoster();
    const executor = createWorkerPoolRuntimeExecutor({
      execute: () => ({
        command: "plan-worker-count",
        state: "acknowledged",
        desiredWorkers: 1,
        members: [
          { member: native.members[0], stage: "running", ownership: "supervised" },
          {
            member: native.members[1],
            stage: "graceful-stop-requested",
            ownership: "supervised",
            phase: "reconciling",
            escalation: STOP_ESCALATION,
            observed: [
              { stage: "graceful-stop-requested", at: "2026-07-31T17:05:00.000Z" },
              { stage: "sigterm-sent", at: NOW },
            ],
          },
          {
            member: native.members[2],
            stage: "graceful-stop-requested",
            ownership: "supervised",
            phase: "initiating",
            escalation: STOP_ESCALATION,
            observed: OBSERVED_GRACEFUL,
          },
        ],
      }),
    }, native.authority.database.authority.workerSlots);
    const plan = workerBrowserCommand({
      ...envelope,
      family: "worker-browser",
      type: "plan-worker-count",
      target: { workflowId: WORKFLOW_ID, expectedVersion: 1 },
      payload: { desiredWorkers: 1 },
    });

    await assert.rejects(
      () => executor.planPoolWorkerCount({ command: plan, now: requestedAt, roster: admitAdapterPlan(native, plan) }),
      /non-decreasing timestamps/,
    );
  });

  it("refuses an initiating plan fact claiming escalation stages beyond the graceful request", async () => {
    const native = admittedAdapterRoster();

    const executor = createWorkerPoolRuntimeExecutor({
      execute: () => ({
        command: "plan-worker-count",
        state: "acknowledged",
        desiredWorkers: 1,
        members: [
          { member: native.members[0], stage: "running", ownership: "supervised" },
          {
            member: native.members[1],
            stage: "graceful-stop-requested",
            ownership: "supervised",
            phase: "initiating",
            escalation: STOP_ESCALATION,
            observed: [
              { stage: "graceful-stop-requested", at: NOW },
              { stage: "sigterm-sent", at: NOW },
            ],
          },
          {
            member: native.members[2],
            stage: "graceful-stop-requested",
            ownership: "supervised",
            phase: "initiating",
            escalation: STOP_ESCALATION,
            observed: OBSERVED_GRACEFUL,
          },
        ],
      }),
    }, native.authority.database.authority.workerSlots);
    const plan = workerBrowserCommand({
      ...envelope,
      family: "worker-browser",
      type: "plan-worker-count",
      target: { workflowId: WORKFLOW_ID, expectedVersion: 1 },
      payload: { desiredWorkers: 1 },
    });

    await assert.rejects(
      () => executor.planPoolWorkerCount({ command: plan, now: requestedAt, roster: admitAdapterPlan(native, plan) }),
      /plan-worker-count for person-lookup-worker-2 may acknowledge only the observed graceful-stop-requested stage.*sigterm-sent.*recorded as they occur/,
    );
  });

  it("preserves reconciling escalation facts but refuses unproved retirement", async () => {

    const native = admittedAdapterRoster();
    const executor = createWorkerPoolRuntimeExecutor({
      execute: () => ({
        command: "plan-worker-count",
        state: "acknowledged",
        desiredWorkers: 1,
        members: [
          { member: native.members[0], stage: "running", ownership: "supervised" },
          {
            member: native.members[1],
            stage: "graceful-stop-requested",
            ownership: "supervised",
            phase: "reconciling",
            escalation: STOP_ESCALATION,
            observed: [
              { stage: "graceful-stop-requested", at: "2026-07-31T16:58:00.000Z" },
              { stage: "sigterm-sent", at: "2026-07-31T16:59:00.000Z" },
            ],
          },
          { member: native.members[2], stage: "graceful-stop-requested", ownership: "supervised", phase: "initiating", escalation: STOP_ESCALATION, observed: OBSERVED_GRACEFUL },
        ],
      }),
    }, native.authority.database.authority.workerSlots);
    const plan = workerBrowserCommand({
      ...envelope,
      family: "worker-browser",
      type: "plan-worker-count",
      target: { workflowId: WORKFLOW_ID, expectedVersion: 1 },
      payload: { desiredWorkers: 1 },
    });

    const roster = admitAdapterPlan(native, plan);
    const before = native.authority.database.authority.workerPools.get(WORKFLOW_ID);
    await assert.rejects(() => executor.planPoolWorkerCount({ command: plan, now: requestedAt, roster }), /worker-retirement-not-proved/u);
    assert.equal(before?.desiredWorkers, 3);
    assert.deepEqual(native.authority.database.authority.workerPools.get(WORKFLOW_ID), before);
    assert.deepEqual(native.authority.database.authority.workerSlots.list(WORKFLOW_ID), [...roster.selected, ...roster.excess]);
  });

  it("bounds a reconciling plan fact's observed stages by the command's now", async () => {
    const native = admittedAdapterRoster();

    const executor = createWorkerPoolRuntimeExecutor({
      execute: () => ({
        command: "plan-worker-count",
        state: "acknowledged",
        desiredWorkers: 1,
        members: [
          { member: native.members[0], stage: "running", ownership: "supervised" },
          {
            member: native.members[1],
            stage: "graceful-stop-requested",
            ownership: "supervised",
            phase: "reconciling",
            escalation: STOP_ESCALATION,
            observed: [
              { stage: "graceful-stop-requested", at: NOW },
              { stage: "sigterm-sent", at: "2026-07-31T17:00:00.001Z" },
            ],
          },
          { member: native.members[2], stage: "unmet", reason: "not-started" },
        ],
      }),
    }, native.authority.database.authority.workerSlots);
    const plan = workerBrowserCommand({
      ...envelope,
      family: "worker-browser",
      type: "plan-worker-count",
      target: { workflowId: WORKFLOW_ID, expectedVersion: 1 },
      payload: { desiredWorkers: 1 },
    });

    await assert.rejects(
      () => executor.planPoolWorkerCount({ command: plan, now: requestedAt, roster: admitAdapterPlan(native, plan) }),
      /person-lookup-worker-2 reports sigterm-sent observed at 2026-07-31T17:00:00\.001Z, after the command's now/,
    );
  });

  it("refuses a plan fact that omits the initiating/reconciling attestation", async () => {
    const native = admittedAdapterRoster();

    const executor = createWorkerPoolRuntimeExecutor({
      execute: () => ({
        command: "plan-worker-count",
        state: "acknowledged",
        desiredWorkers: 1,
        members: [
          { member: native.members[0], stage: "running", ownership: "supervised" },
          {
            member: native.members[1],
            stage: "graceful-stop-requested",
            ownership: "supervised",
            escalation: STOP_ESCALATION,
            observed: OBSERVED_GRACEFUL,
          },
          { member: native.members[2], stage: "unmet", reason: "not-started" },
        ],
      }),
    }, native.authority.database.authority.workerSlots);
    const plan = workerBrowserCommand({
      ...envelope,
      family: "worker-browser",
      type: "plan-worker-count",
      target: { workflowId: WORKFLOW_ID, expectedVersion: 1 },
      payload: { desiredWorkers: 1 },
    });

    await assert.rejects(
      () => executor.planPoolWorkerCount({ command: plan, now: requestedAt, roster: admitAdapterPlan(native, plan) }),
      /phase/,
    );
  });

  it("refuses a malformed command now instead of silently unbounding observed stages", async () => {
    // Date.parse can return NaN; validate the command instant before comparing observed stages.
    const native = admittedAdapterRoster();
    const executor = createWorkerPoolRuntimeExecutor({
      execute: () => ({
        command: "stop-worker",
        state: "acknowledged",
        member: native.members[1],
        ownership: "supervised",
        escalation: STOP_ESCALATION,
        observed: OBSERVED_GRACEFUL,
      }),
    }, native.authority.database.authority.workerSlots);
    const stop = workerBrowserCommand({
      ...envelope,
      family: "worker-browser",
      type: "stop-worker",
      target: { workerId: "person-lookup-worker-2", expectedVersion: 1 },
    });

    await assert.rejects(
      () => executor.stopPoolWorker({ command: stop, now: "not-an-instant" }),
      /stop-worker received an unparseable command now "not-an-instant"/,
    );
  });

  it.each([
    { method: "planPoolWorkerCount" },
    { method: "spawnPoolWorker" },
    { method: "stopPoolWorker" },
    { method: "pausePoolWorker" },
    { method: "resumePoolWorker" },
    { method: "refreshPoolBrowser" },
    { method: "reopenPoolBrowser" },
  ] as const)("$method names itself when mis-dispatched a foreign command", async ({ method }) => {

    const native = admittedAdapterRoster();
    const executor = createWorkerPoolRuntimeExecutor({
      execute: () => {
        throw new Error("supervisor must not be called on a mis-dispatch");
      },
    }, native.authority.database.authority.workerSlots);
    const foreignType = method === "planPoolWorkerCount" ? "spawn-worker" : "plan-worker-count";
    const command = method === "planPoolWorkerCount"
      ? workerBrowserCommand({
          ...envelope,
          family: "worker-browser",
          type: "spawn-worker",
          target: { workflowId: WORKFLOW_ID, expectedVersion: 1 },
          payload: { workerId: "person-lookup-worker-1" },
        })
      : workerBrowserCommand({
          ...envelope,
          family: "worker-browser",
          type: "plan-worker-count",
          target: { workflowId: WORKFLOW_ID, expectedVersion: 1 },
          payload: { desiredWorkers: 1 },
        });

    await assert.rejects(
      () => executor[method]({ command, now: requestedAt }),
      new RegExp(`${method} received a ${foreignType} command`),
    );
  });

  it.each([
    {
      type: "plan-worker-count",
      request: {
        family: "worker-browser",
        type: "plan-worker-count",
        target: { workflowId: WORKFLOW_ID, expectedVersion: 1 },
        payload: { desiredWorkers: 2 },
      },
      acknowledgement: (native: ReturnType<typeof admittedAdapterRoster>) => ({
        command: "plan-worker-count",
        state: "acknowledged",
        desiredWorkers: 2,
        members: [
          { member: native.members[0], stage: "running", ownership: "supervised" },
          { member: native.members[1], stage: "running", ownership: "external" },
          { member: native.members[2], stage: "graceful-stop-requested", ownership: "supervised", phase: "initiating", escalation: STOP_ESCALATION, observed: OBSERVED_GRACEFUL },
        ],
      }),
    },
    {
      type: "spawn-worker",
      request: {
        family: "worker-browser",
        type: "spawn-worker",
        target: { workflowId: WORKFLOW_ID, expectedVersion: 1 },
        payload: { workerId: "person-lookup-worker-2" },
      },
      acknowledgement: (native: ReturnType<typeof admittedAdapterRoster>) => ({
        command: "spawn-worker",
        state: "acknowledged",
        member: native.members[1],
        ownership: "external",
        stage: "started",
      }),
    },
    {
      type: "stop-worker",
      request: {
        family: "worker-browser",
        type: "stop-worker",
        target: { workerId: "person-lookup-worker-2", expectedVersion: 1 },
      },
      acknowledgement: (native: ReturnType<typeof admittedAdapterRoster>) => ({
        command: "stop-worker",
        state: "acknowledged",
        member: native.members[1],
        ownership: "external",
        escalation: STOP_ESCALATION,
        observed: OBSERVED_GRACEFUL,
      }),
    },
    {
      type: "pause-worker",
      request: {
        family: "worker-browser",
        type: "pause-worker",
        target: { workerId: "person-lookup-worker-2", expectedVersion: 1 },
      },
      acknowledgement: (native: ReturnType<typeof admittedAdapterRoster>) => ({
        command: "pause-worker",
        state: "acknowledged",
        member: native.members[1],
        ownership: "external",
        stage: "pause-requested",
      }),
    },
    {
      type: "resume-worker",
      request: {
        family: "worker-browser",
        type: "resume-worker",
        target: { workerId: "person-lookup-worker-2", expectedVersion: 1 },
      },
      acknowledgement: (native: ReturnType<typeof admittedAdapterRoster>) => ({
        command: "resume-worker",
        state: "acknowledged",
        member: native.members[1],
        ownership: "external",
        stage: "resume-requested",
      }),
    },
    {
      type: "refresh-browser",
      request: {
        family: "worker-browser",
        type: "refresh-browser",
        target: { workerId: "person-lookup-worker-2", browserSessionId: ITEM_ID, expectedVersion: 1 },
      },
      acknowledgement: (native: ReturnType<typeof admittedAdapterRoster>) => ({
        command: "refresh-browser",
        state: "acknowledged",
        member: native.members[1],
        ownership: "external",
        browserSessionId: ITEM_ID,
        stage: "refreshed",
      }),
    },
    {
      type: "reopen-browser",
      request: {
        family: "worker-browser",
        type: "reopen-browser",
        target: { workerId: "person-lookup-worker-2", browserSessionId: ITEM_ID, expectedVersion: 1 },
      },
      acknowledgement: (native: ReturnType<typeof admittedAdapterRoster>) => ({
        command: "reopen-browser",
        state: "acknowledged",
        member: native.members[1],
        ownership: "external",
        browserSessionId: ITEM_ID,
        stage: "reopened",
      }),
    },
  ])("refuses a $type acknowledgement for an externally owned member", async ({ type, request, acknowledgement }) => {
    const native = admittedAdapterRoster();
    const executor = createWorkerPoolRuntimeExecutor({ execute: () => acknowledgement(native) }, native.authority.database.authority.workerSlots);
    const command = workerBrowserCommand({ ...envelope, ...request });
    const context = { command, now: requestedAt, ...(command.type === "plan-worker-count" ? { roster: admitAdapterPlan(native, command) } : {}) };
    const message = new RegExp(
      `${type} touches externally owned member person-lookup-worker-2 at index 2; `
      + "a mutating control requires durable supervisor ownership",
    );

    switch (type) {
      case "plan-worker-count":
        await assert.rejects(() => executor.planPoolWorkerCount(context), message);
        break;
      case "spawn-worker":
        await assert.rejects(() => executor.spawnPoolWorker(context), message);
        break;
      case "stop-worker":
        await assert.rejects(() => executor.stopPoolWorker(context), message);
        break;
      case "pause-worker":
        await assert.rejects(() => executor.pausePoolWorker(context), message);
        break;
      case "resume-worker":
        await assert.rejects(() => executor.resumePoolWorker(context), message);
        break;
      case "refresh-browser":
        await assert.rejects(() => executor.refreshPoolBrowser(context), message);
        break;
      case "reopen-browser":
        await assert.rejects(() => executor.reopenPoolBrowser(context), message);
        break;
    }
  });

  

  it("refuses a stop acknowledgement with no observed stages", async () => {

    const native = admittedAdapterRoster();
    const executor = createWorkerPoolRuntimeExecutor({
      execute: () => ({
        command: "stop-worker",
        state: "acknowledged",
        member: native.members[1],
        ownership: "supervised",
        escalation: STOP_ESCALATION,
        observed: [],
      }),
    }, native.authority.database.authority.workerSlots);
    const stop = workerBrowserCommand({
      ...envelope,
      family: "worker-browser",
      type: "stop-worker",
      target: { workerId: "person-lookup-worker-2", expectedVersion: 1 },
    });

    await assert.rejects(
      () => executor.stopPoolWorker({ command: stop, now: requestedAt }),
      /Too small: expected array to have >=1 items/,
    );
  });

  it("names the authoritative excess members but refuses unproved scale-down", async () => {
    const requests: unknown[] = [];
    const native = admittedAdapterRoster();
    const executor = createWorkerPoolRuntimeExecutor({
      execute: (request) => {
        requests.push(request);
        return {
          command: "plan-worker-count",
          state: "acknowledged",
          desiredWorkers: 1,
          members: [
            { member: native.members[0], stage: "running", ownership: "supervised" },
            { member: native.members[1], stage: "graceful-stop-requested", ownership: "supervised", phase: "initiating", escalation: STOP_ESCALATION, observed: OBSERVED_GRACEFUL },
            { member: native.members[2], stage: "graceful-stop-requested", ownership: "supervised", phase: "initiating", escalation: STOP_ESCALATION, observed: OBSERVED_GRACEFUL },
          ],
        };
      },
    }, native.authority.database.authority.workerSlots);
    const plan = workerBrowserCommand({
      ...envelope,
      family: "worker-browser",
      type: "plan-worker-count",
      target: { workflowId: WORKFLOW_ID, expectedVersion: 1 },
      payload: { desiredWorkers: 1 },
    });

    const roster = admitAdapterPlan(native, plan);
    const before = native.authority.database.authority.workerPools.get(WORKFLOW_ID);
    await assert.rejects(() => executor.planPoolWorkerCount({ command: plan, now: requestedAt, roster }), /worker-retirement-not-proved/u);
    assert.equal(before?.desiredWorkers, 3);
    assert.deepEqual(native.authority.database.authority.workerPools.get(WORKFLOW_ID), before);
    assert.deepEqual(native.authority.database.authority.workerSlots.list(WORKFLOW_ID), [...roster.selected, ...roster.excess]);
    assert.deepEqual(requests, [{
      command: "plan-worker-count",
      commandId: "77777777-7777-4777-8777-777777777777",
      workflowId: WORKFLOW_ID,
      desiredWorkers: 1,
      members: [native.members[0]],
      excessMembers: [native.members[1], native.members[2]],
      directive: { commandId: "77777777-7777-4777-8777-777777777777", requestedAt: NOW, requestedBy: "local-operator" },
    }]);
  });

  it("preserves honest unmet excess facts but refuses unproved scale-down", async () => {

    const native = admittedAdapterRoster();
    const executor = createWorkerPoolRuntimeExecutor({
      execute: () => ({
        command: "plan-worker-count",
        state: "acknowledged",
        desiredWorkers: 1,
        members: [
          { member: native.members[0], stage: "running", ownership: "supervised" },
          { member: native.members[1], stage: "unmet", reason: "crashed" },
          { member: native.members[2], stage: "graceful-stop-requested", ownership: "supervised", phase: "initiating", escalation: STOP_ESCALATION, observed: OBSERVED_GRACEFUL },
        ],
      }),
    }, native.authority.database.authority.workerSlots);
    const plan = workerBrowserCommand({
      ...envelope,
      family: "worker-browser",
      type: "plan-worker-count",
      target: { workflowId: WORKFLOW_ID, expectedVersion: 1 },
      payload: { desiredWorkers: 1 },
    });

    const roster = admitAdapterPlan(native, plan);
    const before = native.authority.database.authority.workerPools.get(WORKFLOW_ID);
    await assert.rejects(() => executor.planPoolWorkerCount({ command: plan, now: requestedAt, roster }), /worker-retirement-not-proved/u);
    assert.equal(before?.desiredWorkers, 3);
    assert.deepEqual(native.authority.database.authority.workerPools.get(WORKFLOW_ID), before);
    assert.deepEqual(native.authority.database.authority.workerSlots.list(WORKFLOW_ID), [...roster.selected, ...roster.excess]);
  });

  it("refuses a scale-down acknowledgement that omits an authoritative excess member", async () => {
    const native = admittedAdapterRoster();
    const executor = createWorkerPoolRuntimeExecutor({
      execute: () => ({
        command: "plan-worker-count",
        state: "acknowledged",
        desiredWorkers: 1,
        members: [
          { member: native.members[0], stage: "running", ownership: "supervised" },
          { member: native.members[1], stage: "graceful-stop-requested", ownership: "supervised", phase: "initiating", escalation: STOP_ESCALATION, observed: OBSERVED_GRACEFUL },
          // person-lookup-worker-3 silently omitted: its stop is never covered.
        ],
      }),
    }, native.authority.database.authority.workerSlots);
    const plan = workerBrowserCommand({
      ...envelope,
      family: "worker-browser",
      type: "plan-worker-count",
      target: { workflowId: WORKFLOW_ID, expectedVersion: 1 },
      payload: { desiredWorkers: 1 },
    });

    await assert.rejects(
      () => executor.planPoolWorkerCount({ command: plan, now: requestedAt, roster: admitAdapterPlan(native, plan) }),
      /requires a bounded graceful stop acknowledgement for excess member person-lookup-worker-3 at index 3/,
    );
  });

  it("refuses a supervisor that mutates the spawn request member after submission", async () => {
    const native = admittedAdapterRoster();
    const executor = createWorkerPoolRuntimeExecutor({
      execute: (request) => {

        const mutable = request as unknown as { member: { poolIndex: number; workerId: string } };
        mutable.member.poolIndex = 2;
        mutable.member.workerId = "person-lookup-worker-2";
        return {
          command: "spawn-worker",
          state: "acknowledged",
          ownership: "supervised",
          member: native.members[1],
          stage: "started",
        };
      },
    }, native.authority.database.authority.workerSlots);
    const spawn = workerBrowserCommand({
      ...envelope,
      family: "worker-browser",
      type: "spawn-worker",
      target: { workflowId: WORKFLOW_ID, expectedVersion: 1 },
      payload: { workerId: "person-lookup-worker-1" },
    });


    await assert.rejects(
      () => executor.spawnPoolWorker({ command: spawn, now: requestedAt }),
      { name: "TypeError", message: /read only property 'poolIndex'/ },
    );
  });

  it("refuses a supervisor that mutates the plan request roster after submission", async () => {
    const native = admittedAdapterRoster();
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
          members: native.members.map((member) => ({
            member,
            stage: "running",
            ownership: "supervised",
          })),
        };
      },
    }, native.authority.database.authority.workerSlots);
    const plan = workerBrowserCommand({
      ...envelope,
      family: "worker-browser",
      type: "plan-worker-count",
      target: { workflowId: WORKFLOW_ID, expectedVersion: 1 },
      payload: { desiredWorkers: 3 },
    });


    await assert.rejects(
      () => executor.planPoolWorkerCount({ command: plan, now: requestedAt, roster: admitAdapterPlan(native, plan) }),
      { name: "TypeError", message: /read only property 'workerId'/ },
    );
  });

  it("awaits an asynchronous supervisor effect before acknowledging a spawn", async () => {
    let effectProved = false;
    const native = admittedAdapterRoster();
    const executor = createWorkerPoolRuntimeExecutor({
      execute: async () => {
        await new Promise((resolve) => setImmediate(resolve));
        effectProved = true;
        return {
          command: "spawn-worker",
          state: "acknowledged",
          ownership: "supervised",
          member: native.members[1],
          stage: "started",
        };
      },
    }, native.authority.database.authority.workerSlots);
    const spawn = workerBrowserCommand({
      ...envelope,
      family: "worker-browser",
      type: "spawn-worker",
      target: { workflowId: WORKFLOW_ID, expectedVersion: 1 },
      payload: { workerId: "person-lookup-worker-2" },
    });

    const acknowledged = await executor.spawnPoolWorker({ command: spawn, now: requestedAt });
    assert.equal(effectProved, true, "the acknowledgement settled before the supervisor proved the effect");
    assert.deepEqual(acknowledged, { state: "accepted" });
  });

  it("never settles the acknowledgement before the supervisor's effect settles", async () => {
    let release: (() => void) | undefined;
    const effect = new Promise<void>((resolve) => {
      release = resolve;
    });
    const native = admittedAdapterRoster();
    const executor = createWorkerPoolRuntimeExecutor({
      execute: () => effect.then(() => ({
        command: "spawn-worker",
        state: "acknowledged",
        ownership: "supervised",
        member: native.members[1],
        stage: "started",
      })),
    }, native.authority.database.authority.workerSlots);
    const spawn = workerBrowserCommand({
      ...envelope,
      family: "worker-browser",
      type: "spawn-worker",
      target: { workflowId: WORKFLOW_ID, expectedVersion: 1 },
      payload: { workerId: "person-lookup-worker-2" },
    });

    let settled = false;
    const acknowledging = (async () => executor.spawnPoolWorker({ command: spawn, now: requestedAt }))();
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
    const native = admittedAdapterRoster();
    const executor = createWorkerPoolRuntimeExecutor({
      execute: () => Promise.reject(new Error("spawn failed: EAGAIN forking person-lookup-worker-2")),
    }, native.authority.database.authority.workerSlots);
    const spawn = workerBrowserCommand({
      ...envelope,
      family: "worker-browser",
      type: "spawn-worker",
      target: { workflowId: WORKFLOW_ID, expectedVersion: 1 },
      payload: { workerId: "person-lookup-worker-2" },
    });

    await assert.rejects(
      () => executor.spawnPoolWorker({ command: spawn, now: requestedAt }),
      /EAGAIN forking person-lookup-worker-2/,
    );
  });

  it("refuses a plan above the proved three-member cap before calling the supervisor", async () => {
    let calls = 0;
    const native = admittedAdapterRoster();
    const executor = createWorkerPoolRuntimeExecutor({
      execute: () => {
        calls += 1;
        throw new Error("supervisor must not be called");
      },
    }, native.authority.database.authority.workerSlots);
    assert.throws(() => workerBrowserCommand({
      ...envelope,
      family: "worker-browser",
      type: "plan-worker-count",
      target: { workflowId: WORKFLOW_ID, expectedVersion: 1 },
      payload: { desiredWorkers: 4 },
    }), /Too big: expected number to be <=3/u);
    assert.equal(calls, 0);
    assert.ok(executor);
  });

  it.each([
    { workerId: "person-lookup-worker", message: /worker-slot-not-admitted/ },
    { workerId: "person-lookup-worker-4", message: /worker-slot-not-admitted/ },
    { workerId: "onboarding-worker-1", message: /worker-slot-workflow-mismatch/ },
  ])("refuses absent or wrong-workflow admitted spawn identity $workerId before calling the supervisor", async ({ workerId, message }) => {
    let calls = 0;
    const native = admittedAdapterRoster(workerId.startsWith("onboarding-") ? "onboarding" : WORKFLOW_ID);
    const executor = createWorkerPoolRuntimeExecutor({
      execute: () => {
        calls += 1;
        throw new Error("supervisor must not be called");
      },
    }, native.authority.database.authority.workerSlots);
    const spawn = workerBrowserCommand({
      ...envelope,
      family: "worker-browser",
      type: "spawn-worker",
      target: { workflowId: WORKFLOW_ID, expectedVersion: 1 },
      payload: { workerId },
    });

    await assert.rejects(() => executor.spawnPoolWorker({ command: spawn, now: requestedAt }), message);
    assert.equal(calls, 0);
  });

  it.each([
    {
      name: "different desired count",
      desiredWorkers: 2,
      acknowledgement: (native: ReturnType<typeof admittedAdapterRoster>) => ({
        command: "plan-worker-count",
        state: "acknowledged",
        desiredWorkers: 1,
        members: [{ member: native.members[0], stage: "running", ownership: "supervised" }],
      }),
      message: /requested 2 workers but the supervisor acknowledged 1/,
    },
    {
      name: "missing desired member",
      desiredWorkers: 2,
      acknowledgement: (native: ReturnType<typeof admittedAdapterRoster>) => ({
        command: "plan-worker-count",
        state: "acknowledged",
        desiredWorkers: 2,
        members: [{ member: native.members[0], stage: "running", ownership: "supervised" }],
      }),
      message: /requires acknowledgement for desired member person-lookup-worker-2 at index 2/,
    },
    {
      name: "out-of-order member",
      desiredWorkers: 2,
      acknowledgement: (native: ReturnType<typeof admittedAdapterRoster>) => ({
        command: "plan-worker-count",
        state: "acknowledged",
        desiredWorkers: 2,
        members: [
          { member: native.members[1], stage: "running", ownership: "supervised" },
          { member: native.members[0], stage: "running", ownership: "supervised" },
        ],
      }),
      message: /requested member person-lookup-worker-1 at index 1.*acknowledged person-lookup-worker-2 at index 2/,
    },
    {
      name: "stop on a desired member",
      desiredWorkers: 2,
      acknowledgement: (native: ReturnType<typeof admittedAdapterRoster>) => ({
        command: "plan-worker-count",
        state: "acknowledged",
        desiredWorkers: 2,
        members: [
          { member: native.members[0], stage: "graceful-stop-requested", ownership: "supervised", phase: "initiating", escalation: STOP_ESCALATION, observed: OBSERVED_GRACEFUL },
          { member: native.members[1], stage: "running", ownership: "supervised" },
        ],
      }),
      message: /cannot stop desired member person-lookup-worker-1 at index 1/,
    },
    {
      name: "running excess member without stop coverage",
      desiredWorkers: 1,
      acknowledgement: (native: ReturnType<typeof admittedAdapterRoster>) => ({
        command: "plan-worker-count",
        state: "acknowledged",
        desiredWorkers: 1,
        members: [
          { member: native.members[0], stage: "running", ownership: "supervised" },
          { member: native.members[1], stage: "running", ownership: "supervised" },
        ],
      }),
      message: /must select running excess member person-lookup-worker-2 for bounded graceful stop/,
    },
  ])("refuses a plan acknowledgement with $name", async ({ desiredWorkers, acknowledgement, message }) => {
    const native = admittedAdapterRoster();
    const executor = createWorkerPoolRuntimeExecutor({ execute: () => acknowledgement(native) }, native.authority.database.authority.workerSlots);
    const plan = workerBrowserCommand({
      ...envelope,
      family: "worker-browser",
      type: "plan-worker-count",
      target: { workflowId: WORKFLOW_ID, expectedVersion: 1 },
      payload: { desiredWorkers },
    });

    await assert.rejects(() => executor.planPoolWorkerCount({ command: plan, now: requestedAt, roster: admitAdapterPlan(native, plan) }), message);
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
      acknowledgement: (native: ReturnType<typeof admittedAdapterRoster>) => ({
        command: "spawn-worker",
        state: "acknowledged",
        ownership: "supervised",
        member: native.members[1],
        stage: "started",
      }),
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
      acknowledgement: (native: ReturnType<typeof admittedAdapterRoster>) => ({
        command: "stop-worker",
        state: "acknowledged",
        ownership: "supervised",
        member: native.members[1],
        escalation: STOP_ESCALATION,
        observed: OBSERVED_GRACEFUL,
      }),
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
      acknowledgement: (native: ReturnType<typeof admittedAdapterRoster>) => ({
        command: "pause-worker",
        state: "acknowledged",
        ownership: "supervised",
        member: native.members[1],
        stage: "pause-requested",
      }),
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
      acknowledgement: (native: ReturnType<typeof admittedAdapterRoster>) => ({
        command: "resume-worker",
        state: "acknowledged",
        ownership: "supervised",
        member: native.members[1],
        stage: "resume-requested",
      }),
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
      acknowledgement: (native: ReturnType<typeof admittedAdapterRoster>) => ({
        command: "refresh-browser",
        state: "acknowledged",
        ownership: "supervised",
        member: native.members[0],
        browserSessionId: UUID_5,
        stage: "refreshed",
      }),
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
      acknowledgement: (native: ReturnType<typeof admittedAdapterRoster>) => ({
        command: "reopen-browser",
        state: "acknowledged",
        ownership: "supervised",
        member: native.members[1],
        browserSessionId: ITEM_ID,
        stage: "reopened",
      }),
      message: /requested member person-lookup-worker-1 at index 1.*acknowledged person-lookup-worker-2 at index 2/,
    },
  ])("refuses mismatched $type acknowledgement facts", async ({ type, command: request, acknowledgement, message }) => {
    const native = admittedAdapterRoster();
    const command = workerBrowserCommand(request);
    const context = { command, now: requestedAt, ...(command.type === "plan-worker-count" ? { roster: admitAdapterPlan(native, command) } : {}) };
    const executor = createWorkerPoolRuntimeExecutor({ execute: () => acknowledgement(native) }, native.authority.database.authority.workerSlots);

    switch (type) {
      case "spawn-worker":
        await assert.rejects(() => executor.spawnPoolWorker(context), message);
        break;
      case "stop-worker":
        await assert.rejects(() => executor.stopPoolWorker(context), message);
        break;
      case "pause-worker":
        await assert.rejects(() => executor.pausePoolWorker(context), message);
        break;
      case "resume-worker":
        await assert.rejects(() => executor.resumePoolWorker(context), message);
        break;
      case "refresh-browser":
        await assert.rejects(() => executor.refreshPoolBrowser(context), message);
        break;
      case "reopen-browser":
        await assert.rejects(() => executor.reopenPoolBrowser(context), message);
        break;
    }
  });
});


