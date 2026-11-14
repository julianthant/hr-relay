import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach, describe, it } from "vitest";
import { RunRecordService } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { WORK_CONTROL_POLL_MS, runWorkerLoop } from "../../../../src/backend/runtime/workers/worker-loop.js";
import { lifecycleCommandId } from "../../../../src/rules/commands/lifecycle-command-id.js";
import { RUN_ID, sequentialIdFactory, WORKFLOW_ID } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { healthyCrmDriver, healthyUcpathDriver, personLookupQueuedRun, sessionFactoryHarness } from "../../../support/helpers/phase1f-executor-harness.js";
import { createWorkerDirectiveTestWorld } from "../../../support/helpers/backend/worker-directive-world.js";

const world = createWorkerDirectiveTestWorld();
afterEach(world.cleanup);

const tick = () => new Promise<void>(resolve => { setImmediate(resolve); });
const NEXT_RUN_ID = "ffffffff-ffff-4fff-8fff-fffffffffffe";

/** The first crm call settles only when its browser closes; every later call (and every ucpath call) is the healthy driver. */
function blockingReadFixture() {
  const invocations: string[] = [];
  let blockedMethod: string | undefined;
  let closeBrowser = (): void => undefined;
  let enter!: () => void;
  const blocked = new Promise<void>(resolve => { enter = resolve; });
  const wrap = <Driver extends object>(driver: Driver, system: "ucpath" | "crm"): Driver => Object.fromEntries(
    Object.entries(driver).map(([key, value]: [string, unknown]) => typeof value !== "function" ? [key, value] : [key, (...args: unknown[]) => {
      invocations.push(`${system}.${key}`);
      if (system === "crm" && blockedMethod === undefined) {
        blockedMethod = `crm.${key}`;
        enter();
        return new Promise<never>((_resolve, reject) => { closeBrowser = () => { reject(new Error("Target page, context or browser has been closed")); }; });
      }
      return (value as (...a: unknown[]) => unknown).apply(driver, args);
    }])) as Driver;
  const sessions = sessionFactoryHarness({
    ucpath: () => wrap(healthyUcpathDriver(), "ucpath"),
    crm: () => wrap(healthyCrmDriver(), "crm"),
  });
  return {
    sessions, blocked,
    closeBrowser: () => { closeBrowser(); },
    blockedInvocations: () => invocations.filter(name => name === blockedMethod).length,
    readerInvocations: () => invocations.filter(name => name === "ucpath.searchPersonOrg").length,
  };
}

type Harness = Awaited<ReturnType<typeof world.loopHarness>>;

function controls(h: Harness) {
  const database = h.authority.database, workerId = h.deps.workerId, clock = h.authority.clock;
  const lifecycle = new RunRecordService({ database, clock, ids: sequentialIdFactory("e"), publishQueued: () => undefined });
  const run = () => { const current = database.authority.runs.get(RUN_ID); assert.ok(current); return current; };
  const taskSpans = (t: "span.started" | "span.ended") => h.emitter.events().flatMap(event => event.t === t && event.kind === "task" ? [event] : []);
  const blockedNode = () => {
    const started = taskSpans("span.started").at(-1);
    const node = /\/([^/#]+)#\d+\.\d+$/.exec(started?.spanPath ?? "")?.[1];
    assert.ok(node);
    return node;
  };
  const checkpoint = (nodeId: string) => database.authority.runCheckpoints.latest(WORKFLOW_ID, run().envelope.itemId, nodeId);
  const endedOutcomes = (nodeId: string) => taskSpans("span.ended").flatMap(event => event.t === "span.ended" && event.spanPath.includes(`/${nodeId}#`) ? [event.outcome] : []);
  const setPaused = (paused: boolean) => {
    database.authority.workerSlots.setPaused({ workerId, paused, now: clock.now().toISOString() });
  };
  const requestCancel = () => {
    const requested = lifecycle.transition({ commandId: lifecycleCommandId("fixture-cancel-request", RUN_ID), runId: RUN_ID,
      expectedVersion: run().version, lifecycle: { state: "terminal", outcome: "cancelled", endedAt: clock.now().toISOString() } });
    assert.equal(requested.state, "applied");
    assert.equal(run().cancelRequested, true);
  };
  const pauseRun = (commandId: string) => {
    const result = lifecycle.pause({ commandId, runId: RUN_ID, expectedVersion: run().version });
    assert.equal(result.state, "applied");
  };
  const resume = () => assert.equal(lifecycle.resumePaused({ commandId: randomUUID(), runId: RUN_ID, expectedVersion: run().version }).state, "applied");
  const isPausedAndQueued = () => { const r = run(); return r.lifecycle.state === "queued" && r.pause?.state === "paused"; };
  const isTerminal = (outcome: "done" | "cancelled") => () => { const r = run(); return r.lifecycle.state === "terminal" && r.lifecycle.outcome === outcome; };
  return { database, workerId, clock, lifecycle, run, taskSpans, blockedNode, checkpoint, endedOutcomes, setPaused, requestCancel, pauseRun, resume, isPausedAndQueued, isTerminal };
}

/** Fires the work-control poll and idle re-poll timers (never heartbeats) until the condition holds. */
async function pump(h: Harness, until: () => boolean): Promise<void> {
  for (let i = 0; i < 400; i++) {
    if (until()) return;
    const now = h.authority.clock.monotonicMs();
    for (const timer of h.scheduler.pending()) {
      const delay = timer.deadlineMonotonicMs - now;
      if ((delay === WORK_CONTROL_POLL_MS || delay === h.deps.idleRepollMs) && !timer.cancelled()) timer.fire();
    }
    await tick();
  }
  assert.fail("condition not reached while pumping the work-control poll");
}

async function finish(h: Harness, loop: ReturnType<typeof runWorkerLoop>): Promise<void> {
  h.stop.abort(new Error("test done"));
  await loop;
}

describe("Pause and Stop cancel the current read step (ref workers-pause-cancels-step)", () => {
  it("row Pause mid-read cancels the step and Resume restarts it", async () => {
    const fx = blockingReadFixture();
    const h = await world.loopHarness({ sessions: fx.sessions, exitWhenIdle: false });
    const c = controls(h);
    c.database.authority.runs.enqueue(personLookupQueuedRun());
    const loop = runWorkerLoop({ ...h.deps });
    try {
      await fx.blocked;
      const node = c.blockedNode();
      c.pauseRun(randomUUID());
      assert.equal(c.run().pause?.state, "requested");
      await pump(h, c.isPausedAndQueued);

      assert.deepEqual(c.endedOutcomes(node), ["cancelled"]);
      assert.ok(c.checkpoint("searching"));
      assert.equal(c.checkpoint(node), undefined);
      assert.equal(fx.blockedInvocations(), 1);

      c.resume();
      await pump(h, c.isTerminal("done"));
      assert.equal(fx.blockedInvocations(), 2);
      assert.equal(fx.readerInvocations(), 1);
      assert.ok(c.checkpoint(node));
    } finally { await finish(h, loop); }
    const report = await loop;
    assert.deepEqual(report.outcomes.map(outcome => outcome.state), ["abandoned", "done"]);
    const paused = report.outcomes[0];
    assert.ok(paused?.state === "abandoned");
    assert.match(paused.reason, /paused/);
  });

  it("Resume after the worker cancelled the step for a pause withdraws it and restarts the step from its checkpoint", async () => {
    const fx = blockingReadFixture();
    const h = await world.loopHarness({ sessions: fx.sessions, exitWhenIdle: false });
    const c = controls(h);
    c.database.authority.runs.enqueue(personLookupQueuedRun());
    const loop = runWorkerLoop({ ...h.deps });
    try {
      await fx.blocked;
      const node = c.blockedNode();
      c.pauseRun(randomUUID());
      const now = h.authority.clock.monotonicMs();
      const polls = h.scheduler.pending().filter(timer => timer.deadlineMonotonicMs - now === WORK_CONTROL_POLL_MS && !timer.cancelled());
      assert.equal(polls.length, 1);
      polls[0]?.fire();
      // The worker has aborted the step; Resume lands before the executor settles the pause.
      c.resume();
      assert.equal(c.run().pause, undefined);
      await pump(h, c.isTerminal("done"));
      assert.deepEqual(c.endedOutcomes(node), ["cancelled", "done"]);
      assert.equal(fx.blockedInvocations(), 2);
      assert.equal(fx.readerInvocations(), 1);
    } finally { await finish(h, loop); }
    const report = await loop;
    assert.deepEqual(report.outcomes.map(outcome => outcome.state), ["abandoned", "done"]);
    const withdrawn = report.outcomes[0];
    assert.ok(withdrawn?.state === "abandoned");
    assert.equal(withdrawn.reason, "resumed");
  });

  it("worker Pause (directive + run pause) cancels the step and claims nothing until resumed", async () => {
    const fx = blockingReadFixture();
    const h = await world.loopHarness({ sessions: fx.sessions, exitWhenIdle: false });
    const c = controls(h);
    c.database.authority.runs.enqueue(personLookupQueuedRun());
    c.database.authority.runs.enqueue(personLookupQueuedRun({ runId: NEXT_RUN_ID, itemId: randomUUID() }));
    assert.ok(RUN_ID < NEXT_RUN_ID);
    const loop = runWorkerLoop({ ...h.deps, controlPoll: () => {
      const slot = c.database.authority.workerSlots.get(c.workerId); assert.ok(slot);
      return slot.paused ? "pause" : "run";
    } });
    try {
      await fx.blocked;
      const node = c.blockedNode();
      const { claimGeneration } = c.run();
      c.setPaused(true);
      c.pauseRun(lifecycleCommandId("worker-pause", { workerId: c.workerId, runId: RUN_ID, claimGeneration }));
      await pump(h, c.isPausedAndQueued);

      assert.deepEqual(c.endedOutcomes(node), ["cancelled"]);
      assert.ok(c.checkpoint("searching"));
      assert.equal(c.checkpoint(node), undefined);
      for (let i = 0; i < 10; i++) {
        for (const timer of h.scheduler.pending()) {
          if (timer.deadlineMonotonicMs - h.authority.clock.monotonicMs() === h.deps.idleRepollMs && !timer.cancelled()) timer.fire();
        }
        await tick();
      }
      assert.equal(c.run().lifecycle.state, "queued");
      assert.equal(c.database.authority.runs.get(NEXT_RUN_ID)?.lifecycle.state, "queued");
      assert.equal(fx.blockedInvocations(), 1);

      c.setPaused(false);
      c.resume();
      const nextDone = () => { const next = c.database.authority.runs.get(NEXT_RUN_ID); return next?.lifecycle.state === "terminal" && next.lifecycle.outcome === "done"; };
      await pump(h, () => c.isTerminal("done")() && nextDone());
      // The held run restarts its cancelled step once and replays its search; the next run reads once each.
      assert.equal(fx.blockedInvocations(), 3);
      assert.equal(fx.readerInvocations(), 2);
    } finally { await finish(h, loop); }
  });

  it("Stop mid-read ends the run at the previous step", async () => {
    const fx = blockingReadFixture();
    const h = await world.loopHarness({ sessions: fx.sessions, exitWhenIdle: false });
    const c = controls(h);
    c.database.authority.runs.enqueue(personLookupQueuedRun());
    const loop = runWorkerLoop({ ...h.deps });
    try {
      await fx.blocked;
      const node = c.blockedNode();
      const startedBefore = c.taskSpans("span.started").length;
      c.requestCancel();
      await pump(h, () => c.endedOutcomes(node).includes("cancelled"));
      fx.closeBrowser();
      await pump(h, c.isTerminal("cancelled"));

      assert.deepEqual(c.endedOutcomes(node), ["cancelled"]);
      assert.ok(c.checkpoint("searching"));
      assert.equal(c.checkpoint(node), undefined);
      assert.equal(fx.blockedInvocations(), 1);
      assert.equal(c.taskSpans("span.started").length, startedBefore);
    } finally { await finish(h, loop); }
  });

  it("row Cancel mid-read cancels the step at once", async () => {
    const fx = blockingReadFixture();
    const h = await world.loopHarness({ sessions: fx.sessions, exitWhenIdle: false });
    const c = controls(h);
    c.database.authority.runs.enqueue(personLookupQueuedRun());
    const loop = runWorkerLoop({ ...h.deps });
    try {
      await fx.blocked;
      const node = c.blockedNode();
      const startedBefore = c.taskSpans("span.started").length;
      c.requestCancel();
      await pump(h, c.isTerminal("cancelled"));

      assert.deepEqual(c.endedOutcomes(node), ["cancelled"]);
      assert.equal(c.checkpoint(node), undefined);
      assert.equal(fx.blockedInvocations(), 1);
      assert.equal(c.taskSpans("span.started").length, startedBefore);
    } finally { await finish(h, loop); }
  });
});
