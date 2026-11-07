import assert from "node:assert/strict";
import { describe,it } from "vitest";
import { decideDurableIntent } from "../../../../src/backend/runtime/policies/durable-intent.js";

const owner = { runId: "run-a", runAttempt: 2 };

describe("already-read durable write intent decision", () => {
  it("starts at generation one when the permanent key has no durable intent", () => {
    assert.deepEqual(decideDurableIntent(undefined, owner), { kind: "fence", generation: 1, expectedVersion: undefined });
  });

  it("reuses both completed states without another fence", () => {
    assert.deepEqual(decideDurableIntent({ status: "committed" }, owner), { kind: "reuse", record: { status: "committed" } });
    assert.deepEqual(decideDurableIntent({ status: "observed-present" }, owner), { kind: "reuse", record: { status: "observed-present" } });
  });

  it("recovers only this exact run and attempt; refuses a foreign in-flight submit", () => {
    assert.deepEqual(decideDurableIntent({ status: "attempting", ...owner }, owner), { kind: "recover-own", record: { status: "attempting", ...owner } });
    assert.deepEqual(decideDurableIntent({ status: "attempting", runId: "run-b", runAttempt: 2 }, owner), { kind: "refuse-foreign", record: { status: "attempting", runId: "run-b", runAttempt: 2 } });
    assert.deepEqual(decideDurableIntent({ status: "attempting", runId: "run-a", runAttempt: 1 }, owner), { kind: "refuse-foreign", record: { status: "attempting", runId: "run-a", runAttempt: 1 } });
  });

  it("refuses parked and CASes retryable at the next generation and exact stored version", () => {
    assert.deepEqual(decideDurableIntent({ status: "parked" }, owner), { kind: "refuse-parked", record: { status: "parked" } });
    assert.deepEqual(decideDurableIntent({ status: "retryable", generation: 3, version: 9 }, owner), { kind: "fence", generation: 4, expectedVersion: 9 });
  });

  it("returns the complete already-read record by identity for reuse, recovery and refusal", () => {
    const committed = { status: "committed" as const, writeIntentId: "intent-1", generation: 3, version: 9, completionProof: { value: "receipt" } };
    const observed = { status: "observed-present" as const, writeIntentId: "intent-2", generation: 2, version: 7, observedProof: { value: "observation" } };
    const own = { status: "attempting" as const, writeIntentId: "intent-3", generation: 1, version: 4, ...owner };
    const foreign = { status: "attempting" as const, writeIntentId: "intent-4", generation: 5, version: 11, runId: "run-b", runAttempt: 2 };
    const parked = { status: "parked" as const, writeIntentId: "intent-5", generation: 6, version: 12, parkedCode: "unknown" };

    const reusedCommitted = decideDurableIntent(committed, owner);
    const reusedObserved = decideDurableIntent(observed, owner);
    const recoveredOwn = decideDurableIntent(own, owner);
    const refusedForeign = decideDurableIntent(foreign, owner);
    const refusedParked = decideDurableIntent(parked, owner);
    assert.equal(reusedCommitted.kind, "reuse");
    assert.equal(reusedObserved.kind, "reuse");
    assert.equal(recoveredOwn.kind, "recover-own");
    assert.equal(refusedForeign.kind, "refuse-foreign");
    assert.equal(refusedParked.kind, "refuse-parked");
    assert.ok("record" in reusedCommitted && reusedCommitted.record === committed);
    assert.ok("record" in reusedObserved && reusedObserved.record === observed);
    assert.ok("record" in recoveredOwn && recoveredOwn.record === own);
    assert.ok("record" in refusedForeign && refusedForeign.record === foreign);
    assert.ok("record" in refusedParked && refusedParked.record === parked);
  });
});
