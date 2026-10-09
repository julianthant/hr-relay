import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { decideIdleClaim } from "../../../../../../src/backend/runtime/policies/idle-claim.js";

describe("no-eligible worker claim decision", () => {
  it("exits without needing a clock or cadence when idle exit is requested", () => {
    assert.deepEqual(decideIdleClaim({ exitWhenIdle: true }), { kind: "exit" });
    assert.deepEqual(decideIdleClaim({ exitWhenIdle: true, notBefore: "2026-10-01T00:00:10.000Z" }), { kind: "exit" });
  });

  it("repolls on the configured cadence when no future eligibility is known", () => {
    assert.deepEqual(decideIdleClaim({ exitWhenIdle: false, cadenceMs: 250 }), { kind: "wait", delayMs: 250 });
  });

  it("caps future eligibility by cadence and allows an already-due claim immediately", () => {
    const nowMs = Date.parse("2026-10-01T00:00:00.000Z");
    assert.deepEqual(decideIdleClaim({ exitWhenIdle: false, notBefore: "2026-10-01T00:00:10.000Z", nowMs, cadenceMs: 250 }), { kind: "wait", delayMs: 250 });
    assert.deepEqual(decideIdleClaim({ exitWhenIdle: false, notBefore: "2026-10-01T00:00:00.120Z", nowMs, cadenceMs: 250 }), { kind: "wait", delayMs: 120 });
    assert.deepEqual(decideIdleClaim({ exitWhenIdle: false, notBefore: "2026-09-30T23:59:59.000Z", nowMs, cadenceMs: 250 }), { kind: "wait", delayMs: 0 });
  });
});
