import assert from "node:assert/strict";

import { ChildProcess, type SendHandle } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { afterEach, it, vi } from "vitest";
import { createDebugEventWriter, emitFaultWithCauses } from "../../../../src/backend/logs/debug-events.js";
import { createNominatimService } from "../../../../src/backend/processing/providers/nominatim-owner.js";
import { ProviderRequestEnvelopeSchema } from "../../../../src/models/providers/providers.js";
import { IsoInstantSchema } from "../../../../src/rules/identity/ids.js";
import { machineMonotonicMs, manualClock, systemClock } from "../../../../src/rules/time/clock.js";
import { scaledMs } from "../../../support/time-scale.js";
import { debugTimelineFixture } from "../../../support/helpers/backend/debug-timeline-fixture.js";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
const request = ProviderRequestEnvelopeSchema.parse({ capability: "geocode.nominatim", payload: { schemaHash: "a".repeat(64), value: { street: "1 Test Road", country: "US" } } });
function options(clock = systemClock) { return { requestId: randomUUID(), signal: new AbortController().signal, deadlineMonotonicMs: clock.monotonicMs() + 10_000 }; }

function connectedChild(send: ChildProcess["send"]): ChildProcess {
  const child = new ChildProcess();
  let connected = true;
  Object.defineProperty(child, "connected", { get: () => connected });
  child.send = send;
  child.disconnect = () => { connected = false; child.emit("disconnect"); };
  return child;
}

it("closes the worker channel and reports a rejected invocation without an unhandled rejection", async () => {
  const failure = new Error("synthetic clock failure");
  const service = createNominatimService({
    clock: { ...systemClock, now: () => { throw failure; } },
    adapter: () => { throw new Error("synthetic adapter failure"); },
  });
  cleanups.push(() => service.stop());

  const sent: unknown[] = [];
  const child = connectedChild((message: unknown) => { sent.push(message); return true; });
  const fault: Promise<unknown[]> = once(child, "error", { signal: AbortSignal.timeout(scaledMs(5_000)) });
  service.attach(child, {
    register: (_family, handler) => {
      const message = { kind: "nominatim-request", requestId: randomUUID(), deadlineMs: machineMonotonicMs() + scaledMs(10_000), request };
      queueMicrotask(() => handler(message, undefined));
    },
  });
  const [error] = await fault;
  assert.equal(error, failure);
  assert.equal(child.connected, false);
  assert.deepEqual(sent, []);
}, scaledMs(10_000));

it("does not replay a failed adapter construction and permits a new invocation", async () => {
  let calls = 0;
  const service = createNominatimService({ clock: systemClock, adapter: () => { if (++calls === 1) throw new Error("synthetic factory failed before fetch"); return { capability: "geocode.nominatim", invoke: async () => ({ response: { state: "unavailable", reason: { code: "adapter-unavailable", message: "synthetic" } }, evidence: { summary: "synthetic", capturedAt: IsoInstantSchema.parse(systemClock.now().toISOString()) } }) }; } }); cleanups.push(() => service.stop());
  assert.equal((await service.invoke(request, options())).response.state, "unavailable"); assert.equal(calls, 1);
  await service.invoke(request, options()); assert.equal(calls, 2);
});

it("retains pending and rejected stop while an injected fetch remains unsettled", async () => {
  const entering = Promise.withResolvers<void>(), release = Promise.withResolvers<void>(), drained = Promise.withResolvers<void>();
  const clock = manualClock(new Date("2026-01-01T00:00:00.000Z"));
  let fetches = 0;
  const service = createNominatimService({ clock, adapter: fetchFn => ({ capability: "geocode.nominatim", invoke: async () => {
    await fetchFn("https://synthetic.invalid");
    drained.resolve();
    return {response:{state:"unavailable",reason:{code:"adapter-unavailable",message:"synthetic"}},evidence:{summary:"synthetic",capturedAt:IsoInstantSchema.parse(clock.now().toISOString())}};
  } }), fetchFn: async () => { fetches++; entering.resolve(); await release.promise; return Response.json([]); } });
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "hrtime"] });
  try {
    const pending = service.invoke(request, options(clock));
    let entered = false;
    void entering.promise.then(() => { entered = true; });
    await vi.advanceTimersByTimeAsync(1000);
    assert.equal(entered, true, "nominatim owner did not enter its first paced fetch");
    const queued = service.invoke(request, options(clock));
    const first = service.stop(); const second = service.stop(); assert.equal(first, second);
    let settled = false; void first.then(() => { settled = true; }, () => { settled = true; });
    assert.equal((await pending).response.state, "unavailable"); assert.equal((await queued).response.state, "unavailable");
    assert.equal(settled, false);
    clock.advanceMonotonic(5_000);
    await vi.advanceTimersByTimeAsync(1);
    assert.equal(settled, true, "nominatim owner did not settle at its service-clock deadline");
    await assert.rejects(first, /closure-unproven/u); assert.equal(service.stop(), first); await assert.rejects(service.stop(), /closure-unproven/u);
    assert.equal(fetches, 1); release.resolve();
    await drained.promise;
    assert.equal(fetches, 1);
    await assert.rejects(service.stop(), /closure-unproven/u);
  } finally {
    release.resolve();
    const shutdown = service.stop().catch((error: unknown) => { if (!(error instanceof Error) || error.message !== "nominatim-owner-closure-unproven") throw error; });
    try {
      await vi.advanceTimersByTimeAsync(1);
      await shutdown;
    } finally { vi.useRealTimers(); }
  }
}, scaledMs(10_000));

it("fails a child's in-flight request in the owner on a malformed Nominatim message and never replies to it", async () => {
  const entering = Promise.withResolvers<AbortSignal>(), release = Promise.withResolvers<void>();
  const outcome = { response: { state: "unavailable" as const, reason: { code: "adapter-unavailable" as const, message: "synthetic" } },
    evidence: { summary: "synthetic", capturedAt: IsoInstantSchema.parse(systemClock.now().toISOString()) } };
  const service = createNominatimService({ clock: systemClock, adapter: () => ({ capability: "geocode.nominatim", invoke: async (_request, call) => {
    entering.resolve(call.signal);
    await release.promise;
    return outcome;
  } }) });
  cleanups.push(async () => { release.resolve(); await service.stop(); });
  const sent: unknown[] = [];
  const child = connectedChild((message: unknown) => { sent.push(message); return true; });
  let receive: ((message: Readonly<{ kind: string }> & Record<string, unknown>) => void) | undefined;
  service.attach(child, { register: (_family, handler) => { receive = message => { handler(message, undefined); }; } });
  assert.ok(receive !== undefined);
  receive({ kind: "nominatim-request", requestId: randomUUID(), deadlineMs: machineMonotonicMs() + 5_000, request });
  const signal = await entering.promise;
  receive({ kind: "nominatim-request", requestId: "not-a-request-id" });
  assert.equal(signal.aborted, true);
  release.resolve();
  await service.stop();
  assert.deepEqual(sent, []);
});

it("reports a failed Nominatim reply send through the child process error event", async () => {
  const outcome = {
    response: { state: "unavailable" as const, reason: { code: "adapter-unavailable" as const, message: "synthetic" } },
    evidence: { summary: "synthetic", capturedAt: IsoInstantSchema.parse(systemClock.now().toISOString()) },
  };
  const service = createNominatimService({
    clock: systemClock,
    adapter: () => ({ capability: "geocode.nominatim", invoke: async () => outcome }),
  });
  cleanups.push(() => service.stop());

  const failure = Object.assign(new Error("synthetic broken pipe"), { code: "EPIPE" });
  const errors: Error[] = [];
  const sent: unknown[] = [];
  const { records, repository } = debugTimelineFixture();
  const writer = createDebugEventWriter({ repository, clock: systemClock, build: "test" });
  const attempted = Promise.withResolvers<void>();
  const requestId = randomUUID();
  const child = connectedChild((message: unknown, callback?: SendHandle | ((error: Error | null) => void)) => {
    assert.ok(typeof callback === "function");
    sent.push(message);
    queueMicrotask(() => { callback(failure); attempted.resolve(); });
    return false;
  });
  child.on("error", error => {
    errors.push(error);
    emitFaultWithCauses(writer, undefined, error,
      { category: "worker", area: "supervisor", code: "WORKER_SUPERVISOR_FAILED", reason: "supervisor-failed" });
  });
  const router = { register: (_family: string, handler: (message: Readonly<{ kind: string }>, handle: unknown) => void) => {
    const message = { kind: "nominatim-request", requestId, deadlineMs: machineMonotonicMs() + 5_000, request };
    queueMicrotask(() => handler(message, undefined));
  } };
  service.attach(child, router);
  await attempted.promise;

  assert.deepEqual(sent, [{ kind: "nominatim-reply", requestId, outcome }]);
  assert.equal(errors.length, 1);
  assert.equal(errors[0]?.message, "nominatim-reply-send-failed");
  assert.equal(errors[0]?.cause, failure);
  assert.equal(child.connected, false);
  const diagnostics = records.flatMap(record => record.payload.kind === "debug" ? [record.payload.event] : []);
  assert.deepEqual(diagnostics.map(({ code, message }) => [code, message]), [
    ["WORKER_SUPERVISOR_FAILED", undefined],
    ["INTERNAL_FAILURE", "NominatimReplySendError"],
    ["EPIPE", "Error"],
  ]);
  assert.equal(JSON.stringify(diagnostics).includes(failure.message), false);
});
