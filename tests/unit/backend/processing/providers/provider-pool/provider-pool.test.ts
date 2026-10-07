/**
 * D165's rotation pool: one invocation is ONE child call, exhaustion
 * advances the cursor for the NEXT admitted invocation, success and
 * non-retryable failures stay put, and the evidence names which child
 * answered.
 */
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { createProviderPool } from "../../../../../../src/backend/processing/providers/provider-pool.js";
import type { ProviderAdapter, ProviderCallOptions } from "../../../../../../src/workflow-kit/providers.js";
import type { ProviderRequestEnvelope } from "../../../../../../src/models/providers/providers.js";

const REQUEST = {
  capability: "ocr.extract",
  payload: { schemaHash: "ab".repeat(32), value: { page: 1 } },
} as unknown as ProviderRequestEnvelope;
const OPTIONS = {
  signal: new AbortController().signal,
  deadlineMonotonicMs: 60_000,
  admissionId: "00000000-0000-4000-8000-000000000001",
} as unknown as ProviderCallOptions;

function scriptedChild(
  label: string,
  outcomes: (() => unknown)[],
): { label: string; adapter: ProviderAdapter<"ocr.extract">; calls: () => number } {
  let calls = 0;
  return {
    label,
    calls: () => calls,
    adapter: Object.freeze({
      capability: "ocr.extract" as const,
      estimate: () => ({ maximumCostUsdMicros: 0 }),
      invoke: () => {
        const next = outcomes[calls];
        calls += 1;
        if (next === undefined) throw new Error(`${label} exhausted its script`);
        return Promise.resolve(next() as never);
      },
    }),
  };
}

const produced = () => ({
  response: { state: "produced", value: { schemaHash: "cd".repeat(32), value: { read: true } } },
  usage: { requestCount: 1, costUsdMicros: 0 },
  evidence: { summary: "answered", capturedAt: "2026-08-08T12:00:00.000Z" },
});
const rateExhausted = () => ({
  response: {
    state: "unavailable",
    reason: { code: "rate-exhausted", message: "429", retryAt: "2026-08-08T12:01:00.000Z" },
  },
  usage: { requestCount: 1, costUsdMicros: 0 },
  evidence: { summary: "throttled", capturedAt: "2026-08-08T12:00:00.000Z" },
});
const hardFailure = () => ({
  response: { state: "unavailable", reason: { code: "adapter-unavailable", message: "bad key" } },
  usage: { requestCount: 1, costUsdMicros: 0 },
  evidence: { summary: "refused", capturedAt: "2026-08-08T12:00:00.000Z" },
});

describe("provider pool rotation", () => {
  it("makes exactly one child call per invocation and sticks on success", async () => {
    const first = scriptedChild("key1/model1", [produced, produced]);
    const second = scriptedChild("key2/model1", []);
    const pool = createProviderPool("ocr.extract", [first, second]);

    const outcome = await pool.invoke(REQUEST, OPTIONS);
    assert.equal(outcome.response.state, "produced");
    assert.match(outcome.evidence.summary, /^key1\/model1: /u);
    await pool.invoke(REQUEST, OPTIONS);
    assert.equal(first.calls(), 2);
    assert.equal(second.calls(), 0);
  });

  it("advances to the next child AFTER an exhaustion answer, not within it", async () => {
    const first = scriptedChild("key1/model1", [rateExhausted]);
    const second = scriptedChild("key2/model1", [produced]);
    const pool = createProviderPool("ocr.extract", [first, second]);

    const throttled = await pool.invoke(REQUEST, OPTIONS);
    assert.equal(throttled.response.state, "unavailable", "the exhaustion answer is returned, never retried under one admission");
    assert.equal(first.calls(), 1);
    assert.equal(second.calls(), 0);

    const next = await pool.invoke(REQUEST, OPTIONS);
    assert.equal(next.response.state, "produced");
    assert.match(next.evidence.summary, /^key2\/model1: /u);
  });

  it("stays on the same child after a non-retryable failure", async () => {
    const first = scriptedChild("key1/model1", [hardFailure, hardFailure]);
    const second = scriptedChild("key2/model1", []);
    const pool = createProviderPool("ocr.extract", [first, second]);

    await pool.invoke(REQUEST, OPTIONS);
    await pool.invoke(REQUEST, OPTIONS);
    assert.equal(first.calls(), 2);
    assert.equal(second.calls(), 0);
  });

  it("refuses to compose an empty pool", () => {
    assert.throws(() => createProviderPool("ocr.extract", []), /zero children/u);
  });
});
