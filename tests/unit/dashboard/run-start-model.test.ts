/**
 * D251 — the Run Modal's start facts, and the one it refuses.
 *
 * None of them grew a wire: every value here is already on the client-bundled
 * descriptor. What these cases pin is that the modal's words about those values
 * stay TRUE — an exhaustive vocabulary, a reason set scoped to the modal's own
 * preconditions, and the claim ref frontend-backend-integration §D251 makes about the enqueue enum.
 */
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { EnqueuePolicySchema } from "../../../src/domain/workflow/presentation.js";
import { WORKFLOW_DESCRIPTORS } from "../../../src/workflows/descriptor-registry.js";
import {
  ENQUEUE_POLICY_MEANING,
  ENQUEUE_POLICY_REASON,
  START_DOOR_ABSENCE,
} from "../../../src/dashboard/surfaces/run-start-model.js";
import { versionTag } from "../../../src/dashboard/surfaces/format.js";

describe("the descriptor version in the Run Modal footer (C96)", () => {
  it("prints the stored integer with no fabricated minor version", () => {
    for (const descriptor of WORKFLOW_DESCRIPTORS) {
      const tag = versionTag(descriptor.version);
      assert.equal(tag, `v${String(descriptor.version)}`, `${descriptor.id} footer tag`);
      assert.doesNotMatch(tag, /\./u, `${descriptor.id} has no recorded minor version`);
    }
  });
});

describe("the declared active-run policy, as the modal states it (D251)", () => {
  it("covers the enum exactly — a new policy arm cannot land wordless, and no word outlives its arm", () => {
    assert.deepEqual(
      Object.keys(ENQUEUE_POLICY_MEANING).sort(),
      [...EnqueuePolicySchema.options].sort(),
    );
  });

  it("has a sentence for every policy any registered workflow actually declares", () => {
    for (const descriptor of WORKFLOW_DESCRIPTORS) {
      assert.ok(
        ENQUEUE_POLICY_MEANING[descriptor.enqueue] !== undefined,
        `${descriptor.id} declares ${descriptor.enqueue}, which the modal has no words for`,
      );
    }
  });

  it("pins ref frontend-backend-integration §D251's claim that NO registered workflow declares supersede-active", () => {
    // The doc says the arm supersedes nothing because no planner path implements
    // it and nothing declares it. The second half is checkable, so it is checked:
    // the day a descriptor declares it, this case fails and the sentence gets
    // re-decided instead of quietly becoming false on an operator's screen.
    assert.deepEqual(
      WORKFLOW_DESCRIPTORS.filter((descriptor) => descriptor.enqueue === "supersede-active").map((d) => d.id),
      [],
    );
  });

  it("states WHY the policy is not a control, so a locked value never reads as a broken one", () => {
    assert.match(ENQUEUE_POLICY_REASON, /declared by this workflow/u);
  });
});

describe("why this dialog cannot start a workflow (D251)", () => {
  it("names the modal's own precondition and does not speak for the server", () => {
    const reason = START_DOOR_ABSENCE["no-typed-input"];
    // The wording is load-bearing: `POST /start-plans` takes JSON submissions and
    // parses them with `descriptor.input`, so a caller composing its own
    // submission CAN start a workflow that declares no typed-input surface. What
    // is missing is this dialog's box, and the sentence must say only that.
    assert.match(reason, /this dialog/u);
    assert.doesNotMatch(reason, /refus|server|not allowed|cannot be started/u);
  });

  it("has exactly one arm, because exactly one precondition exists", () => {
    // `availability` is deliberately not a second: `buildBootstrap` serves every
    // workflow `available` unconditionally and no start path reads it, so an arm
    // keyed on it would be a reason nothing produces and nothing enforces.
    assert.deepEqual(Object.keys(START_DOOR_ABSENCE), ["no-typed-input"]);
  });
});

describe("the descriptor prose the modal draws (D251)", () => {
  it("finds a summary on every registered workflow, and treats absence as legal anyway", () => {
    // Every descriptor declares one today (D229), which is why the modal shows a
    // paragraph for each. The field stays OPTIONAL and the surface renders
    // nothing when it is missing — a composed sentence about a workflow would be
    // this surface claiming to know one.
    for (const descriptor of WORKFLOW_DESCRIPTORS) {
      assert.equal(typeof descriptor.summary, "string", `${descriptor.id} declares no summary`);
      assert.ok((descriptor.summary ?? "").trim().length > 0);
    }
  });

  it("has exactly one start method kind, which is why no method tabs are drawn", () => {
    // The demo renders its tab strip only at `methods.length > 1`. Nothing here
    // declares `uploadRun`, so one method is the whole set and no tabs is the
    // demo-faithful rendering — not a deferral.
    assert.deepEqual(
      WORKFLOW_DESCRIPTORS.filter((descriptor) => descriptor.surfaces.uploadRun !== undefined).map((d) => d.id),
      [],
    );
  });
});
