import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "vitest";
import { createWorkerChildChannel, type WorkerChildControlHandlers } from "../../../../src/backend/runtime/workers/worker-child-channel.js";
import type { WorkerChildMessage } from "../../../../src/backend/runtime/workers/worker-messages.js";
import { WorkerPoolError } from "../../../../src/backend/runtime/workers/worker-pool.js";
import { manualClock } from "../../../../src/rules/time/clock.js";

const flush = () => new Promise<void>(resolve => { setImmediate(resolve); });

function channel(overrides: Partial<WorkerChildControlHandlers> = {}) {
  const clock = manualClock(new Date("2026-11-06T12:00:00.000Z")), sent: WorkerChildMessage[] = [], stops: string[] = [];
  let release: (() => void) | undefined;
  const handlers: WorkerChildControlHandlers = {
    refreshBrowser: async id => { await new Promise<void>(resolve => { release = resolve; }); return { browserSessionId: id }; },
    reopenBrowser: async id => ({ browserSessionId: id }),
    checkParkedWrite: async () => ({ state: "unknown" }),
    closeForRemoval: async () => null,
    pause: () => ({ directive: "pause" }),
    resume: () => ({ directive: "run" }),
    ...overrides,
  };
  const child = createWorkerChildChannel({ send: message => { sent.push(message); }, clock, handlers, onStop: reason => { stops.push(reason); } });
  const request = (body: unknown, requestId: string = randomUUID(), deadlineMs = 1_000) => {
    child.receive({ kind: "worker-request", requestId, sentAt: clock.now().toISOString(), deadlineMs, request: body });
    return requestId;
  };
  const directive = (kind: "worker-pause" | "worker-resume", requestId: string = randomUUID()) => {
    child.receive({ kind, requestId });
    return requestId;
  };
  const reply = (requestId: string) => {
    const message = sent.find(entry => entry.kind === "worker-reply" && entry.requestId === requestId);
    return message?.kind === "worker-reply" ? message.outcome : undefined;
  };
  const refusal = (requestId: string) => { const outcome = reply(requestId); return outcome?.state === "refused" ? outcome.code : undefined; };
  return { child, clock, sent, stops, request, directive, reply, refusal, release: () => release?.() };
}

it("runs one control at a time and never beside a claimed run, while pause and resume take no turn", async () => {
  const c = channel(), browser = randomUUID();
  const first = c.request({ type: "refresh-browser", browserSessionId: browser });
  assert.equal(c.child.beginRun(), false);
  const second = c.request({ type: "reopen-browser", browserSessionId: browser });
  assert.deepEqual(c.reply(second), { state: "refused", code: "WORKER_BUSY", message: "WORKER_BUSY" });
  const pause = c.directive("worker-pause"); await flush();
  assert.deepEqual(c.reply(pause), { state: "done", result: { directive: "pause" } });
  c.release(); await flush();
  assert.deepEqual(c.reply(first), { state: "done", result: { browserSessionId: browser } });
  assert.equal(c.child.beginRun(), true);
  const busy = c.request({ type: "close-for-removal" });
  assert.equal(c.reply(busy)?.state, "refused");
  const resume = c.directive("worker-resume"); await flush();
  assert.equal(c.reply(resume)?.state, "done");
  c.child.endRun();
  assert.equal(c.child.beginRun(), true);
});

it("refuses a duplicate request id and an expired request without running it", async () => {
  let checks = 0;
  const c = channel({ checkParkedWrite: async () => { checks += 1; return null; } });
  const id = c.request({ type: "check-parked-write", command: {} }); await flush();
  c.request({ type: "check-parked-write", command: {} }, id); await flush();
  const replies = c.sent.filter(message => message.kind === "worker-reply" && message.requestId === id);
  assert.equal(replies.length, 2);
  assert.deepEqual(replies[1]?.kind === "worker-reply" && replies[1].outcome, { state: "refused", code: "WORKER_IPC_PROTOCOL_INVALID", message: "WORKER_IPC_PROTOCOL_INVALID" });
  const sentAt = c.clock.now().toISOString(); c.clock.advanceWall(2_000);
  const expired = randomUUID();
  c.child.receive({ kind: "worker-request", requestId: expired, sentAt, deadlineMs: 1_000, request: { type: "check-parked-write", command: {} } });
  assert.equal(c.refusal(expired), "WORKER_REQUEST_EXPIRED");
  assert.equal(checks, 1);
});

it("replies with a handler's catalog code, INTERNAL_FAILURE otherwise, and fails loud on a malformed message", async () => {
  const c = channel({ closeForRemoval: async () => { throw new WorkerPoolError("WORKER_BUSY"); },
    reopenBrowser: async () => { throw new Error("private detail"); } });
  const coded = c.request({ type: "close-for-removal" }); await flush();
  const plain = c.request({ type: "reopen-browser", browserSessionId: randomUUID() }); await flush();
  assert.equal(c.refusal(coded), "WORKER_BUSY");
  assert.equal(c.refusal(plain), "INTERNAL_FAILURE");
  assert.equal(JSON.stringify(c.sent).includes("private detail"), false);
  assert.throws(() => { c.child.receive({ kind: "worker-request", requestId: "not-a-uuid" }); }, { code: "WORKER_IPC_PROTOCOL_INVALID" });
  c.child.receive({ kind: "worker-stop", reason: "shutdown", mode: "after-run" });
  assert.deepEqual(c.stops, ["shutdown"]);
});
