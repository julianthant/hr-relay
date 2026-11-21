import assert from "node:assert/strict";
import { afterEach, describe, it, vi } from "vitest";
import { probeOwnedViteServer } from "../../../../src/backend/app/host/local-vite-probe.js";
import { manualClock } from "../../../../src/rules/time/clock.js";

const CLOCK = manualClock(new Date("2026-08-28T09:00:00.000-07:00"));

afterEach(() => { vi.unstubAllGlobals(); });

function heldBody(first?: Uint8Array): { body: ReadableStream<Uint8Array>; cancelled: () => boolean } {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) { if (first !== undefined) controller.enqueue(first); },
    cancel() { cancelled = true; },
  });
  return { body, cancelled: () => cancelled };
}

async function probe(response: Response) {
  vi.stubGlobal("fetch", () => Promise.resolve(response));
  return await probeOwnedViteServer({ port: 5174, signal: new AbortController().signal,
    deadlineMonotonicMs: CLOCK.monotonicMs() + 1_000, clock: CLOCK, ownerNonce: "b".repeat(64) });
}

describe("vite probe response release", () => {
  it("cancels the body of a refused status", async () => {
    const held = heldBody(new TextEncoder().encode("refused"));
    assert.deepEqual(await probe(new Response(held.body, { status: 503 })), { state: "not-owned", reason: "owner-endpoint-refused" });
    assert.equal(held.cancelled(), true);
  });

  it("cancels the body of an invalid declared length", async () => {
    const held = heldBody();
    assert.deepEqual(await probe(new Response(held.body, { headers: { "content-length": "not-a-length" } })),
      { state: "not-owned", reason: "probe-response-too-large" });
    assert.equal(held.cancelled(), true);
  });

  it("cancels a body that fails to decode before its end", async () => {
    const held = heldBody(new Uint8Array([0xff]));
    assert.deepEqual(await probe(new Response(held.body)), { state: "not-owned", reason: "probe-response-invalid" });
    assert.equal(held.cancelled(), true);
  });
});
