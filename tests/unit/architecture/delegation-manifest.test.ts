/**
 * Delegation manifests (ref workflow-model §3.2, D102).
 *
 * The failure this guards against is the one that loses work silently: a
 * fan-out whose input list changed between enqueue and replay, so the replay
 * attaches new children beside orphaned ones and double-processes the overlap.
 * The manifest is the authority — replay re-plans and must land on its exact
 * fingerprint — and the policy vocabulary is ONE vocabulary end to end, so no
 * lossy translation at the enqueue boundary can drop a policy the operator
 * selected.
 */
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { DESCRIPTORS } from "../../../src/control/workflow-registry.js";
import { descriptorRuntimeNodes } from "../../../src/base/workflow.js";
import { DelegationEdgeIdSchema, FailureIdSchema, ItemIdSchema, RunIdSchema } from "../../../src/domain/ids.js";
import type { ItemId } from "../../../src/domain/ids.js";
import {
  assertChildRunIdentity,
  assertDelegationReplayMatches,
  joinDelegationOutcomes,
  planDelegationFanOut,
} from "../../../src/domain/workflow/delegation.js";
import { DelegationPolicySchema } from "../../../src/domain/workflow/delegation-policy.js";
import { DelegationManifestSchema } from "../../../src/domain/dependencies.js";
import { FixtureChildWorkflow, fixtureDescriptor } from "./helpers/descriptor-fixtures.js";

const POLICY = DelegationPolicySchema.parse({
  onChildFailed: "allow-partial",
  cascadeCancel: "cascade",
  afterChildRetry: "resume-parent",
  visibility: "inline",
});
const EDGE = DelegationEdgeIdSchema.parse("notify-many");
const itemIdFor = (note: string): ItemId =>
  ItemIdSchema.parse(`00000000-0000-4000-8000-0000000000${note.padStart(2, "0")}`);

function planFor(notes: readonly string[]) {
  return planDelegationFanOut({
    edgeId: EDGE,
    target: FixtureChildWorkflow,
    cardinality: "many",
    join: "all-settled",
    policy: POLICY,
    bound: notes.map((note) => ({ eid: "10800000", note })),
    deriveChildItemId: (input) => itemIdFor(input.note),
  });
}

describe("delegation manifest", () => {
  it("keeps every declared edge id unique per workflow and typed by one policy vocabulary", () => {
    for (const descriptor of [...DESCRIPTORS, fixtureDescriptor]) {
      const edges = descriptorRuntimeNodes(descriptor)
        .filter((node) => node.kind === "child-run")
        .map((node) => ({ id: String(node.edgeId), policy: node.policy, await: node.await, join: node.join }));
      const ids = edges.map(({ id }) => id);
      assert.equal(new Set(ids).size, ids.length, `${String(descriptor.id)} repeats a delegation edge id`);
      for (const edge of edges) {
        // D102: builder, manifest, dependency row, and UI read the same shape.
        assert.deepEqual(DelegationPolicySchema.parse(edge.policy), edge.policy, edge.id);
        assert.equal(edge.await === "none", edge.join === "none", `${edge.id} join must follow await`);
      }
    }
  });

  it("fingerprints the whole plan and refuses a replay that drifted", () => {
    const original = planFor(["01", "02"]);
    assert.equal(original.children.length, 2);
    assertDelegationReplayMatches({ edgeId: EDGE, planFingerprint: original.planFingerprint }, planFor(["01", "02"]));

    assert.throws(
      () => assertDelegationReplayMatches(
        { edgeId: EDGE, planFingerprint: original.planFingerprint },
        planFor(["01", "02", "03"]),
      ),
      /replay does not match its manifest/,
    );
    // A policy change alone must move the fingerprint: the manifest covers
    // policy, not only the child list.
    const repolicied = planDelegationFanOut({
      edgeId: EDGE,
      target: FixtureChildWorkflow,
      cardinality: "many",
      join: "all-settled",
      policy: DelegationPolicySchema.parse({ ...POLICY, onChildFailed: "fail-parent" }),
      bound: [{ eid: "10800000", note: "01" }, { eid: "10800000", note: "02" }],
      deriveChildItemId: (input) => itemIdFor(input.note),
    });
    assert.notEqual(repolicied.planFingerprint, original.planFingerprint);
  });

  it("refuses a duplicate derived child id and an unparseable child input", () => {
    assert.throws(
      () => planDelegationFanOut({
        edgeId: EDGE,
        target: FixtureChildWorkflow,
        cardinality: "many",
        join: "all",
        policy: POLICY,
        bound: [{ eid: "10800000", note: "01" }, { eid: "10800001", note: "01" }],
        deriveChildItemId: (input) => itemIdFor(input.note),
      }),
      /derived duplicate child item id/,
    );
    assert.throws(
      () => planFor([""]),
      /too small|expected string/i,
    );
  });

  it("joins only over a complete outcome set", () => {
    const plan = planFor(["01", "02"]);
    const outcome = (index: number, state: "done" | "failed") => state === "done"
      ? {
        state: "done" as const,
        runId: RunIdSchema.parse("11111111-1111-4111-8111-11111111111" + String(index)),
        itemId: plan.children[index].childItemId,
        output: { acknowledged: true },
      }
      : {
        state: "failed" as const,
        runId: RunIdSchema.parse("11111111-1111-4111-8111-11111111111" + String(index)),
        itemId: plan.children[index].childItemId,
        failureId: FailureIdSchema.parse("22222222-2222-4222-8222-222222222222"),
      };

    assert.equal(joinDelegationOutcomes(plan, [outcome(0, "done"), outcome(1, "done")]).state, "satisfied");
    // "still running" and "finished" must never be indistinguishable.
    assert.throws(
      () => joinDelegationOutcomes(plan, [outcome(0, "done")]),
      /join received 1 outcomes for 2 planned children/,
    );
    // all-settled hands the parent the full typed array rather than pre-empting it.
    assert.equal(joinDelegationOutcomes(plan, [outcome(0, "done"), outcome(1, "failed")]).state, "satisfied");
  });

  it("keeps a zero-child fan-out an explicit satisfied join, never a vanished edge", () => {
    const empty = planFor([]);
    assert.equal(empty.children.length, 0);
    assert.equal(joinDelegationOutcomes(empty, []).state, "satisfied");
    assert.notEqual(empty.planFingerprint, planFor(["01"]).planFingerprint);
  });

  it("keeps the durable manifest record on the same policy vocabulary", () => {
    // The manifest is the authority for a fan-out, so the policy it enqueued
    // under has to live ON it — not only on the dependency rows it produced.
    assert.ok(
      Object.hasOwn(DelegationManifestSchema.shape, "policy"),
      "the durable manifest must carry the policy it enqueued under",
    );
    const base = {
      manifestId: "22222222-2222-4222-8222-222222222222",
      parentRunId: "33333333-3333-4333-8333-333333333333",
      edgeId: "notify-many",
      inputSchemaHash: "a".repeat(64),
      resultSchemaHash: "b".repeat(64),
      policy: POLICY,
      createdAt: "2026-07-31T17:00:00.000Z",
      manifestFingerprint: "a".repeat(64),
    };
    // A zero-child fan-out must be WRITABLE, or the "explicit satisfied join"
    // rule has no durable record behind it.
    assert.equal(
      DelegationManifestSchema.safeParse({ ...base, cardinality: "many", join: "all-settled", children: [] }).success,
      true,
    );
    // An un-awaited edge still mints a manifest — its reference IS the node output.
    assert.equal(
      DelegationManifestSchema.safeParse({ ...base, cardinality: "many", join: "none", children: [] }).success,
      true,
    );
    // The awaited joins are not interchangeable across cardinalities.
    assert.equal(
      DelegationManifestSchema.safeParse({ ...base, cardinality: "many", join: "one", children: [] }).success,
      false,
    );
    assert.equal(
      DelegationManifestSchema.safeParse({
        ...base,
        cardinality: "one",
        join: "all",
        children: [{
          dependencyId: "44444444-4444-4444-8444-444444444444",
          childRunId: "55555555-5555-4555-8555-555555555555",
          childItemId: "66666666-6666-4666-8666-666666666666",
          canonicalInputFingerprint: "c".repeat(64),
        }],
      }).success,
      false,
    );
    assert.throws(
      () => assertChildRunIdentity(
        RunIdSchema.parse("33333333-3333-4333-8333-333333333333"),
        RunIdSchema.parse("33333333-3333-4333-8333-333333333333"),
      ),
      /cannot target the parent run/,
    );
  });
});
