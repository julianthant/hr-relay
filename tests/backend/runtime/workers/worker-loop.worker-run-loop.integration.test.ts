import { WorkerSessionClosureUnprovedError, WorkerSessionManager } from "../../../../src/backend/runtime/workers/worker-sessions.js";
import { createWorkerDirectiveTestWorld } from "../../../support/helpers/backend/worker-directive-world.js";
import assert from "node:assert/strict";
import { setImmediate } from "node:timers";
import { afterEach, describe, it, vi } from "vitest";
import { runWorkerLoop, WorkerLoopReportSchema } from "../../../../src/backend/runtime/workers/worker-loop.js";
import { UUID_5, UUID_7 } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { RUN_ID } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { EXECUTOR_WORKER_ID, healthyCrmDriver, healthyUcpathDriver, personLookupQueuedRun, sessionFactoryHarness } from "../../../support/helpers/phase1f-executor-harness.js";

const {loopHarness, cleanup } = createWorkerDirectiveTestWorld();

afterEach(() => { vi.restoreAllMocks(); cleanup(); });

describe("worker run loop", () => {
  it("drains two queued items sequentially — one active item — and closes sessions at stop", async () => {
    const harness = await loopHarness();
    const { database } = harness.authority;
    database.authority.runs.enqueue(personLookupQueuedRun());
    database.authority.runs.enqueue(personLookupQueuedRun({ runId: UUID_5, itemId: UUID_7 }));

    const report = await runWorkerLoop(harness.deps);
    assert.equal(report.stopped, "idle");
    assert.equal(report.closure, "proved");
    assert.deepEqual(report.outcomes.map(({ state }) => state), ["done", "done"]);

    // Warm reuse across sequential items: one session per system for BOTH
    // runs, closed only at worker stop (ref execution-and-sessions ).
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

  it("returns accumulated outcomes and a failed worker span when session closure is unproved", async () => {
    const harness = await loopHarness();
    harness.authority.database.authority.runs.enqueue(personLookupQueuedRun());
    vi.spyOn(WorkerSessionManager.prototype, "closeAll").mockRejectedValue(
      new WorkerSessionClosureUnprovedError(EXECUTOR_WORKER_ID, [new Error("closure fixture")]),
    );
    const report = await runWorkerLoop(harness.deps);
    assert.equal(report.closure, "unproved");
    assert.deepEqual(report.outcomes.map(({ state }) => state), ["done"]);
    assert.ok(harness.emitter.events().some(event => event.t === "span.ended"
      && event.kind === "worker" && event.outcome === "failed"));
  });

  it("rejects unexpected closure errors and preserves loop failures", async () => {
    const harness = await loopHarness();
    const unexpected = new Error("unexpected close failure");
    const close = vi.spyOn(WorkerSessionManager.prototype, "closeAll").mockRejectedValue(unexpected);
    await assert.rejects(runWorkerLoop(harness.deps), error => error === unexpected);
    close.mockRejectedValue(new WorkerSessionClosureUnprovedError(EXECUTOR_WORKER_ID));
    const loopFailure = new Error("claim failed");
    await assert.rejects(runWorkerLoop({ ...harness.deps, claimNext: () => { throw loopFailure; } }),
      error => error === loopFailure);
  });

  it("requires an explicit closure proof classification in the report schema", () => {
    const report = { workerId: "worker-1", workflowId: "person-lookup", outcomes: [], stopped: "idle" };
    assert.equal(WorkerLoopReportSchema.safeParse(report).success, false);
    for (const closure of ["proved", "unproved"]) {
      assert.equal(WorkerLoopReportSchema.safeParse({ ...report, closure }).success, true);
    }
    assert.equal(WorkerLoopReportSchema.safeParse({ ...report, closure: "unknown" }).success, false);
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
    const harness = await loopHarness({ sessions, heartbeatIntervalMs: 500 });
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
    const harness = await loopHarness({ sessions });
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
