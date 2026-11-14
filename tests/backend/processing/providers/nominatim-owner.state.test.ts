import assert from "node:assert/strict";
import type { ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { afterEach, describe, it } from "vitest";
import { createNominatimService } from "../../../../src/backend/processing/providers/nominatim-owner.js";
import type { NominatimOwnerEvent, NominatimOwnerState } from "../../../../src/backend/processing/providers/nominatim-owner.js";
import { ProviderRequestEnvelopeSchema } from "../../../../src/models/providers/providers.js";
import { IsoInstantSchema } from "../../../../src/rules/identity/ids.js";
import { manualClock, type Clock, type TestClock } from "../../../../src/rules/time/clock.js";

/** Section 4 entry 52, observed through the owner's public operations. */
type Cell =
  | { readonly effect: "queued" | "attached" | "stopping" | "same-promise" | "resolved" | "same-rejection" | "stopped" | "stop-failed" }
  | { readonly refused: "not-stopping" | "adapter-unavailable" | "channel-unavailable" };

const NOT_STOPPING = { refused: "not-stopping" } as const satisfies Cell;
const UNAVAILABLE = { refused: "adapter-unavailable" } as const satisfies Cell;
const CHANNEL = { refused: "channel-unavailable" } as const satisfies Cell;

const expected = {
  running: { request: { effect: "queued" }, attach: { effect: "attached" }, stop: { effect: "stopping" }, drained: NOT_STOPPING, "drain-timeout": NOT_STOPPING },
  stopping: { request: UNAVAILABLE, attach: CHANNEL, stop: { effect: "same-promise" }, drained: { effect: "stopped" }, "drain-timeout": { effect: "stop-failed" } },
  stopped: { request: UNAVAILABLE, attach: CHANNEL, stop: { effect: "resolved" }, drained: NOT_STOPPING, "drain-timeout": NOT_STOPPING },
  "stop-failed": { request: UNAVAILABLE, attach: CHANNEL, stop: { effect: "same-rejection" }, drained: NOT_STOPPING, "drain-timeout": NOT_STOPPING },
} as const satisfies Record<NominatimOwnerState, Record<NominatimOwnerEvent["type"], Cell>>;

const request = ProviderRequestEnvelopeSchema.parse({ capability: "geocode.nominatim", payload: { schemaHash: "a".repeat(64), value: { street: "1 Test Road", country: "US" } } });
const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

function sleep(ms: number): Promise<void> { return new Promise(done => setTimeout(done, ms)); }
function connectedChild(): ChildProcess {
  return Object.assign(new EventEmitter(), { connected: true, send: () => true }) as unknown as ChildProcess;
}
function callOptions(clock: Clock) {
  return { requestId: randomUUID(), signal: new AbortController().signal, deadlineMonotonicMs: clock.monotonicMs() + 60_000 };
}
function synthetic(clock: Clock) {
  return { response: { state: "unavailable" as const, reason: { code: "adapter-unavailable" as const, message: "synthetic" } }, evidence: { summary: "synthetic", capturedAt: IsoInstantSchema.parse(clock.now().toISOString()) } };
}

interface Harness { service: ReturnType<typeof createNominatimService>; clock: TestClock; release: () => void; fetches: () => number; shutdown?: Promise<void> }

function harness(hold: boolean): Harness {
  const clock = manualClock(new Date("2026-01-01T00:00:00.000Z"));
  let release = () => {};
  const gate = new Promise<void>(done => { release = done; });
  let fetches = 0;
  const service = createNominatimService({
    clock,
    fetchFn: async () => { fetches += 1; if (hold) await gate; return Response.json([]); },
    adapter: fetchFn => ({ capability: "geocode.nominatim", invoke: async () => { await fetchFn("https://synthetic.invalid"); return synthetic(clock); } }),
  });
  const opened: Harness = { service, clock, release, fetches: () => fetches };
  cleanups.push(async () => { opened.release(); opened.clock.advanceMonotonic(10_000); await opened.shutdown?.catch(() => {}); await opened.service.stop().catch(() => {}); });
  return opened;
}

async function waitForFetch(opened: Harness): Promise<void> {
  const started = Date.now();
  while (opened.fetches() < 1) {
    if (Date.now() - started > 5_000) throw new Error("nominatim-owner-test-fetch-timed-out");
    await sleep(10);
  }
}

async function reach(phase: NominatimOwnerState): Promise<Harness> {
  if (phase === "running") return harness(false);
  if (phase === "stopped") { const opened = harness(false); await opened.service.stop(); return opened; }
  const opened = harness(true);
  void opened.service.invoke(request, callOptions(opened.clock)).catch(() => {});
  await waitForFetch(opened);
  const shutdown = opened.service.stop();
  opened.shutdown = shutdown;
  if (phase === "stopping") return opened;
  const started = Date.now();
  opened.clock.advanceMonotonic(5_000);
  await assert.rejects(shutdown, /closure-unproven/u);
  assert.ok(Date.now() - started < 2_000, "drain-timeout follows the service clock");
  return opened;
}

async function observe(phase: NominatimOwnerState, event: NominatimOwnerEvent["type"], opened: Harness): Promise<Cell> {
  if (event === "request") {
    const before = opened.fetches();
    await opened.service.invoke(request, callOptions(opened.clock));
    return opened.fetches() > before ? { effect: "queued" } : UNAVAILABLE;
  }
  if (event === "attach") {
    try { opened.service.attach(connectedChild(), { register() {} }); return { effect: "attached" }; }
    catch (error) { if (error instanceof Error && error.message === "nominatim-parent-channel-unavailable") return CHANNEL; throw error; }
  }
  if (event === "stop") return observeStop(phase, opened);
  if (event === "drained") return observeDrained(phase, opened);
  return observeTimeout(phase, opened);
}

async function observeStop(phase: NominatimOwnerState, opened: Harness): Promise<Cell> {
  if (phase === "running") {
    const first = opened.service.stop();
    const second = opened.service.stop();
    let settled = false;
    void first.then(() => { settled = true; }, () => { settled = true; });
    if (first !== second || settled) throw new Error("running stop was not a fresh pending shutdown");
    opened.shutdown = first;
    await first;
    return { effect: "stopping" };
  }
  if (phase === "stopping") {
    const again = opened.service.stop();
    let settled = false;
    void opened.shutdown?.then(() => { settled = true; }, () => { settled = true; });
    if (again !== opened.shutdown || settled) throw new Error("stopping stop did not keep the pending shutdown");
    return { effect: "same-promise" };
  }
  if (phase === "stopped") { await opened.service.stop(); return { effect: "resolved" }; }
  const again = opened.service.stop();
  if (again !== opened.shutdown) throw new Error("stop-failed stop replaced the rejection");
  await assert.rejects(again, /closure-unproven/u);
  return { effect: "same-rejection" };
}

async function observeDrained(phase: NominatimOwnerState, opened: Harness): Promise<Cell> {
  if (phase === "running") { opened.service.attach(connectedChild(), { register() {} }); return NOT_STOPPING; }
  if (phase === "stopped") {
    const before = opened.fetches();
    await opened.service.invoke(request, callOptions(opened.clock));
    return opened.fetches() === before ? NOT_STOPPING : { effect: "queued" };
  }
  if (phase === "stopping") { opened.release(); await opened.shutdown; return { effect: "stopped" }; }
  opened.release();
  await sleep(20);
  const again = opened.service.stop();
  if (again !== opened.shutdown) throw new Error("drained after stop-failed replaced the rejection");
  await assert.rejects(again, /closure-unproven/u);
  return NOT_STOPPING;
}

async function observeTimeout(phase: NominatimOwnerState, opened: Harness): Promise<Cell> {
  const started = Date.now();
  opened.clock.advanceMonotonic(5_000);
  if (phase === "running") { opened.service.attach(connectedChild(), { register() {} }); return NOT_STOPPING; }
  if (phase === "stopping") {
    const shutdown = opened.shutdown;
    if (shutdown === undefined) throw new Error("nominatim-owner-test-missing-shutdown");
    await assert.rejects(shutdown, /closure-unproven/u);
    assert.ok(Date.now() - started < 2_000, "drain-timeout follows the service clock");
    return { effect: "stop-failed" };
  }
  if (phase === "stopped") { await opened.service.stop(); return NOT_STOPPING; }
  const again = opened.service.stop();
  if (again !== opened.shutdown) throw new Error("drain-timeout after stop-failed replaced the rejection");
  await assert.rejects(again, /closure-unproven/u);
  return NOT_STOPPING;
}

describe("geocode owner transition table", () => {
  for (const phase of Object.keys(expected) as NominatimOwnerState[]) {
    for (const event of Object.keys(expected[phase]) as NominatimOwnerEvent["type"][]) {
      it(`${phase} on ${event}`, async () => {
        const opened = await reach(phase);
        assert.deepEqual(await observe(phase, event, opened), expected[phase][event]);
      }, 15_000);
    }
  }
});
