import { testWorkerPorts } from "../../../support/fixtures/run-lifecycle-fixtures.js";

import assert from "node:assert/strict";
import { setImmediate } from "node:timers";
import { afterEach,describe,it } from "vitest";
import { taskStoreRegistry } from "../../../../src/backend/app/registries/task-registry.js";
import {
runWorkerLoop,
type WorkerLoopDependencies
} from "../../../../src/backend/runtime/workers/worker-loop.js";
import { WorkflowIdSchema } from "../../../../src/rules/identity/ids.js";
import { UUID_5,UUID_7 } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { RUN_ID,sequentialIdFactory,WORKFLOW_ID } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { fixtureDuoCeremonyGates } from "../../../support/helpers/duo-ceremony-fixtures.js";
import {
EXECUTOR_WORKER_ID,
happySessionHarness,
healthyCrmDriver,
healthyUcpathDriver,
ManualScheduler,
openAuthorityHarness,
personLookupQueuedRun,
recordingLogger,
recordingTimelineEmitter,
sessionFactoryHarness,
type SessionFactoryHarness,
} from "../../../support/helpers/phase1f-executor-harness.js";
import { personLookupDescriptor } from "../../../support/helpers/registered-workflows.js";

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
