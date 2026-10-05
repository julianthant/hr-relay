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
import { StepOmissionFormSchema, type StepOmissionForm } from "../../../src/domain/workflow/step-omission.js";
import {
  ENQUEUE_POLICY_MEANING,
  ENQUEUE_POLICY_REASON,
  START_DOOR_ABSENCE,
  foldStepOmissionFacts,
  forcedStepOmissions,
  initialStepOmissionDraft,
  inputRunDelimiterHint,
  inputRunFieldLabel,
  omittedStepViews,
  runControlGroups,
  startRequestFingerprint,
  toggleStepSelection,
  type StartRequestShape,
  type StepOmissionStepView,
} from "../../../src/dashboard/surfaces/run-start/run-start-model.js";
import { versionTag } from "../../../src/dashboard/surfaces/shared/status/format.js";

describe("the descriptor version in Run Modal facts (C96)", () => {
  it("prints the stored integer with no fabricated minor version", () => {
    for (const descriptor of WORKFLOW_DESCRIPTORS) {
      const tag = versionTag(descriptor.version);
      assert.equal(tag, `v${String(descriptor.version)}`, `${descriptor.id} footer tag`);
      assert.doesNotMatch(tag, /\./u, `${descriptor.id} has no recorded minor version`);
    }
  });
});

describe("compact input guidance follows the declared parser", () => {
  it("capitalizes Employee IDs and uses Kuali ID without changing parsing", () => {
    for (const [pattern, expected] of [["eid", "Employee IDs"], ["document-number", "Kuali ID"]] as const) {
      const parser = { rules: [{ when: { kind: "pattern" as const, pattern }, emit: "value" }], split: { kind: "whole-text" as const } };
      assert.equal(inputRunFieldLabel(parser), expected);
    }
  });

  it("names only the accepted separators", () => {
    const rules = [{ when: { kind: "otherwise" as const }, emit: "eid" }];
    assert.equal(inputRunDelimiterHint({ rules, split: { kind: "whole-text" } }), "Enter one value.");
    assert.equal(inputRunDelimiterHint({ rules, split: { kind: "delimited", delimiters: ["\n"] } }), "Separate values with a new line.");
    assert.equal(inputRunDelimiterHint({ rules, split: { kind: "delimited", delimiters: ["\n", ";", ","] } }), "Separate values with a new line or a semicolon or a comma.");
    assert.equal(inputRunDelimiterHint({ rules, split: { kind: "delimited", delimiters: ["|"] } }), 'Separate values with "|".');
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
    // The SHIPPED words, not an earlier draft of them: `b5581781` unified the
    // run-option fields onto "Fixed by this workflow." and the frozen parity
    // a11y references photograph exactly that sentence, so a regex naming the
    // old wording was failing against the surface it claims to pin.
    assert.match(ENQUEUE_POLICY_REASON, /Fixed by this workflow/u);
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
        browserMode: "headless",
        captureBrowserScreenshots: true,
        priority: "interactive",
    selectedStepKeys: ["searching", "cross-verify", "active-status"],
    stepOmissionDrafts: [{ step: "kronos-timecard", draft: { lastDayWorked: "06/30/2026" } }],
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
      ["browserMode", { ...base, browserMode: "headed" }],
      ["captureBrowserScreenshots", { ...base, captureBrowserScreenshots: false }],
      ["priority", { ...base, priority: "bulk" }],
      ["selectedStepKeys", { ...base, selectedStepKeys: [...base.selectedStepKeys, "crm-dates"] }],
      // D307 — a changed FACT is a changed request. The server binds the plan
      // token to the omission it planned, so a plan made against 06/30 cannot
      // start a run that asserts 07/31.
      ["stepOmissionDrafts", { ...base, stepOmissionDrafts: [{ step: "kronos-timecard", draft: { lastDayWorked: "07/31/2026" } }] }],
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

// ---------------------------------------------------------------------------
// D307 — the Steps screen's omission folds
// ---------------------------------------------------------------------------

/**
 * One form per declared kind, parsed through the SAME schema a step folder's
 * declaration is parsed through — a hand-shaped literal here could pin a form
 * no descriptor can declare.
 */
const EVERY_KIND: StepOmissionForm = StepOmissionFormSchema.parse({
  fields: [
    { key: "note", label: "Note", kind: "text" },
    { key: "lastDayWorked", label: "Last day worked", kind: "us-date", help: "MM/DD/YYYY" },
    { key: "emplId", label: "Employee id", kind: "eid" },
    { key: "hours", label: "Hours", kind: "integer", min: 1 },
    { key: "reviewed", label: "Reviewed", kind: "boolean" },
    { key: "status", label: "Status", kind: "enum", values: ["Approved", "Pending"] },
    { key: "codes", label: "Codes", kind: "text-list" },
  ],
});

const COMPLETE_DRAFT = Object.freeze({
  note: "  filed by hand  ",
  lastDayWorked: "06/30/2026",
  emplId: "10873698",
  hours: "8",
  reviewed: true,
  status: "Approved",
  codes: "REG\n\n  OT  \n",
});

describe("an omission form starts EMPTY (D307)", () => {
  it("seeds every typed kind with nothing and only a checkbox with an answer", () => {
    // A seeded date or id would be a fabricated fact about a real person the
    // moment the operator did not touch it. `false` is a real unchecked answer,
    // which is why it is the one seeded value.
    assert.deepEqual(initialStepOmissionDraft(EVERY_KIND), {
      note: "",
      lastDayWorked: "",
      emplId: "",
      hours: "",
      reviewed: false,
      status: "",
      codes: "",
    });
  });

  it("refuses every empty typed field by name rather than filling one in", () => {
    const fold = foldStepOmissionFacts(EVERY_KIND, initialStepOmissionDraft(EVERY_KIND));
    assert.equal(fold.state, "invalid");
    if (fold.state !== "invalid") return;
    assert.deepEqual(
      Object.keys(fold.errors).sort(),
      ["emplId", "hours", "lastDayWorked", "note", "status"],
      "every kind whose declared schema requires a value must be refused when it has none",
    );
    // The two that are NOT refused are the two whose declared schema accepts
    // what an untouched control holds: a checkbox's `false` is an answer, and
    // `text-list` declares no minimum, so an empty box is an empty list. The
    // screen adds no rule the server does not have.
    assert.equal(fold.errors["reviewed"], undefined);
    assert.equal(fold.errors["codes"], undefined);
  });
});

describe("a complete draft reads as the facts the declared schema produces (D307)", () => {
  it("reads each kind as its own shape, TRIMMED exactly as the schema trims it", () => {
    const fold = foldStepOmissionFacts(EVERY_KIND, COMPLETE_DRAFT);
    assert.equal(fold.state, "facts", fold.state === "invalid" ? JSON.stringify(fold.errors) : "");
    if (fold.state !== "facts") return;
    assert.deepEqual(fold.facts, {
      // the schema's own `.trim()`, so what the operator confirms is what the
      // server receives
      note: "filed by hand",
      lastDayWorked: "06/30/2026",
      emplId: "10873698",
      hours: 8,
      reviewed: true,
      status: "Approved",
      codes: ["REG", "OT"],
    });
  });
});

describe("every kind's refusal is the declared schema's own (D307)", () => {
  const cases: readonly (readonly [string, string, string | boolean])[] = [
    ["note", "an empty text field", "   "],
    ["lastDayWorked", "a date that is not MM/DD/YYYY", "6/30/2026"],
    ["lastDayWorked", "a two-digit year", "06/30/26"],
    ["emplId", "an employee id of seven digits", "1087369"],
    ["emplId", "an employee id with a letter", "1087369X"],
    ["hours", "a number that is not whole", "8.5"],
    ["hours", "a number below the declared minimum", "0"],
    ["hours", "text where a number is asked for", "eight"],
    ["status", "a value outside the declared enum", "Rejected"],
    ["reviewed", "a string where a yes/no answer is asked for", "yes"],
  ];
  for (const [field, why, value] of cases) {
    it(`refuses ${why}, at ${field}`, () => {
      const fold = foldStepOmissionFacts(EVERY_KIND, { ...COMPLETE_DRAFT, [field]: value });
      assert.equal(fold.state, "invalid");
      if (fold.state !== "invalid") return;
      assert.deepEqual(Object.keys(fold.errors), [field], "the refusal named the wrong control");
      assert.ok((fold.errors[field] ?? "").length > 0, "a refusal with no sentence is not drawable");
    });
  }

  it("accepts an empty text-list, because the declared schema does", () => {
    // The screen never invents a rule the server does not have: `text-list`
    // declares no minimum, so an empty box is an empty list and not a refusal.
    const fold = foldStepOmissionFacts(EVERY_KIND, { ...COMPLETE_DRAFT, codes: "  \n  " });
    assert.equal(fold.state, "facts");
    if (fold.state !== "facts") return;
    assert.deepEqual(fold.facts["codes"], []);
  });
});

/**
 * A three-step workflow whose first omission forces the second out. No
 * registered descriptor declares a non-empty `forces` today, and the wire
 * serves the field regardless — the screen has to lock what the planner would
 * refuse the day one does.
 */
const CASCADING_STEPS: readonly StepOmissionStepView[] = Object.freeze([
  { key: "read", label: "Read", control: { state: "omittable", form: EVERY_KIND, forces: ["stage"] } },
  { key: "stage", label: "Stage", control: { state: "omittable", form: { fields: [] }, forces: [] } },
  { key: "finalize", label: "Finalize", control: { state: "required", reason: "This workflow requires every node in this step." } },
]);

describe("the cascade locks exactly what the planner would refuse (D307)", () => {
  it("names nobody while every step is included", () => {
    assert.deepEqual([...forcedStepOmissions(CASCADING_STEPS, ["read", "stage", "finalize"])], []);
  });

  it("takes the forced step out with the forcing one, and locks it there", () => {
    const next = toggleStepSelection(CASCADING_STEPS, ["read", "stage", "finalize"], "read", false);
    assert.deepEqual(next, ["finalize"], "omitting `read` must drag `stage` out with it");
    assert.deepEqual([...forcedStepOmissions(CASCADING_STEPS, next)], [["stage", ["read"]]]);
    // The lock is the fold's, not the checkbox's: pressing the locked row
    // changes nothing at all.
    assert.deepEqual(toggleStepSelection(CASCADING_STEPS, next, "stage", true), next);
  });

  it("puts the forced step back when the choice that held it out is undone", () => {
    const omitted = toggleStepSelection(CASCADING_STEPS, ["read", "stage", "finalize"], "read", false);
    assert.deepEqual(
      toggleStepSelection(CASCADING_STEPS, omitted, "read", true),
      ["read", "stage", "finalize"],
    );
  });

  it("never moves a required step", () => {
    const all = ["read", "stage", "finalize"];
    assert.deepEqual(toggleStepSelection(CASCADING_STEPS, all, "finalize", false), all);
  });

  it("keeps the result in timeline order however the presses arrive", () => {
    const withoutStage = toggleStepSelection(CASCADING_STEPS, ["read", "stage", "finalize"], "stage", false);
    assert.deepEqual(toggleStepSelection(CASCADING_STEPS, withoutStage, "stage", true), ["read", "stage", "finalize"]);
  });

  it("refuses a toggle for a step this workflow does not declare", () => {
    assert.throws(
      () => toggleStepSelection(CASCADING_STEPS, ["read"], "invented", false),
      /does not declare/u,
    );
  });

  it("reads the omitted steps in timeline order, and only the omittable ones", () => {
    assert.deepEqual(
      omittedStepViews(CASCADING_STEPS, ["finalize"]).map((step) => step.key),
      ["read", "stage"],
    );
  });
});
