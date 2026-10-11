import assert from "node:assert/strict";
import { describe,it } from "vitest";
import { z } from "zod";
import type { DelegationPolicy } from "../../../src/models/workflow/delegation-policy.js";
import type { DelegationPlan } from "../../../src/models/workflow/delegation.js";
import {
assertChildRunIdentity,
assertDelegationReplayMatches,
joinDelegationOutcomes,
planDelegationFanOut,
} from "../../../src/models/workflow/delegation.js";
import type { ChildRunOutcome,WorkflowRef } from "../../../src/models/workflow/graph.js";
import type { ItemId } from "../../../src/rules/identity/ids.js";
import {
DelegationEdgeIdSchema,
EidSchema,
FailureIdSchema,
ItemIdSchema,
RunIdSchema,
WorkflowIdSchema,
} from "../../../src/rules/identity/ids.js";

const CHILD: WorkflowRef<
  z.ZodObject<{ eid: typeof EidSchema }>,
  z.ZodObject<{ verified: z.ZodBoolean }>
> = {
  id: WorkflowIdSchema.parse("verify"),
  input: z.object({ eid: EidSchema }),
  result: z.object({ verified: z.boolean() }),
};

const EDGE = DelegationEdgeIdSchema.parse("verify-people");
const POLICY: DelegationPolicy = {
  onChildFailed: "fail-parent",
  cascadeCancel: "cascade",
  afterChildRetry: "resume-parent",
  visibility: "inline",
};

const PARENT_RUN = RunIdSchema.parse("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
const runIdFor = (n: number): ReturnType<typeof RunIdSchema.parse> =>
  RunIdSchema.parse(`bbbbbbbb-bbbb-4bbb-8bbb-${String(n).padStart(12, "0")}`);

/** Stable identity derived from the child's own input, never an array index. */
const byEid = (input: { eid: string }): ItemId =>
  ItemIdSchema.parse(`00000000-0000-4000-8000-${input.eid.padStart(12, "0")}`);

function planMany(eids: readonly string[], policy: DelegationPolicy = POLICY, join: "all" | "all-settled" = "all") {
  return planDelegationFanOut({
    edgeId: EDGE,
    target: CHILD,
    cardinality: "many",
    join,
    policy,
    bound: eids.map((eid) => ({ eid })),
    deriveChildItemId: byEid,
  });
}

function outcomesFor(
  plan: DelegationPlan<typeof CHILD>,
  states: readonly ("done" | "failed" | "cancelled" | "blocked")[],
): readonly ChildRunOutcome<typeof CHILD>[] {
  return plan.children.map((child, index) => {
    const runId = runIdFor(index);
    const failureId = FailureIdSchema.parse(`cccccccc-cccc-4ccc-8ccc-${String(index).padStart(12, "0")}`);
    switch (states[index] ?? "done") {
      case "done":
        return { state: "done", runId, itemId: child.childItemId, output: { verified: true } };
      case "failed":
        return { state: "failed", runId, itemId: child.childItemId, failureId };
      case "cancelled":
        return {
          state: "cancelled", runId, itemId: child.childItemId,
          reason: "operator cancelled", cancelledBy: "operator",
        };
      case "blocked":
        return {
          state: "blocked", runId, itemId: child.childItemId,
          failureId, reason: "upstream dependency failed",
        };
    }
  });
}

describe("delegation fan-out planning", () => {
  it("parses every child input and derives stable ids before anything is written", () => {
    const plan = planMany(["10800001", "10800002"]);
    assert.deepEqual(plan.children.map(({ childItemId }) => childItemId), [
      "00000000-0000-4000-8000-000010800001",
      "00000000-0000-4000-8000-000010800002",
    ]);
    assert.equal(plan.children.length, 2);
    assert.match(plan.planFingerprint, /^[0-9a-f]{64}$/);
  });

  it("is deterministic for the same inputs and different for different ones", () => {
    assert.equal(planMany(["10800001"]).planFingerprint, planMany(["10800001"]).planFingerprint);
    assert.notEqual(planMany(["10800001"]).planFingerprint, planMany(["10800002"]).planFingerprint);
    // Order is part of identity: the manifest records children in plan order.
    assert.notEqual(
      planMany(["10800001", "10800002"]).planFingerprint,
      planMany(["10800002", "10800001"]).planFingerprint,
    );
  });

  it("makes the policy part of the plan fingerprint", () => {
    assert.notEqual(
      planMany(["10800001"]).planFingerprint,
      planMany(["10800001"], { ...POLICY, onChildFailed: "allow-partial" }).planFingerprint,
    );
  });

  it("rejects a child input the target's own schema refuses, planning nothing", () => {
    assert.throws(() => planMany(["not-an-eid"]), /EID must be eight digits/);
  });

  it("rejects a duplicate derived child item id rather than colliding downstream", () => {
    assert.throws(
      () => planMany(["10800001", "10800001"]),
      /derived duplicate child item id .* at index 1/,
    );
  });

  it("keeps a zero-child fan-out explicit instead of dropping the edge", () => {
    const plan = planMany([]);
    assert.deepEqual(plan.children, []);
    assert.deepEqual(joinDelegationOutcomes(plan, []), { state: "satisfied", outcomes: [] });
  });

  it("rejects a cardinality that disagrees with the bound value", () => {
    assert.throws(
      () => planDelegationFanOut({
        edgeId: EDGE, target: CHILD, cardinality: "one", join: "one", policy: POLICY,
        bound: [{ eid: "10800001" }], deriveChildItemId: byEid,
      }),
      /cardinality "one" but bound an array/,
    );
    assert.throws(
      () => planDelegationFanOut({
        edgeId: EDGE, target: CHILD, cardinality: "many", join: "all", policy: POLICY,
        bound: { eid: "10800001" }, deriveChildItemId: byEid,
      }),
      /cardinality "many" but bound a single input/,
    );
  });
});

describe("delegation replay", () => {
  it("accepts a replan that matches the stored manifest exactly", () => {
    const stored = planMany(["10800001", "10800002"]);
    assert.doesNotThrow(() => {
      assertDelegationReplayMatches(stored, planMany(["10800001", "10800002"]));
    });
  });

  it("refuses a replan whose fan-out list changed after enqueue", () => {
    const stored = planMany(["10800001", "10800002"]);
    assert.throws(
      () => { assertDelegationReplayMatches(stored, planMany(["10800001", "10800003"])); },
      /replay does not match its manifest/,
    );
    assert.throws(
      () => { assertDelegationReplayMatches(stored, planMany(["10800001"])); },
      /the fan-out inputs or policy changed after enqueue/,
    );
  });

  it("refuses a replan whose policy changed, even with identical children", () => {
    const stored = planMany(["10800001"]);
    assert.throws(
      () => {
        assertDelegationReplayMatches(stored, planMany(["10800001"], { ...POLICY, cascadeCancel: "independent" }));
      },
      /replay does not match its manifest/,
    );
  });

  it("refuses a replan for a different edge", () => {
    const stored = { edgeId: DelegationEdgeIdSchema.parse("other-edge"), planFingerprint: planMany([]).planFingerprint };
    assert.throws(
      () => { assertDelegationReplayMatches(stored, planMany([])); },
      /but the stored manifest is for other-edge/,
    );
  });
});

describe("delegation join", () => {
  it("is satisfied when every child completes", () => {
    const plan = planMany(["10800001", "10800002"]);
    const join = joinDelegationOutcomes(plan, outcomesFor(plan, ["done", "done"]));
    assert.equal(join.state, "satisfied");
  });

  it("applies fail-parent to any non-done child under an all join", () => {
    const plan = planMany(["10800001", "10800002"]);
    for (const state of ["failed", "cancelled", "blocked"] as const) {
      const join = joinDelegationOutcomes(plan, outcomesFor(plan, ["done", state]));
      assert.equal(join.state, "failed", state);
      assert.match(join.state === "failed" ? join.reason : "", new RegExp(state));
    }
  });

  it("blocks rather than fails under block-parent", () => {
    const plan = planMany(["10800001"], { ...POLICY, onChildFailed: "block-parent" });
    const join = joinDelegationOutcomes(plan, outcomesFor(plan, ["failed"]));
    assert.equal(join.state, "blocked");
    assert.match(join.state === "blocked" ? join.reason : "", /awaiting operator resolution/);
  });

  it("passes partials through under allow-partial", () => {
    const plan = planMany(["10800001", "10800002"], { ...POLICY, onChildFailed: "allow-partial" });
    const join = joinDelegationOutcomes(plan, outcomesFor(plan, ["done", "failed"]));
    assert.equal(join.state, "satisfied");
    assert.equal(join.outcomes.length, 2);
  });

  it("hands all-settled the complete typed array regardless of failure policy", () => {
    const plan = planMany(["10800001", "10800002"], POLICY, "all-settled");
    const join = joinDelegationOutcomes(plan, outcomesFor(plan, ["done", "failed"]));
    assert.equal(join.state, "satisfied");
    assert.deepEqual(join.outcomes.map(({ state }) => state), ["done", "failed"]);
  });

  it("refuses a partial outcome set, so pending is never read as finished", () => {
    const plan = planMany(["10800001", "10800002"]);
    assert.throws(
      () => joinDelegationOutcomes(plan, outcomesFor(plan, ["done", "done"]).slice(0, 1)),
      /received 1 outcomes for 2 planned children/,
    );
  });

  it("refuses outcomes belonging to different children than it planned", () => {
    const plan = planMany(["10800001", "10800002"]);
    const other = planMany(["10800003", "10800004"]);
    assert.throws(
      () => joinDelegationOutcomes(plan, outcomesFor(other, ["done", "done"])),
      /outcomes for different children than it planned/,
    );
  });

  it("has no join to apply for an un-awaited fan-out", () => {
    const plan = planDelegationFanOut({
      edgeId: EDGE, target: CHILD, cardinality: "many", join: "none", policy: POLICY,
      bound: [{ eid: "10800001" }], deriveChildItemId: byEid,
    });
    assert.throws(() => joinDelegationOutcomes(plan, []), /un-awaited and has no join to apply/);
  });
});

describe("child run identity", () => {
  it("refuses a run that would delegate to itself", () => {
    assert.doesNotThrow(() => { assertChildRunIdentity(PARENT_RUN, runIdFor(1)); });
    assert.throws(
      () => { assertChildRunIdentity(PARENT_RUN, PARENT_RUN); },
      /cannot target the parent run .* as its own child/,
    );
  });
});
