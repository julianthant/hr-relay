import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createWorkerPool, requireStoppedPool, type WorkerExitFact, type WorkerPoolDependencies, type WorkerPoolMember, type WorkerProcessPort } from "../../../../src/backend/runtime/workers/worker-pool.js";
import type { WorkerParentMessage } from "../../../../src/backend/runtime/workers/worker-messages.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { BrowserSessionIdSchema } from "../../../../src/rules/identity/ids.js";

const PROFILE = "6b0e0c36-6a8b-4f6b-9a39-0b6d2b9a1e11";
const member: WorkerPoolMember = { workflowId: "person-lookup", workerId: "person-lookup-worker-1", ordinal: 1, poolIndex: 1 };
const flush = () => new Promise<void>(resolve => { setImmediate(resolve); });

function fakePort(pid: number | undefined = 4242) {
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
  let nextPid: number | undefined = 4242;
  const pool = createWorkerPool({ profileId: PROFILE, sessionGeneration: 3, clock, platform: options.platform ?? "darwin", ids: { uuid: randomUUID },
    timeouts: { readyMs: 1_000, gracefulMs: 2_000, sigtermMs: 3_000, exitObservationMs: 500 },
    scheduler: { schedule(at, run) { const timer = { at, run, cancelled: false }; timers.push(timer); return { cancel() { timer.cancelled = true; } }; } },
    spawn: () => { const port = fakePort(nextPid); ports.push(port); return port.port; },
    settleExit: async (_member, exit) => { settled.push(exit); await options.settle?.(exit); },
    onFault: (_member, error) => { faults.push(error); }, onChange: view => { options.onChange?.(view); } });
  return { pool, ports, settled, faults, clock,
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
    const w = world(), started = w.pool.start(member); await flush();
    await w.advance(1_000);
    assert.deepEqual(w.ports[0]?.kills, ["SIGKILL"]);
    await w.advance(500);
    await assert.rejects(started, { code: "WORKER_EXIT_UNOBSERVED" });
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
    const stopped = w.pool.stop(target, "operator");
    await w.advance(2_000); await w.advance(3_000); await w.advance(500);
    await assert.rejects(stopped, { code: "WORKER_EXIT_UNOBSERVED" });
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
    const late = w.pool.request(target, { type: "close-for-removal" }, 1_000); await flush();
    const third = port.sent.at(-1); assert.ok(third?.kind === "worker-request");
    await w.advance(1_000);
    await assert.rejects(late, { code: "WORKER_REQUEST_TIMED_OUT" });
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

  for (const outcome of ["settled", "failed"] as const) {
    it(`holds Start and shutdown behind a pending first exit settlement (${outcome})`, async () => {
      let release: (error?: Error) => void = () => {};
      const barrier = new Promise<void>((resolve, reject) => { release = error => error === undefined ? resolve() : reject(error); });
      const w = world({ settle: () => barrier });
      const { port } = await running(w);
      port.exit(1, null); await flush();
      assert.equal(w.pool.snapshot()[0]?.state, "exited");
      assert.equal(w.pool.snapshot()[0]?.exit, undefined);
      assert.throws(() => { requireStoppedPool(w.pool.snapshot()); }, { code: "WORKER_EXIT_UNOBSERVED" });
      let stopped = false;
      const all = w.pool.stopAll("shutdown").then(views => { stopped = true; return views; });
      const replacement = w.pool.start(member).then(view => view, (error: unknown) => error);
      await flush(); await flush();
      assert.equal(w.ports.length, 1, "no replacement spawns during the first settlement");
      assert.equal(stopped, false, "shutdown waits for the first settlement");
      release(outcome === "settled" ? undefined : new Error("settlement refused"));
      const views = await all;
      if (outcome === "settled") {
        assert.equal(views[0]?.exit?.settlement, "settled");
        requireStoppedPool(views);
        await flush();
        assert.equal(w.ports.length, 2);
        w.ports[1]?.ready();
        assert.equal(((await replacement) as { state?: string }).state, "running");
      } else {
        assert.throws(() => { requireStoppedPool(views); }, { code: "WORKER_EXIT_SETTLEMENT_FAILED" });
        assert.equal(((await replacement) as { code?: string }).code, "WORKER_EXIT_SETTLEMENT_FAILED");
        assert.equal(w.ports.length, 1);
      }
    });
  }

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
});
