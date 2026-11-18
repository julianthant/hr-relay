import assert from "node:assert/strict";

import { ChildProcess, type SendHandle } from "node:child_process";
import { randomUUID } from "node:crypto";
import { afterEach, it } from "vitest";
import { createDebugEventWriter, emitFaultWithCauses } from "../../../../src/backend/logs/debug-events.js";
import { createNominatimService } from "../../../../src/backend/processing/providers/nominatim-owner.js";
import { ProviderRequestEnvelopeSchema } from "../../../../src/models/providers/providers.js";
import { IsoInstantSchema } from "../../../../src/rules/identity/ids.js";
import { machineMonotonicMs, systemClock } from "../../../../src/rules/time/clock.js";
import { scaledMs } from "../../../support/time-scale.js";
import { debugTimelineFixture } from "../../../support/helpers/backend/debug-timeline-fixture.js";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
const request = ProviderRequestEnvelopeSchema.parse({ capability: "geocode.nominatim", payload: { schemaHash: "a".repeat(64), value: { street: "1 Test Road", country: "US" } } });
function options(milliseconds = 10_000, controller = new AbortController()) { return { requestId: randomUUID(), signal: controller.signal, deadlineMonotonicMs: systemClock.monotonicMs() + milliseconds }; }

function connectedChild(send: ChildProcess["send"]): ChildProcess {
  const child = new ChildProcess();
  let connected = true;
  Object.defineProperty(child, "connected", { get: () => connected });
  child.send = send;
  child.disconnect = () => { connected = false; child.emit("disconnect"); };
  return child;
}

it("does not replay a failed adapter construction and permits a new invocation", async () => {
  let calls = 0;
  const service = createNominatimService({ clock: systemClock, adapter: () => { if (++calls === 1) throw new Error("synthetic factory failed before fetch"); return { capability: "geocode.nominatim", invoke: async () => ({ response: { state: "unavailable", reason: { code: "adapter-unavailable", message: "synthetic" } }, evidence: { summary: "synthetic", capturedAt: IsoInstantSchema.parse(systemClock.now().toISOString()) } }) }; } }); cleanups.push(() => service.stop());
  assert.equal((await service.invoke(request, options())).response.state, "unavailable"); assert.equal(calls, 1);
  await service.invoke(request, options()); assert.equal(calls, 2);
});

it("retains pending and rejected stop while an injected fetch remains unsettled", async () => {
  let started = () => {}; const entering = new Promise<void>(done => { started = done; }); let complete = () => {};
  let fetches = 0;
  const service = createNominatimService({ clock: systemClock, adapter: fetchFn => ({ capability: "geocode.nominatim", invoke: async () => {
    await fetchFn("https://synthetic.invalid");
    return {response:{state:"unavailable",reason:{code:"adapter-unavailable",message:"synthetic"}},evidence:{summary:"synthetic",capturedAt:IsoInstantSchema.parse(systemClock.now().toISOString())}};
  } }), fetchFn: async () => { fetches++; started(); return new Promise<Response>(done => { complete = () => done(Response.json([])); }); } });
  const pending = service.invoke(request, options()); await entering;
  const queued = service.invoke(request, options());
  const first = service.stop(); const second = service.stop(); assert.equal(first, second);
  let settled = false; void first.then(() => { settled = true; }, () => { settled = true; });
  await new Promise<void>(done => setTimeout(done, 30)); assert.equal(settled, false);
  assert.equal((await pending).response.state, "unavailable"); assert.equal((await queued).response.state, "unavailable");
  await assert.rejects(first, /closure-unproven/u); assert.equal(service.stop(), first); await assert.rejects(service.stop(), /closure-unproven/u);
  assert.equal(fetches, 1); complete();
  await new Promise<void>(done => setTimeout(done, 20)); assert.equal(fetches, 1);
  await assert.rejects(service.stop(), /closure-unproven/u);
}, scaledMs(10_000));

it("fails a child's in-flight request in the owner on a malformed Nominatim message and never replies to it", async () => {
  let entered = () => {}; const entering = new Promise<void>(done => { entered = done; });
  const outcome = { response: { state: "unavailable" as const, reason: { code: "adapter-unavailable" as const, message: "synthetic" } },
    evidence: { summary: "synthetic", capturedAt: IsoInstantSchema.parse(systemClock.now().toISOString()) } };
  // The request settles by itself after 50 ms unless the owner aborts it first.
  const service = createNominatimService({ clock: systemClock, adapter: () => ({ capability: "geocode.nominatim", invoke: async (_request, call) => {
    entered();
    await new Promise<void>(done => { const timer = setTimeout(done, 50); call.signal.addEventListener("abort", () => { clearTimeout(timer); done(); }, { once: true }); });
    return outcome;
  } }) });
  cleanups.push(() => service.stop());
  const sent: unknown[] = [];
  const child = connectedChild((message: unknown) => { sent.push(message); return true; });
  let receive: ((message: Readonly<{ kind: string }> & Record<string, unknown>) => void) | undefined;
  service.attach(child, { register: (_family, handler) => { receive = message => { handler(message, undefined); }; } });
  assert.ok(receive !== undefined);
  receive({ kind: "nominatim-request", requestId: randomUUID(), deadlineMs: machineMonotonicMs() + 5_000, request });
  await entering;
  receive({ kind: "nominatim-request", requestId: "not-a-request-id" });
  await new Promise<void>(done => setTimeout(done, 100));
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
