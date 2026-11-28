import { DuoTerminalRefusalError } from "../../../../src/backend/systems/browser-shared/login-contract.js";
import { randomUUID } from "node:crypto";
import { createWorkerChildChannel } from "../../../../src/backend/runtime/workers/worker-child-channel.js";
import type { WorkerChildMessage } from "../../../../src/backend/runtime/workers/worker-messages.js";
import { WorkerSessionClosureUnprovedError, WorkerSessionManager } from "../../../../src/backend/runtime/workers/worker-sessions.js";
import { createWorkerDirectiveTestWorld } from "../../../support/helpers/backend/worker-directive-world.js";
import assert from "node:assert/strict";
import { setImmediate } from "node:timers";
import { afterEach, describe, it, vi } from "vitest";
import { runWorkerLoop, WorkerLoopReportSchema } from "../../../../src/backend/runtime/workers/worker-loop.js";
import { UUID_5, UUID_7 } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { RUN_ID } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { RunIdSchema, WorkerIdSchema } from "../../../../src/rules/identity/ids.js";
import { createOcrReviewWorld } from "../../../support/helpers/backend/ocr-review-world.js";
import { testWorkerLifetime } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import { duoCeremonyGatesOver } from "../../../support/helpers/duo-ceremony-fixtures.js";
import { EXECUTOR_EID, EXECUTOR_WORKER_ID, healthyCrmDriver, healthyUcpathDriver, personLookupQueuedRun, sessionFactoryHarness } from "../../../support/helpers/phase1f-executor-harness.js";
import { createDebugEventWriter } from "../../../../src/backend/logs/debug-events.js";
import { descriptorRuntimeNodes } from "../../../../src/workflow-kit/workflow.js";
import { taskStoreRegistry } from "../../../../src/backend/app/registries/task-registry.js";
import { emergencyContactModule, personLookupDescriptor } from "../../../support/helpers/registered-workflows.js";
import { claimWithPreflight } from "../../../../src/backend/app/preflight/worker-admission.js";
import { RunRecordSchema } from "../../../../src/models/run/record.js";
import { OcrPublicationRefusedError } from "../../../../src/backend/runs/lifecycle/ocr-checkpoint-publication.js";
import { requiredPreflightChecks } from "../../../../src/models/preflight/preflight.js";
import { PREFLIGHT_CHECKS } from "../../../../src/models/runtime/runtime-dependencies.js";
import { createPreflightAdmission, PreflightAdmissionScopeSchema } from "../../../../src/rules/preflight/preflight-admission.js";
import { manualClock } from "../../../../src/rules/time/clock.js";

const ocr = createOcrReviewWorld();
afterEach(ocr.cleanup);

const {loopHarness, cleanup } = createWorkerDirectiveTestWorld();

afterEach(async () => { vi.restoreAllMocks(); await cleanup(); });

it("rejects stale and duplicate worker control sequences", async () => {
  const clock = manualClock(new Date("2026-11-06T12:00:00.000Z"));
  const actions: string[] = [];
  const replies: WorkerChildMessage[] = [];
  const unexpected = (): never => { throw new Error("unexpected worker control"); };
  const child = createWorkerChildChannel({
    clock, send: message => { replies.push(message); }, onStop: unexpected,
    handlers: {
      refreshBrowser: unexpected, reopenBrowser: unexpected, checkParkedWrite: unexpected,
      pause: () => { actions.push("pause"); return { directive: "pause" }; },
      resume: () => { actions.push("resume"); return { directive: "run" }; },
      closeForRemoval: async () => { actions.push("close"); return null; },
    },
  });
  const first = { kind: "worker-pause", requestId: randomUUID(), sequence: 1 };
  const second = { kind: "worker-request", requestId: randomUUID(), sequence: 2,
    sentAt: clock.now().toISOString(), deadlineMs: 1_000, request: { type: "close-for-removal" } };
  const stale = { kind: "worker-resume", requestId: randomUUID(), sequence: 1 };
  const duplicate = { kind: "worker-resume", requestId: randomUUID(), sequence: 2 };
  const fresh = { kind: "worker-resume", requestId: randomUUID(), sequence: 3 };

  child.receive(first);
  child.receive(second);
  await new Promise<void>(resolve => setImmediate(resolve));
  for (const message of [first, stale, duplicate, fresh]) child.receive(message);

  const refusal = { state: "refused", code: "WORKER_IPC_PROTOCOL_INVALID", message: "WORKER_IPC_PROTOCOL_INVALID" };
  assert.deepEqual(actions, ["pause", "close", "resume"]);
  assert.deepEqual(replies, [
    { kind: "worker-reply", requestId: first.requestId, outcome: { state: "done", result: { directive: "pause" } } },
    { kind: "worker-reply", requestId: second.requestId, outcome: { state: "done", result: null } },
    ...[first, stale, duplicate].map(message => ({ kind: "worker-reply", requestId: message.requestId, outcome: refusal })),
    { kind: "worker-reply", requestId: fresh.requestId, outcome: { state: "done", result: { directive: "run" } } },
  ]);
});

describe("worker run loop", () => {
  for (const wakeDelivered of [true, false]) it(wakeDelivered
    ? "rechecks for work when a wake arrives during an empty claim"
    : "claims on the idle repoll if the work wake was lost", async () => {
    const h = await loopHarness({ exitWhenIdle: false });
    const empty = Promise.withResolvers<void>(), releaseEmpty = Promise.withResolvers<void>();
    const unexpected = (): never => { throw new Error("unrequested control"); };
    const child = createWorkerChildChannel({ clock: h.authority.clock, send: unexpected, onStop: unexpected,
      handlers: { refreshBrowser: unexpected, reopenBrowser: unexpected, checkParkedWrite: unexpected,
        closeForRemoval: unexpected, pause: unexpected, resume: unexpected } });
    let claims = 0;
    const looping = runWorkerLoop({ ...h.deps, idleRepollMs: 30_000, watchForWork: child.watchForWork,
      claimNext: async (request, sessions) => {
        claims += 1;
        const outcome = await h.deps.claimNext(request, sessions);
        if (claims === 1) { empty.resolve(); await releaseEmpty.promise; }
        if (claims === 3) h.stop.abort();
        return outcome;
      } });
    try {
      await Promise.race([empty.promise, looping]);
      h.authority.database.authority.runs.enqueue(personLookupQueuedRun());
      if (wakeDelivered) child.receive({ kind: "worker-work-available" });
      releaseEmpty.resolve();
      if (!wakeDelivered) {
        await new Promise<void>(resolve => setImmediate(resolve));
        assert.equal(claims, 1);
        const [timer] = h.scheduler.pending();
        assert.ok(timer);
        assert.equal(timer.deadlineMonotonicMs - h.authority.clock.monotonicMs(), 30_000);
        timer.fire();
      }
      assert.deepEqual((await looping).outcomes.map(outcome => outcome.state), ["done"]);
    } finally { releaseEmpty.resolve(); h.stop.abort(); await looping; }
  });

  it("checks queued work immediately when a paused worker resumes", async () => {
    const h = await loopHarness();
    let paused = true;
    const unexpected = (): never => { throw new Error("unrequested control"); };
    const child = createWorkerChildChannel({ clock: h.authority.clock, send: () => undefined, onStop: unexpected,
      handlers: { refreshBrowser: unexpected, reopenBrowser: unexpected, checkParkedWrite: unexpected,
        closeForRemoval: unexpected, pause: unexpected, resume: () => { paused = false; return { directive: "run" }; } } });
    h.authority.database.authority.runs.enqueue(personLookupQueuedRun());
    const looping = runWorkerLoop({ ...h.deps, watchForWork: child.watchForWork, controlPoll: () => paused ? "pause" : "run" });
    try {
      assert.equal(h.authority.database.authority.runs.get(RUN_ID)?.lifecycle.state, "queued");
      assert.equal(h.scheduler.pending().length, 1);
      child.receive({ kind: "worker-resume", requestId: randomUUID(), sequence: 1 });
      assert.deepEqual((await looping).outcomes.map(outcome => outcome.state), ["done"]);
    } finally { h.stop.abort(); await looping; }
  });

  for (const removalRefused of [false, true]) it(removalRefused
    ? "claims work admitted during a removal close as soon as the close refuses"
    : "claims work admitted during a browser control as soon as the control settles", async () => {
    const h = await loopHarness({ exitWhenIdle: false });
    const control = Promise.withResolvers<null>();
    const unexpected = (): never => { throw new Error("unrequested control"); };
    const child = createWorkerChildChannel({ clock: h.authority.clock, send: () => undefined, onStop: unexpected,
      handlers: { refreshBrowser: () => control.promise, reopenBrowser: unexpected, checkParkedWrite: unexpected,
        closeForRemoval: () => control.promise, pause: unexpected, resume: unexpected } });
    const looping = runWorkerLoop({ ...h.deps, idleRepollMs: 30_000, watchForWork: child.watchForWork,
      claimTurn: { begin: child.beginRun, end: child.endRun } });
    const readRun = () => h.authority.database.authority.runs.get(RUN_ID);
    try {
      await new Promise<void>(resolve => setImmediate(resolve));
      const [idle] = h.scheduler.pending();
      assert.ok(idle);
      child.receive({ kind: "worker-request", requestId: randomUUID(), sequence: 1,
        sentAt: h.authority.clock.now().toISOString(), deadlineMs: 10_000,
        request: removalRefused ? { type: "close-for-removal" } : { type: "refresh-browser", browserSessionId: randomUUID() } });
      h.authority.database.authority.runs.enqueue(personLookupQueuedRun());
      child.receive({ kind: "worker-work-available" });
      await new Promise<void>(resolve => setImmediate(resolve));
      assert.equal(readRun()?.lifecycle.state, "queued");
      assert.ok(idle.cancelled(), "the admission wake reached the idle claim loop");
      const [waitingForControl] = h.scheduler.pending();
      assert.ok(waitingForControl);
      assert.equal(waitingForControl.deadlineMonotonicMs - h.authority.clock.monotonicMs(), 30_000);

      if (removalRefused) control.reject(new Error("fixture removal close refused"));
      else control.resolve(null);
      await new Promise<void>(resolve => setImmediate(resolve));
      assert.equal(readRun()?.claimGeneration, 1, "the control release should trigger a claim without the idle timer");
      assert.ok(waitingForControl.cancelled());
    } finally { control.resolve(null); h.stop.abort(); await looping; }
  });

  it("fences a new admission after the removal close acknowledges and until Stop", async () => {
    const h = await loopHarness({ exitWhenIdle: false });
    const unexpected = (): never => { throw new Error("unrequested control"); };
    const replies: WorkerChildMessage[] = [];
    let stopRequested = false;
    const child = createWorkerChildChannel({ clock: h.authority.clock, send: message => { replies.push(message); },
      onStop: () => { stopRequested = true; },
      handlers: { refreshBrowser: unexpected, reopenBrowser: unexpected, checkParkedWrite: unexpected,
        closeForRemoval: async () => ({ closed: true }), pause: unexpected, resume: unexpected } });
    const looping = runWorkerLoop({ ...h.deps, idleRepollMs: 30_000, watchForWork: child.watchForWork,
      claimTurn: { begin: child.beginRun, end: child.endRun }, controlPoll: () => stopRequested ? "stop" : "run" });
    const readRun = () => h.authority.database.authority.runs.get(RUN_ID);
    try {
      await new Promise<void>(resolve => setImmediate(resolve));
      const requestId = randomUUID();
      child.receive({ kind: "worker-request", requestId, sequence: 1,
        sentAt: h.authority.clock.now().toISOString(), deadlineMs: 10_000, request: { type: "close-for-removal" } });
      await new Promise<void>(resolve => setImmediate(resolve));
      assert.deepEqual(replies, [{ kind: "worker-reply", requestId, outcome: { state: "done", result: { closed: true } } }]);

      h.authority.database.authority.runs.enqueue(personLookupQueuedRun());
      child.receive({ kind: "worker-work-available" });
      await new Promise<void>(resolve => setImmediate(resolve));
      assert.equal(readRun()?.claimGeneration, 0, "a successfully closed worker must leave the run queued while awaiting Stop");
      const [waitingForStop] = h.scheduler.pending();
      assert.ok(waitingForStop);

      child.receive({ kind: "worker-stop", reason: "remove", mode: "after-run" });
      assert.ok(waitingForStop.cancelled(), "Stop should wake the fenced worker without the idle timer");
      assert.equal((await looping).stopped, "stop-directive");
      assert.equal(readRun()?.lifecycle.state, "queued");
    } finally { h.stop.abort(); await looping; }
  });

  it("stops with a typed preflight refusal before sessions or execution and never repeats the claim", async () => {
    const h = await loopHarness(); let claims = 0;
    const report = await runWorkerLoop({ ...h.deps, claimNext: () => {
      claims++; return { state: "preflight-refused", code: "PREFLIGHT_OBSERVATION_CHANGED", runId: RunIdSchema.parse(RUN_ID) };
    } });
    assert.deepEqual(report, { workerId: h.deps.workerId, workflowId: h.deps.workflowId, outcomes: [], stopped: "preflight-refused",
      closure: "proved", preflightRefusal: { state: "preflight-refused", code: "PREFLIGHT_OBSERVATION_CHANGED", runId: RUN_ID } });
    assert.equal(claims, 1); assert.equal(h.sessions.opens("ucpath"), 0); assert.equal(h.sessions.opens("crm"), 0);
    assert.ok(h.emitter.events().some(event => event.t === "span.ended" && event.kind === "worker" && event.outcome === "failed"));
  });
  for (const code of ["PREFLIGHT_BLOCKED", "PREFLIGHT_OBSERVATION_CHANGED", "PREFLIGHT_TIMEOUT"] as const) it(`keeps a standing worker alive after ${code} and claims when readiness returns`, async () => {
    const h = await loopHarness();
    h.authority.database.authority.runs.enqueue(personLookupQueuedRun());
    let claims = 0;
    const refusalEvents: { code?: string; message?: string }[] = [];
    const debugWriter = createDebugEventWriter({ repository: h.authority.database.authority.timelineEvents, clock: h.authority.clock, build: "test" });
    const summary = code === "PREFLIGHT_BLOCKED" ? "authority.health: authority database is degraded (authority-invariant)" : undefined;
    const looping = runWorkerLoop({ ...h.deps, exitWhenIdle: false,
      debugEvents: { emit: (input, scope, workflow) => {
        const event = input as { area?: string; code?: string; message?: string };
        if (event.area === "worker-admission") refusalEvents.push({ code: event.code, message: event.message });
        return debugWriter.emit(input, scope, workflow);
      } },
      claimNext: (request, sessions) => {
        claims++;
        if (claims === 1) return { state: "preflight-refused", code, runId: RunIdSchema.parse(RUN_ID), ...(summary === undefined ? {} : { summary }) };
        if (claims === 3) h.stop.abort();
        return h.deps.claimNext(request, sessions);
      },
    });
    await new Promise<void>(resolve => setImmediate(resolve));
    const idle = h.scheduler.pending()[0];
    assert.ok(idle);
    idle.fire();
    const report = await looping;
    assert.equal(claims, 3);
    assert.deepEqual(report.outcomes.map(outcome => outcome.state), ["done"]);
    assert.equal(report.stopped, "stop-signal");
    assert.equal(report.preflightRefusal, undefined);
    assert.equal(report.closure, "proved");
    assert.deepEqual(refusalEvents, [{ code, message: summary }]);
  });

  it("doubles the re-poll delay across consecutive preflight refusals up to a minute, then a claim resets it", async () => {
    const h = await loopHarness();
    h.authority.database.authority.runs.enqueue(personLookupQueuedRun());
    const base = 20_000;
    const summary = "Readiness checks blocked this worker.";
    const delays: number[] = [];
    let claims = 0;
    const timeline = h.authority.database.authority.timelineEvents;
    const refusalRows = () => timeline.debugPage({}).flatMap(row =>
      row.payload.kind === "debug" && row.payload.event.area === "worker-admission" ? [row.payload.event] : []);
    const looping = runWorkerLoop({ ...h.deps, exitWhenIdle: false, idleRepollMs: base,
      debugEvents: createDebugEventWriter({ repository: timeline, clock: h.authority.clock, build: "test" }),
      onStanding: refusal => {
        if (refusal !== undefined) delays.push(Date.parse(refusal.retryAt) - h.authority.clock.nowMs());
      },
      claimNext: (request, sessions) => {
        claims += 1;
        if (claims <= 3 || claims === 5) return { state: "preflight-refused", code: "PREFLIGHT_BLOCKED",
          summary: claims === 3 ? "Readiness changed." : summary };
        if (claims >= 6) { h.stop.abort(); return { state: "refused", refusal: { reason: "none-eligible" } }; }
        return h.deps.claimNext(request, sessions);
      },
    });
    const fire = async (expected: number) => {
      await new Promise<void>(resolve => setImmediate(resolve));
      const now = h.authority.clock.monotonicMs();
      const timer = h.scheduler.pending().find(entry => entry.deadlineMonotonicMs - now === expected);
      assert.ok(timer, `delay ${expected}; pending ${h.scheduler.pending().map(entry => entry.deadlineMonotonicMs - now).join(",")}`);
      if (claims === 2) assert.equal(refusalRows().length, 1);
      timer.fire();
    };
    await fire(base);
    await fire(base * 2);
    await fire(base * 3);
    const started = Date.now();
    while (delays.length < 4 && Date.now() - started < 10_000) await new Promise<void>(resolve => setImmediate(resolve));
    assert.deepEqual(delays, [base, base * 2, 60_000, base]);
    await fire(base);
    const report = await looping;
    assert.equal(claims, 6);
    assert.deepEqual(refusalRows().map(row => [row.message, row.omitted]), [
      [summary, undefined], [summary, 1], ["Readiness changed.", undefined], [summary, undefined],
    ]);
    assert.deepEqual(report.outcomes.map(outcome => outcome.state), ["done"]);
    assert.equal(report.stopped, "stop-signal");
  });

  it("resets the refusal delay after an idle poll with nothing eligible", async () => {
    const h = await loopHarness();
    const base = 20_000;
    const delays: number[] = [];
    let claims = 0;
    const looping = runWorkerLoop({ ...h.deps, exitWhenIdle: false, idleRepollMs: base,
      onStanding: refusal => {
        if (refusal !== undefined) delays.push(Date.parse(refusal.retryAt) - h.authority.clock.nowMs());
      },
      claimNext: () => {
        claims += 1;
        if (claims === 1 || claims === 3) return { state: "preflight-refused", code: "PREFLIGHT_TIMEOUT", summary: "A readiness check took too long. Check again." };
        if (claims === 4) h.stop.abort();
        return { state: "refused", refusal: { reason: "none-eligible" } };
      },
    });
    const fire = async (expected: number) => {
      await new Promise<void>(resolve => setImmediate(resolve));
      const now = h.authority.clock.monotonicMs();
      const timer = h.scheduler.pending().find(entry => entry.deadlineMonotonicMs - now === expected);
      assert.ok(timer, `delay ${expected}; pending ${h.scheduler.pending().map(entry => entry.deadlineMonotonicMs - now).join(",")}`);
      timer.fire();
    };
    await fire(base);
    await fire(base);
    await fire(base);
    assert.deepEqual(delays, [base, base]);
    await looping;
    assert.equal(claims, 4);
  });

  for (const fails of [false, true]) it(`admits idle refresh between claims and releases its turn after ${fails ? "failure" : "success"}`, async () => {
    const h = await loopHarness({ exitWhenIdle: false });
    let release: () => void = () => undefined;
    const refreshing = new Promise<void>(resolve => { release = resolve; });
    let refreshStarted = false, claims = 0;
    const sent: WorkerChildMessage[] = [];
    const forbidden = (): never => { throw new Error("unrequested control"); };
    const child = createWorkerChildChannel({ clock: h.authority.clock, send: message => { sent.push(message); }, onStop: () => h.stop.abort(),
      handlers: { refreshBrowser: async () => { refreshStarted = true; await refreshing; if (fails) throw new Error("fixture reset failed"); return null; },
        reopenBrowser: forbidden, checkParkedWrite: forbidden, closeForRemoval: forbidden, pause: forbidden, resume: forbidden } });
    const looping = runWorkerLoop({ ...h.deps, claimTurn: { begin: () => child.beginRun(), end: () => child.endRun() },
      claimNext: (request, sessions) => { claims++; if (claims === 2) h.stop.abort(); return h.deps.claimNext(request, sessions); } });
    try {
      await new Promise<void>(resolve => setImmediate(resolve));
      const requestId = randomUUID();
      child.receive({ kind: "worker-request", requestId, sequence: 1, sentAt: h.authority.clock.now().toISOString(), deadlineMs: 10_000,
        request: { type: "refresh-browser", browserSessionId: randomUUID() } });
      assert.equal(refreshStarted, true);
      assert.equal(child.beginRun(), false);
      const idle = h.scheduler.pending()[0]; assert.ok(idle); idle.fire();
      await new Promise<void>(resolve => setImmediate(resolve));
      assert.equal(claims, 1);
      release();
      await new Promise<void>(resolve => setImmediate(resolve));
      const reply = sent.find(message => message.kind === "worker-reply" && message.requestId === requestId);
      assert.ok(reply?.kind === "worker-reply");
      assert.equal(reply.outcome.state, fails ? "refused" : "done");
      const waiting = h.scheduler.pending()[0]; assert.ok(waiting); waiting.fire();
      const report = await looping;
      assert.equal(claims, 2);
      assert.equal(report.closure, "proved");
    } finally { release(); h.stop.abort(); await looping; }
  });
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

  it("re-polls on the idle cadence with no refusal standing when every claim attempt loses its race", async () => {
    const h = await loopHarness();
    const queued = RunRecordSchema.parse(personLookupQueuedRun());
    h.authority.database.authority.runs.enqueue(queued);
    const scope = PreflightAdmissionScopeSchema.parse({ configSnapshotId: queued.envelope.configSnapshotId, configFingerprint: queued.envelope.configFingerprint,
      descriptorFingerprint: queued.envelope.contractFingerprint, requestedCapabilities: ["executor.run"] });
    const admission = createPreflightAdmission({ clock: h.authority.clock, scheduler: h.scheduler, validate() {},
      runners: () => PREFLIGHT_CHECKS.filter(spec => requiredPreflightChecks(["executor.run"]).includes(spec.id)).map(spec => ({ check: spec.id, kind: spec.runner,
        async run() { return { check: spec.id, state: "healthy" as const, summary: "Fixture healthy" }; } })) });
    const preflight = { admission, currentScope: () => scope, runScope: () => scope, descriptor: () => personLookupDescriptor,
      prepareSession: async () => { throw new Error("no browser session prepares in this race"); } };
    const runtime = h.authority.database.authority.runtimeConfig.get(); assert.ok(runtime);
    const standings: unknown[] = [];
    let preparations = 0, claims = 0;
    const looping = runWorkerLoop({ ...h.deps, exitWhenIdle: false, onStanding: standing => { standings.push(standing); },
      claimNext: request => {
        claims += 1;
        if (claims === 2) h.stop.abort();
        return claimWithPreflight({ preflight, signal: new AbortController().signal, candidateCurrent: () => false,
          prepareRun: async () => { preparations += 1; throw new OcrPublicationRefusedError(); },
          claim: admit => h.deps.lifecycle.claimNext({ commandId: request.commandId, workflow: request.workflow, workerId: request.workerId,
            runtimeConfig: { generation: runtime.generation, settingsRevision: runtime.settingsRevision,
              settingsFingerprint: runtime.settingsFingerprint, configFingerprint: runtime.configFingerprint } }, admit) });
      } });
    const idleTimer = () => h.scheduler.pending().find(entry => entry.deadlineMonotonicMs - h.authority.clock.monotonicMs() === 1_000);
    while (idleTimer() === undefined) await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(preparations, 4);
    idleTimer()?.fire();
    const report = await looping;
    assert.deepEqual(report.outcomes, []);
    assert.equal(report.stopped, "stop-signal");
    assert.equal(report.preflightRefusal, undefined);
    assert.deepEqual(standings.filter(standing => standing !== undefined), []);
    assert.equal(h.authority.database.authority.runs.get(queued.envelope.runId)?.lifecycle.state, "queued");
  });

  for (const recover of [false, true]) it(`claims a cold delegated Person Lookup on an Emergency Contact worker (Duo recovery ${recover})`, async () => {
    // The page-failure fixture pauses just before OCR admits Person Lookup for the surviving page.
    const f = await ocr.fixture({ coordinator: true, record: true, pageCount: 2, employeeIds: [EXECUTOR_EID, null],
      failManualPageOnce: 2, stopAfterPageFailure: true, dryRun: true });
    const signal = new AbortController().signal;
    const admitted = await f.canonical.step(f.parentRun, signal);
    assert.equal(admitted.outcome.state, "yielded-delegation");
    const lookup = f.database.authority.runs.listChildren(f.run.envelope.runId).find(child => child.envelope.workflow === "person-lookup");
    assert.equal(lookup?.lifecycle.state, "queued");
    const home = emergencyContactModule.descriptor;
    const owner = testWorkerLifetime(f.database, home.id, 1);
    const runtime = f.database.authority.runtimeConfig.get(); assert.ok(runtime);
    const starts: string[] = [];
    const discards: string[] = [];
    let claimed = false;
    const report = await runWorkerLoop({
      ...f.harness.deps, workflowId: home.id, workerId: WorkerIdSchema.parse(owner.workerId), descriptor: home,
      lifecycle: f.canonical.lifecycle, stopSignal: signal, heartbeatIntervalMs: 500, idleRepollMs: 1000, exitWhenIdle: true,
      sessionAcquireMs: 30_000, duoCeremony: duoCeremonyGatesOver(f.database, f.clock),
      browserScreenshotCapture: { capture: async () => undefined },
      controlPoll: () => claimed ? "stop" : "run",
      resolveExecution: run => {
        assert.equal(run.envelope.runId, lookup?.envelope.runId);
        return { descriptor: personLookupDescriptor, stores: f.stores };
      },
      claimNext: request => {
        const next = f.canonical.lifecycle.claimNext({ commandId: request.commandId, workflow: request.workflow,
          workerId: request.workerId, runtimeConfig: { generation: runtime.generation,
          settingsRevision: runtime.settingsRevision, settingsFingerprint: runtime.settingsFingerprint, configFingerprint: runtime.configFingerprint } });
        assert.ok("run" in next && next.run.envelope.runId === lookup?.envelope.runId);
        claimed = true;
        return next;
      },
      sessionFactory: {
        ...f.harness.sessions.factory,
        discardProfile: async input => { discards.push(input.system); return { profileDirectory: "/fixture/profile" }; },
        open: async input => {
          const resource = await f.harness.sessions.factory.open(input);
          return { ...resource, authentication: { authenticate: (system, options) => input.duoCeremony.withCeremony(async () => {
            starts.push(system);
            if (recover && starts.length === 1) {
              throw new DuoTerminalRefusalError(system, "synthetic refusal", "https://duosecurity.com/");
            }
            return resource.authentication.authenticate(system, options);
          }) } };
        },
      },
    });
    assert.deepEqual(report.outcomes.map(outcome => outcome.state), ["done"]);
    assert.deepEqual(starts, recover ? ["ucpath", "ucpath", "crm"] : ["ucpath", "crm"]);
    assert.deepEqual(discards, recover ? ["ucpath"] : []);
  });

  it("uses the home descriptor's acquisition cap when a hosted lookup loses its required capture", async () => {
    const harness = await loopHarness();
    harness.authority.database.authority.runs.enqueue(personLookupQueuedRun());
    const report = await runWorkerLoop({
      ...harness.deps,
      descriptor: emergencyContactModule.descriptor,
      resolveExecution: () => ({ descriptor: personLookupDescriptor, stores: taskStoreRegistry }),
      browserScreenshotCapture: { capture: async ({ trigger }) => {
        if (trigger.kind === "task-point" && trigger.nodeId === "searching") throw new Error("synthetic required capture failure");
      } },
    });
    assert.deepEqual(report.outcomes.map(({ state }) => state), ["failed"]);
    assert.equal(report.closure, "proved");
    assert.equal(harness.sessions.opens("ucpath"), 1);
    assert.deepEqual(harness.sessions.closeReasons(), ["worker-stop"]);
  });

  it("keeps sessions across consecutive child runs of one workflow under a parent-workflow home", async () => {
    const harness = await loopHarness();
    const home = emergencyContactModule.descriptor;
    assert.ok(descriptorRuntimeNodes(home).some(node => node.kind === "child-run"));
    harness.authority.database.authority.runs.enqueue(personLookupQueuedRun());
    harness.authority.database.authority.runs.enqueue(personLookupQueuedRun({ runId: UUID_5, itemId: UUID_7 }));
    const report = await runWorkerLoop({ ...harness.deps, descriptor: home,
      resolveExecution: run => run.envelope.workflow === personLookupDescriptor.id ? { descriptor: personLookupDescriptor, stores: taskStoreRegistry } : undefined });
    assert.deepEqual(report.outcomes.map(({ state }) => state), ["done", "done"]);
    assert.equal(report.closure, "proved");
    assert.equal(harness.sessions.opens("ucpath"), 1);
    assert.equal(harness.sessions.opens("crm"), 1);
    assert.deepEqual(harness.sessions.closeReasons(), ["worker-stop", "worker-stop"]);
  });

  it("parks sessions once when a parent-workflow worker finds nothing eligible", async () => {
    const harness = await loopHarness();
    harness.authority.database.authority.runs.enqueue(personLookupQueuedRun());
    const transitions: [string, string, number][] = [];
    const writer = createDebugEventWriter({ clock: harness.authority.clock, repository: harness.authority.database.authority.timelineEvents, build: "test" });
    let claims = 0;
    const looping = runWorkerLoop({ ...harness.deps, exitWhenIdle: false, descriptor: emergencyContactModule.descriptor,
      debugEvents: { emit: (...args) => {
        const written = writer.emit(...args);
        const { payload, occurredAt } = written.record;
        if (payload.kind === "debug" && payload.event.area === "worker-lifecycle" && payload.event.reason !== undefined) {
          transitions.push([payload.event.reason, occurredAt, harness.sessions.closeReasons().length]);
        }
        return written;
      } },
      resolveExecution: run => run.envelope.workflow === personLookupDescriptor.id ? { descriptor: personLookupDescriptor, stores: taskStoreRegistry } : undefined,
      claimNext: (request, sessions) => {
        claims += 1;
        if (claims === 3) harness.stop.abort();
        return harness.deps.claimNext(request, sessions);
      } });
    const idleTimer = () => harness.scheduler.pending().find(entry => entry.deadlineMonotonicMs - harness.authority.clock.monotonicMs() === 1_000);
    while (idleTimer() === undefined) await new Promise<void>(resolve => setImmediate(resolve));
    assert.deepEqual(harness.sessions.closeReasons(), ["parked", "parked"]);
    idleTimer()?.fire();
    const report = await looping;
    assert.deepEqual(report.outcomes.map(({ state }) => state), ["done"]);
    assert.equal(report.closure, "proved");
    const at = harness.authority.clock.now().toISOString();
    assert.deepEqual(transitions, [["worker-idle", at, 0], ["sessions-parking", at, 0]]);
    assert.equal(harness.sessions.opens("ucpath"), 1);
    assert.deepEqual(harness.sessions.closeReasons(), ["parked", "parked"]);
  });

  it("finishes a claim and proves parking when worker lifecycle diagnostics fail", async () => {
    const h = await loopHarness();
    const writer = createDebugEventWriter({ clock: h.authority.clock, repository: h.authority.database.authority.timelineEvents, build: "test" });
    const warn = vi.fn(h.deps.log.warn);
    let polls = 0;
    const looping = runWorkerLoop({ ...h.deps, exitWhenIdle: false, descriptor: emergencyContactModule.descriptor,
      log: { ...h.deps.log, warn },
      resolveExecution: () => ({ descriptor: personLookupDescriptor, stores: taskStoreRegistry }),
      debugEvents: { emit: (input, ...args) => {
        if (typeof input === "object" && input !== null && "area" in input && input.area === "worker-lifecycle") {
          throw new Error("injected diagnostic failure");
        }
        return writer.emit(input, ...args);
      } },
      claimNext: (request, sessions) => {
        polls++;
        if (polls === 2) h.authority.database.authority.runs.enqueue(personLookupQueuedRun());
        if (polls === 3) h.stop.abort();
        return h.deps.claimNext(request, sessions);
      },
    });
    try {
      await Promise.race([looping, new Promise<void>(resolve => setImmediate(resolve))]);
      const timer = h.scheduler.pending()[0];
      assert.ok(timer); timer.fire();
      const report = await looping;
      assert.deepEqual(report.outcomes.map(outcome => outcome.state), ["done"]);
      assert.equal(report.closure, "proved");
      assert.deepEqual(h.sessions.closeReasons(), ["parked", "parked"]);
      assert.ok(warn.mock.calls.some(call => call[1]?.state === "worker-active"));
      assert.ok(warn.mock.calls.some(call => call[1]?.state === "sessions-parking"));
    } finally { h.stop.abort(); await looping; }
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
