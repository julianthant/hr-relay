import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createWorkerPool, requireStoppedPool, type WorkerExitFact, type WorkerMemberView, type WorkerPoolDependencies, type WorkerPoolMember, type WorkerProcessPort } from "../../../../src/backend/runtime/workers/worker-pool.js";
import type { WorkerParentMessage } from "../../../../src/backend/runtime/workers/worker-messages.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { BrowserSessionIdSchema } from "../../../../src/rules/identity/ids.js";

const PROFILE = "6b0e0c36-6a8b-4f6b-9a39-0b6d2b9a1e11";
const member: WorkerPoolMember = { workflowId: "person-lookup", workerId: "person-lookup-worker-1", ordinal: 1, poolIndex: 1 };
const flush = () => new Promise<void>(resolve => { setImmediate(resolve); });

function fakePort(pid: number | undefined) {
  const sent: WorkerParentMessage[] = [], kills: (string | undefined)[] = [];
  let exitListener: ((code: number | null, signal: string | null) => void) | undefined;
  let errorListener: ((error: Error) => void) | undefined;
  let disconnectListener: (() => void) | undefined;
  let messageListener: ((message: unknown) => void) | undefined;
  const state = { killResult: true, disconnected: false, sendError: null as Error | null };
  const port: WorkerProcessPort = {
    pid,
    send(message, callback) { sent.push(message); callback(state.sendError); },
    kill(signal) { kills.push(signal); return state.killResult; },
    disconnect() { state.disconnected = true; },
    onDisconnect(listener) { disconnectListener = listener; },
    onExit(listener) { exitListener = listener; },
    onError(listener) { errorListener = listener; },
    onWorkerMessage(listener) { messageListener = listener; },
  };
  return { port, sent, kills, state,
    exit(code: number | null = 0, signal: string | null = null) { exitListener?.(code, signal); },
    disconnect() { disconnectListener?.(); },
    error(error: Error) { errorListener?.(error); },
    message(message: unknown) { messageListener?.(message); },
    ready(overrides: Record<string, unknown> = {}) {
      messageListener?.({ kind: "worker-ready", workerId: member.workerId, pid, profileId: PROFILE, sessionGeneration: 3,
        browserSystems: [], activity: { state: "idle" }, ...overrides });
    } };
}

function world(options: Partial<Pick<WorkerPoolDependencies, "platform" | "onChange">> & { settle?: (exit: WorkerExitFact) => void | Promise<void> } = {}) {
  const clock = manualClock(new Date("2026-11-06T12:00:00.000Z"));
  const timers: { at: number; run: () => void; cancelled: boolean }[] = [];
  const ports: ReturnType<typeof fakePort>[] = [];
  const settled: WorkerExitFact[] = [];
  const faults: unknown[] = [];
  const closedStops: unknown[] = [];
  let nextPid: number | undefined = 4242;
  const pool = createWorkerPool({ profileId: PROFILE, sessionGeneration: 3, clock, platform: options.platform ?? "darwin", ids: { uuid: randomUUID },
    timeouts: { readyMs: 1_000, gracefulMs: 2_000, sigtermMs: 3_000, exitObservationMs: 500 },
    scheduler: { schedule(at, run) { const timer = { at, run, cancelled: false }; timers.push(timer); return { cancel() { timer.cancelled = true; } }; } },
    spawn: () => { const port = fakePort(nextPid); ports.push(port); return port.port; },
    settleExit: async (_member, exit) => { settled.push(exit); await options.settle?.(exit); },
    onFault: (_member, error) => { faults.push(error); }, onStopChannelClosed: (_member, error) => { closedStops.push(error); }, onChange: view => { options.onChange?.(view); } });
  return { pool, ports, settled, faults, closedStops, clock,
    set nextPid(value: number | undefined) { nextPid = value; },
    async advance(ms: number) {
      clock.advanceMonotonic(ms);
      for (const timer of timers.filter(entry => !entry.cancelled && entry.at <= clock.monotonicMs()).sort((a, b) => a.at - b.at)) {
        timer.cancelled = true; timer.run();
      }
      await flush();
    } };
}

async function running(w: ReturnType<typeof world>) {
  const started = w.pool.start(member); await flush();
  const port = w.ports.at(-1); assert.ok(port);
  port.ready();
  const view = await started;
  return { port, view, target: { workerId: member.workerId, lifetimeId: view.lifetimeId, expectedVersion: view.version } };
}

describe("worker pool", () => {
  it("starts on a ready message bound to this person and sign-in", async () => {
    const w = world(), { view } = await running(w);
    assert.equal(view.state, "running"); assert.equal(view.pid, 4242); assert.deepEqual(view.activity, { state: "idle" });
  });

  it("kills a child that reports another person or sign-in, and admits it only after its exit", async () => {
    const w = world(), started = w.pool.start(member); await flush();
    const port = w.ports[0]; assert.ok(port);
    port.ready({ sessionGeneration: 2 });
    await flush();
    assert.deepEqual(port.kills, ["SIGKILL"]);
    port.exit(null, "SIGKILL");
    await assert.rejects(started, { code: "WORKER_IDENTITY_MISMATCH" });
    assert.equal(w.settled.length, 1);
  });

  it("stops a child that never reports ready and holds it when no exit is observed", async () => {
    const w = world(), started = assert.rejects(w.pool.start(member), { code: "WORKER_EXIT_UNOBSERVED" }); await flush();
    await w.advance(1_000);
    assert.deepEqual(w.ports[0]?.kills, ["SIGKILL"]);
    await w.advance(500);
    await started;
    await assert.rejects(w.pool.start(member), { code: "WORKER_EXIT_UNOBSERVED" });
    assert.equal(w.settled.length, 0);
  });

  it("treats only a spawn without a pid as never started", async () => {
    const w = world(); w.nextPid = undefined;
    const started = w.pool.start(member); await flush();
    w.ports[0]?.error(new Error("spawn ENOENT"));
    await assert.rejects(started, { code: "WORKER_START_FAILED" });
    assert.equal(w.settled.length, 0);
    w.nextPid = 4243;
    const again = w.pool.start(member); await flush();
    w.ports[1]?.ready({ pid: 4243 });
    assert.equal((await again).state, "running");
  });

  it("keeps a live child after a post-spawn error until its OS exit, with no replacement or settlement before", async () => {
    const w = world(), { port } = await running(w);
    port.error(new Error("lifetime-transfer failed"));
    await flush();
    assert.equal(w.pool.snapshot()[0]?.state, "stopping");
    await assert.rejects(w.pool.start(member), { code: "WORKER_ALREADY_RUNNING" });
    assert.equal(w.settled.length, 0);
    port.exit(1, null); await flush();
    assert.equal(w.settled.length, 1);
    assert.equal(w.pool.snapshot()[0]?.state, "exited");
  });

  it("holds a member whose kill cannot be delivered", async () => {
    const w = world(), { port, target } = await running(w);
    port.state.killResult = false;
    const stopped = assert.rejects(w.pool.stop(target, "operator"), { code: "WORKER_EXIT_UNOBSERVED" });
    await w.advance(2_000); await w.advance(3_000); await w.advance(500);
    await stopped;
    assert.ok(w.pool.snapshot()[0]?.held !== undefined);
    await assert.rejects(w.pool.start(member), { code: "WORKER_EXIT_UNOBSERVED" });
  });

  it("escalates a stop with IPC, then SIGTERM, then SIGKILL on macOS", async () => {
    const w = world(), { port, target } = await running(w);
    const stopped = w.pool.stop(target, "shutdown"); await flush();
    assert.deepEqual(port.sent.at(-1), { kind: "worker-stop", reason: "shutdown", mode: "after-run" });
    await w.advance(2_000); assert.deepEqual(port.kills, ["SIGTERM"]);
    await w.advance(3_000); assert.deepEqual(port.kills, ["SIGTERM", "SIGKILL"]);
    port.exit(null, "SIGKILL");
    assert.equal((await stopped).outcome, "stopped");
  });

  it("escalates a stop with IPC, then TerminateProcess on Windows", async () => {
    const w = world({ platform: "win32" }), { port, target } = await running(w);
    const stopped = w.pool.stop(target, "shutdown"); await flush();
    await w.advance(2_000); assert.deepEqual(port.kills, [undefined]);
    port.exit(1, null);
    assert.equal((await stopped).outcome, "stopped");
  });

  it("finishes a clean stop with exit code 0 before any signal", async () => {
    const w = world(), { port, target } = await running(w);
    const stopped = w.pool.stop(target, "shutdown"); await flush();
    port.exit(0, null);
    const exit = await stopped;
    assert.equal(exit.code, 0); assert.deepEqual(port.kills, []);
  });

  it("refuses a stale lifetime or version", async () => {
    const w = world(), { target } = await running(w);
    await assert.rejects(w.pool.stop({ ...target, lifetimeId: randomUUID() }, "operator"), { code: "WORKER_TARGET_STALE" });
    await assert.rejects(w.pool.stop({ ...target, expectedVersion: target.expectedVersion + 1 }, "operator"), { code: "WORKER_TARGET_STALE" });
  });

  it("answers requests, refuses on timeout, drops late replies and rejects pending ones at exit", async () => {
    const w = world(), { port, target } = await running(w);
    const done = w.pool.request(target, { type: "refresh-browser", browserSessionId: BrowserSessionIdSchema.parse(randomUUID()) }, 1_000); await flush();
    const first = port.sent.at(-1); assert.ok(first?.kind === "worker-request");
    port.message({ kind: "worker-reply", requestId: first.requestId, outcome: { state: "done", result: { browserSessionId: "b" } } });
    assert.deepEqual(await done, { browserSessionId: "b" });
    const refused = w.pool.request(target, { type: "close-for-removal" }, 1_000); await flush();
    const second = port.sent.at(-1); assert.ok(second?.kind === "worker-request");
    port.message({ kind: "worker-reply", requestId: second.requestId, outcome: { state: "refused", code: "WORKER_BUSY", message: "busy" } });
    await assert.rejects(refused, { code: "WORKER_BUSY" });
    const late = assert.rejects(w.pool.request(target, { type: "close-for-removal" }, 1_000), { code: "WORKER_REQUEST_TIMED_OUT" }); await flush();
    const third = port.sent.at(-1); assert.ok(third?.kind === "worker-request");
    await w.advance(1_000);
    await late;
    port.message({ kind: "worker-reply", requestId: third.requestId, outcome: { state: "done", result: null } });
    assert.equal(w.faults.some(error => error instanceof Error && "code" in error && error.code === "WORKER_REQUEST_TIMED_OUT"), true);
    assert.equal(w.pool.snapshot()[0]?.state, "running");
    const pending = w.pool.request(target, { type: "close-for-removal" }, 1_000); await flush();
    port.exit(1, null);
    await assert.rejects(pending, { code: "WORKER_EXITED" });
  });

  it("disconnects and kills a child that sends an invalid worker message", async () => {
    const w = world(), { port } = await running(w);
    port.message({ kind: "worker-activity", activity: { state: "busy" } });
    await flush();
    assert.equal(port.state.disconnected, true); assert.deepEqual(port.kills, ["SIGKILL"]);
  });

  it("retries a failed exit settlement before the next start and refuses while it still fails", async () => {
    let fail = true;
    const w = world({ settle: () => { if (fail) throw new Error("settlement refused"); } }), { port } = await running(w);
    port.exit(1, null); await flush();
    assert.equal(w.pool.snapshot()[0]?.exit?.settlement, "failed");
    await assert.rejects(w.pool.start(member), { code: "WORKER_EXIT_SETTLEMENT_FAILED" });
    fail = false;
    const again = w.pool.start(member); await flush();
    w.ports[1]?.ready();
    assert.equal((await again).state, "running");
    assert.equal(w.settled.length, 3);
  });

  it("faults a member when a request send fails and rejects with that error", async () => {
    const w = world(), { port, target } = await running(w);
    const cause = Object.assign(new Error("ipc closed"), { code: "ERR_IPC_CHANNEL_CLOSED" });
    port.state.sendError = cause;
    const pending = w.pool.request(target, { type: "close-for-removal" }, 1_000);
    await assert.rejects(pending, (error: unknown) => error === cause);
    assert.equal(w.pool.snapshot()[0]?.state, "stopping");
    assert.equal(w.settled.length, 0);
    port.exit(1, null); await flush();
    assert.equal(w.pool.snapshot()[0]?.state, "exited");
    assert.equal(w.settled.length, 1);
  });

  it("records a stop send that hit a closed channel as expected once the member's exit is observed", async () => {
    const w = world(), { port, target } = await running(w);
    port.state.sendError = Object.assign(new Error("write EPIPE"), { code: "EPIPE" });
    const stopping = w.pool.stop(target, "operator"); await flush();
    assert.equal(w.faults.length, 0);
    port.exit(0, null);
    await stopping;
    assert.equal(w.faults.length, 0);
    assert.deepEqual(w.closedStops.map(error => (error as { code?: string }).code), ["EPIPE"]);
  });

  it("still faults a closed-channel stop send when no exit is observed in the window", async () => {
    const w = world(), { port, target } = await running(w);
    port.state.sendError = Object.assign(new Error("channel closed"), { code: "ERR_IPC_CHANNEL_CLOSED" });
    void w.pool.stop(target, "operator"); await flush();
    assert.equal(w.faults.length, 0);
    await w.advance(500);
    assert.equal(w.faults.length, 1);
    assert.equal(w.closedStops.length, 0);
  });

  it("faults at once on any other stop send error", async () => {
    const w = world(), { port, target } = await running(w);
    port.state.sendError = new Error("write failed");
    void w.pool.stop(target, "operator"); await flush();
    assert.equal(w.faults.length, 1);
    assert.equal(w.closedStops.length, 0);
  });

  it("rejects pending requests on disconnect and stays running until the OS exit", async () => {
    const w = world(), { port, target } = await running(w);
    const pending = w.pool.request(target, { type: "close-for-removal" }, 1_000); await flush();
    port.disconnect();
    await assert.rejects(pending, { code: "WORKER_EXITED" });
    assert.equal(w.pool.snapshot()[0]?.state, "running");
    assert.equal(w.settled.length, 0);
    port.exit(0, null); await flush();
    assert.equal(w.pool.snapshot()[0]?.state, "exited");
  });

  it("reserves a workerId while a failed settlement is retried", async () => {
    let settle: (error?: Error) => void = () => {};
    let calls = 0;
    const w = world({ settle: () => {
      calls += 1;
      if (calls === 1) throw new Error("settlement refused");
      return new Promise<void>((resolve, reject) => { settle = error => error === undefined ? resolve() : reject(error); });
    } });
    const { port } = await running(w);
    port.exit(1, null); await flush();
    const first = w.pool.start(member);
    const second = w.pool.start(member);
    await assert.rejects(second, { code: "WORKER_ALREADY_RUNNING" });
    assert.equal(w.ports.length, 1);
    settle(new Error("still refused"));
    await assert.rejects(first, { code: "WORKER_EXIT_SETTLEMENT_FAILED" });
    assert.equal(w.ports.length, 1);
  });

  for (const probe of ["start", "shutdown"] as const) for (const outcome of ["settled", "failed"] as const) {
    it(`holds ${probe} behind a pending first exit settlement (${outcome})`, async () => {
      let release: (error?: Error) => void = () => {};
      const barrier = new Promise<void>((resolve, reject) => { release = error => error === undefined ? resolve() : reject(error); });
      const w = world({ settle: () => barrier });
      const { port } = await running(w);
      port.exit(1, null); await flush();
      assert.equal(w.pool.snapshot()[0]?.state, "exited");
      assert.equal(w.pool.snapshot()[0]?.exit, undefined);
      assert.throws(() => { requireStoppedPool(w.pool.snapshot()); }, { code: "WORKER_EXIT_UNOBSERVED" });
      let done = false;
      const pending = (probe === "start" ? w.pool.start(member) : w.pool.stopAll("shutdown"))
        .then(value => { done = true; return value; }, (error: unknown) => { done = true; return error; });
      await flush(); await flush();
      assert.equal(w.ports.length, 1, "no replacement spawns during the first settlement");
      assert.equal(done, false, `${probe} waits for the first settlement`);
      release(outcome === "settled" ? undefined : new Error("settlement refused"));
      if (probe === "shutdown") {
        const views = await pending as readonly WorkerMemberView[];
        assert.equal(views[0]?.exit?.settlement, outcome);
        if (outcome === "settled") requireStoppedPool(views);
        else assert.throws(() => { requireStoppedPool(views); }, { code: "WORKER_EXIT_SETTLEMENT_FAILED" });
        assert.equal(w.ports.length, 1);
        return;
      }
      if (outcome === "failed") {
        assert.equal(((await pending) as { code?: string }).code, "WORKER_EXIT_SETTLEMENT_FAILED");
        assert.equal(w.ports.length, 1);
        return;
      }
      await flush();
      assert.equal(w.ports.length, 2);
      w.ports[1]?.ready();
      assert.equal(((await pending) as WorkerMemberView).state, "running");
    });
  }

  for (const probe of ["start", "shutdown"] as const) for (const outcome of ["settled", "failed"] as const) {
    it(`holds ${probe} behind the settlement of an exit observed after the observation window closed (${outcome})`, async () => {
      let release: (error?: Error) => void = () => {};
      const barrier = new Promise<void>((resolve, reject) => { release = error => error === undefined ? resolve() : reject(error); });
      const w = world({ settle: () => barrier });
      const { port, target } = await running(w);
      const stopped = assert.rejects(w.pool.stop(target, "operator"), { code: "WORKER_EXIT_UNOBSERVED" }); await flush();
      await w.advance(2_000); await w.advance(3_000); await w.advance(500);
      await stopped;
      assert.equal(w.pool.snapshot()[0]?.held, "exit-unobserved");
      port.exit(null, "SIGKILL"); await flush();
      assert.equal(w.pool.snapshot()[0]?.state, "exited");
      assert.equal(w.pool.snapshot()[0]?.exit, undefined);
      let done = false;
      const pending = (probe === "start" ? w.pool.start(member) : w.pool.stopAll("shutdown"))
        .then(value => { done = true; return value; }, (error: unknown) => { done = true; return error; });
      await flush(); await flush();
      assert.equal(done, false, `${probe} waits for the late exit's settlement`);
      assert.equal(w.ports.length, 1);
      release(outcome === "settled" ? undefined : new Error("settlement refused"));
      if (probe === "shutdown") {
        const views = await pending as readonly WorkerMemberView[];
        assert.equal(views[0]?.exit?.settlement, outcome);
        if (outcome === "settled") requireStoppedPool(views);
        else assert.throws(() => { requireStoppedPool(views); }, { code: "WORKER_EXIT_SETTLEMENT_FAILED" });
        return;
      }
      if (outcome === "failed") {
        assert.equal(((await pending) as { code?: string }).code, "WORKER_EXIT_SETTLEMENT_FAILED");
        assert.equal(w.ports.length, 1);
        return;
      }
      await flush();
      assert.equal(w.ports.length, 2);
      w.ports[1]?.ready();
      assert.equal(((await pending) as WorkerMemberView).state, "running");
    });
  }

  it("stops a replacement a waiting Start publishes while shutdown is sweeping", async () => {
    let release: () => void = () => {};
    const first = new Promise<void>(resolve => { release = resolve; });
    let calls = 0;
    const w = world({ settle: () => (calls += 1) === 1 ? first : undefined });
    const { port } = await running(w);
    port.exit(1, null); await flush();
    const replacement = w.pool.start(member).catch((error: unknown) => error);
    let done = false;
    const all = w.pool.stopAll("shutdown").then(views => { done = true; return views; });
    release(); await flush(); await flush();
    assert.equal(w.ports.length, 2);
    assert.equal(w.ports[1]?.sent.at(-1)?.kind, "worker-stop", "the late replacement is stopped by the same shutdown");
    assert.equal(done, false);
    w.ports[1]?.exit(0, null);
    const views = await all;
    requireStoppedPool(views);
    assert.equal(views[0]?.exit?.outcome, "stopped");
    assert.equal(((await replacement) as { code?: string }).code, "WORKER_EXITED");
  });

  it("keeps the settled prior reserved until its replacement is published", async () => {
    let fail = true;
    const nested: Promise<unknown>[] = [];
    const w = world({ settle: () => { if (fail) throw new Error("settlement refused"); },
      onChange: view => { if (view.state === "exited" && view.exit?.settlement === "settled") nested.push(w.pool.start(member).catch((error: unknown) => error)); } });
    const { port } = await running(w);
    port.exit(1, null); await flush();
    fail = false;
    const again = w.pool.start(member); await flush();
    assert.equal(nested.length, 1);
    assert.equal((await nested[0] as { code?: string }).code, "WORKER_ALREADY_RUNNING");
    assert.equal(w.ports.length, 2);
    w.ports[1]?.ready();
    assert.equal((await again).state, "running");
  });

  it("records pause as its own message and keeps directive apart from a busy run", async () => {
    const w = world(), { port, view, target } = await running(w);
    assert.equal(view.directive, "run");
    const paused = w.pool.pause(target); await flush();
    const message = port.sent.at(-1);
    assert.equal(message?.kind, "worker-pause");
    assert.ok(message?.kind === "worker-pause");
    port.message({ kind: "worker-reply", requestId: message.requestId, outcome: { state: "done", result: { directive: "pause" } } });
    assert.equal((await paused).directive, "pause");
    port.message({ kind: "worker-activity", activity: { state: "busy", runId: "00000000-0000-4000-8000-000000000001" } });
    assert.equal(w.pool.snapshot()[0]?.directive, "pause");
    assert.equal(w.pool.snapshot()[0]?.activity?.state, "busy");
  });

  it("bounds stopAll when a member never exits", async () => {
    const w = world(); await running(w);
    const all = w.pool.stopAll("shutdown"); await flush();
    await w.advance(2_000); await w.advance(3_000); await w.advance(500);
    const views = await all;
    assert.equal(views[0]?.held, "exit-unobserved");
  });

  for (const [label, reason] of [["stop", "operator"], ["stopAll", "shutdown"], ["stopAll", "logout"]] as const) {
    it(`records the ${reason} request as the stopped exit reason (${label})`, async () => {
      const w = world(), { port, target } = await running(w);
      const stopped = label === "stop" ? w.pool.stop(target, reason) : w.pool.stopAll(reason); await flush();
      port.exit(0, null); await stopped;
      assert.equal(w.settled[0]?.outcome, "stopped"); assert.equal(w.settled[0]?.reason, reason);
    });
  }

  it("records a protocol fault as the stopped exit reason", async () => {
    const w = world(), { port } = await running(w);
    port.message({ kind: "worker-activity", activity: { state: "busy" } }); await flush();
    port.exit(null, "SIGKILL"); await flush();
    assert.equal(w.settled[0]?.outcome, "stopped"); assert.equal(w.settled[0]?.reason, "fault");
  });

  it("keeps the first stop reason when a later stop request names another", async () => {
    const w = world(), { port, target } = await running(w);
    const first = w.pool.stop(target, "operator"); await flush();
    const second = w.pool.stopAll("shutdown"); await flush();
    port.exit(0, null); await first; await second;
    assert.equal(w.settled[0]?.reason, "operator");
  });

  it("carries the child's reported failure code on a crash only", async () => {
    const coded = world(), a = await running(coded);
    a.port.message({ kind: "worker-failed", code: "BROWSER_ROOT_UNAVAILABLE" });
    a.port.exit(1, null); await flush();
    assert.equal(coded.settled[0]?.outcome, "crashed"); assert.equal(coded.settled[0]?.failureCode, "BROWSER_ROOT_UNAVAILABLE");
    const plain = world(), b = await running(plain);
    b.port.exit(1, null); await flush();
    assert.equal(plain.settled[0]?.outcome, "crashed"); assert.equal("failureCode" in (plain.settled[0] ?? {}), false);
    const stopped = world(), c = await running(stopped);
    c.port.message({ kind: "worker-failed", code: "BROWSER_ROOT_UNAVAILABLE" });
    const stop = stopped.pool.stop(c.target, "operator"); await flush();
    c.port.exit(0, null); await stop;
    assert.equal(stopped.settled[0]?.outcome, "stopped"); assert.equal("failureCode" in (stopped.settled[0] ?? {}), false);
  });

  it("exposes the browser systems the child reported when ready, and none before", async () => {
    const w = world(), started = w.pool.start(member); await flush();
    assert.equal("browserSystems" in (w.pool.snapshot()[0] ?? {}), false);
    w.ports[0]?.ready({ browserSystems: ["crm", "ucpath"] });
    assert.deepEqual((await started).browserSystems, ["crm", "ucpath"]);
  });

  it("stores a waiting activity detail and faults a detail on a non-waiting state", async () => {
    const w = world(), { port } = await running(w);
    port.message({ kind: "worker-activity", activity: { state: "waiting", waiting: "acquiring" } });
    assert.deepEqual(w.pool.snapshot()[0]?.activity, { state: "waiting", waiting: "acquiring" });
    assert.deepEqual(port.kills, []);
    port.message({ kind: "worker-activity", activity: { state: "idle", waiting: "closing" } }); await flush();
    assert.equal(port.state.disconnected, true); assert.deepEqual(port.kills, ["SIGKILL"]);
  });
});
