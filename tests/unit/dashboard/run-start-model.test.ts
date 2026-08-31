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
  runControlGroups,
  startRequestFingerprint,
  type StartRequestShape,
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

// ---------------------------------------------------------------------------
// D272 items 8 and 9 — the run-start follow-on ports (ledger 1 rows C83/C84/C109)
// ---------------------------------------------------------------------------

describe("a plan outlives nothing that shaped it (C109, D272 item 8)", () => {
  const base: StartRequestShape = {
    workflowId: "person-lookup",
    text: "E1234567",
    dryRun: false,
    priority: "interactive",
    selectedStepKeys: ["searching", "cross-verify", "active-status"],
  };

  it("changes when ANY field of the start request changes", () => {
    // Every field here is one the server binds the plan token to, so a plan
    // made before the change is unusable after it. The cases are enumerated
    // one field at a time because a fingerprint that silently dropped a field
    // would still pass a whole-object comparison.
    const moved: readonly [string, StartRequestShape][] = [
      ["workflowId", { ...base, workflowId: "kuali-separation" }],
      ["text", { ...base, text: "E7654321" }],
      ["dryRun", { ...base, dryRun: true }],
      ["priority", { ...base, priority: "bulk" }],
      ["selectedStepKeys", { ...base, selectedStepKeys: [...base.selectedStepKeys, "crm-dates"] }],
    ];
    // The enumeration is only as good as its coverage, and nothing here could
    // see a SIXTH field arriving on `StartRequestShape` with no case for it —
    // which is the whole failure mode this fold exists to prevent, one level
    // up. `base` is typed as the real shape, so its own keys are the list the
    // cases have to match exactly (unit F5b finding 9).
    assert.deepEqual(
      moved.map(([field]) => field).sort(),
      Object.keys(base).sort(),
      "a field of the start request has no case above",
    );
    for (const [field, next] of moved) {
      assert.notEqual(
        startRequestFingerprint(next),
        startRequestFingerprint(base),
        `changing ${field} left the plan's fingerprint standing`,
      );
    }
  });

});

describe("the run-control rail is numbered by what it draws (C83/C84, D272 item 9)", () => {
  it("draws no Safety group at all for a workflow that declares no dry run", () => {
    // DESIGN.md:305 — "a workflow that declares none shows none: no empty
    // scaffolding". The offer-disabled rule it also states is written for an
    // OPTION inside a control, not for the group around it.
    assert.deepEqual(
      runControlGroups(false).map((group) => group.key),
      ["queue"],
    );
    assert.deepEqual(
      runControlGroups(true).map((group) => group.key),
      ["queue", "safety"],
    );
  });

  it("draws no Destination group", () => {
    for (const supportsDryRun of [false, true]) {
      assert.ok(
        runControlGroups(supportsDryRun).every((group) => group.title !== "Destination"),
        `Destination survived with supportsDryRun=${String(supportsDryRun)}`,
      );
    }
  });

  it("leaves no gap in the reading path, in either shape", () => {
    // The numbers exist to be read in order; a frozen `03` beside a two-group
    // rail is the defect this row names. Contiguity is asserted rather than the
    // two literal lists, so a fourth group cannot land wearing a wrong number.
    for (const supportsDryRun of [false, true]) {
      const groups = runControlGroups(supportsDryRun);
      assert.deepEqual(
        groups.map((group) => group.step),
        groups.map((_, index) => String(index + 1).padStart(2, "0")),
        `numbering with supportsDryRun=${String(supportsDryRun)}`,
      );
    }
  });

  it("gives every drawn group a title and a description", () => {
    for (const group of runControlGroups(true)) {
      assert.ok(group.title.trim().length > 0, `${group.key} has no title`);
      assert.ok(group.description.trim().length > 0, `${group.key} has no description`);
    }
  });
});
