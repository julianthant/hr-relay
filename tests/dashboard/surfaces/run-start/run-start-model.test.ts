
import assert from "node:assert/strict";
import { JsonValueSchema } from "../../../../src/rules/validation/canonical-json.js";
import { describe,it } from "vitest";
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
previewRunInput,
restoreTypedInput,
changeTypedInput,
type StartRequestShape,
type StepOmissionStepView,
} from "../../../../src/dashboard/surfaces/run-start/run-start-model.js";
import { EnqueuePolicySchema } from "../../../../src/models/workflow/presentation.js";
import { StepOmissionFormSchema,type StepOmissionForm } from "../../../../src/models/workflow/step-omission.js";
import { parsePersonLookupRequest } from "../../../../src/models/workflows/person-lookup/input.js";
import { WORKFLOW_DESCRIPTORS } from "../../../../src/workflows/descriptor-registry.js";

describe("canonical Person Lookup launch input", () => {
  const surface = WORKFLOW_DESCRIPTORS.find(workflow => workflow.id === "person-lookup")?.surfaces.inputRun;
  assert.ok(surface);
  it("merges duplicate Search people and retains selected CRM options", () => {
    const preview = previewRunInput(surface, "10000001; 10000001\nExample, Person", { mode: "search", crmCheck: true, includeCrmDates: true });
    assert.equal(preview.problem, null);
    assert.equal(preview.entries.length, 2);
    assert.deepEqual(preview.submissions, [
      { mode: "search", emplId: "10000001", crmCheck: true, keepNonHdh: false, includeCrmDates: true },
      { mode: "search", name: "Example, Person", crmCheck: true, keepNonHdh: false, includeCrmDates: true },
    ]);
  });
  it("parses Match tuples, keeps SSN out of display identity and refuses missing identifiers", () => {
    const preview = previewRunInput(surface, "Example, Person, x, 902481357; Example, Person, x, 902481357", { mode: "match", crmCheck: false, includeCrmDates: false });
    assert.equal(preview.problem, null);
    assert.deepEqual(preview.submissions, [{ mode: "match", lastName: "Example", firstName: "Person", ssn: "902481357", crmCheck: false, includeCrmDates: false }]);
    assert.deepEqual(preview.entries, [{ index: 0, sourceText: "Example, Person, x, [masked]" }]);
    const rejected = previewRunInput(surface, "Example, Person, x, x", { mode: "match", crmCheck: false, includeCrmDates: false });
    assert.match(rejected.problem ?? "", /Match requires/u);
    assert.deepEqual(rejected.submissions, []);
  });
  it("matches canonical parsing for the declared grammar and duplicate identities", () => {
    for (const [mode, text] of [
      ["search", " 10000001 ; 10000001\nExample,  Person;example, person"],
      ["match", "Example, Person, Middle, 01/15/2000, x; Example, Person, Middle, 01/15/2000, x"],
      ["match", "Person Example, x, 902481357"],
      ["match", "Example, Person, 01/15/2000, 902481357"],
    ] as const) {
      const options = { mode, crmCheck: mode === "search", includeCrmDates: false };
      assert.deepEqual(previewRunInput(surface, text, options).submissions, parsePersonLookupRequest(text, options));
    }
    for (const text of ["Example, Person, x, 902-48-1357", "Example, Person, x, 902 48 1357", "Example, , x, 902481357", "Example, Person, x, x"]) {
      assert.throws(() => parsePersonLookupRequest(text, { mode: "match" }));
      assert.ok(previewRunInput(surface, text, { mode: "match" }).problem);
    }
  });
  it("interprets renamed modes and supplied separators without workflow dispatch", () => {
    assert.ok(surface.typedInput);
    const declaration = structuredClone(surface.typedInput);
    declaration.modes[0].value = "identify";
    declaration.initialMode = "identify";
    for (const control of declaration.controls) control.modes = control.modes.map(mode => mode === "search" ? "identify" : mode);
    const parser = declaration.modes[0].parser; assert.equal(parser.kind, "entries");
    parser.spec.split = { kind: "delimited", delimiters: ["|"] };
    const preview = previewRunInput({ ...surface, typedInput: declaration }, "10000001|10000002", { mode: "identify" });
    assert.equal(preview.problem, null);
    assert.deepEqual(preview.submissions, ["10000001", "10000002"].map(emplId => ({ mode: "identify", emplId, crmCheck: true, keepNonHdh: false, includeCrmDates: false })));
  });
  it("refuses malformed source modes and identity fields and clears dependent options", () => {
    assert.ok(surface.typedInput);
    for (const input of [
      { mode: "unknown" },
      { mode: "match", crmCheck: false, includeCrmDates: false, ssn: "902481357" },
      { mode: "match", crmCheck: false, includeCrmDates: false, lastName: "Example", firstName: "Person" },
      { mode: "match", crmCheck: false, includeCrmDates: false, lastName: "Example", firstName: "Person", ssn: "bad" },
    ]) assert.throws(() => restoreTypedInput(surface.typedInput!, JsonValueSchema.parse(input)));
    assert.deepEqual(changeTypedInput(surface.typedInput, { mode: "search", crmCheck: true, keepNonHdh: true, includeCrmDates: true }, "crmCheck", false), { mode: "search", crmCheck: false, keepNonHdh: true, includeCrmDates: false });
    assert.deepEqual(changeTypedInput(surface.typedInput, { mode: "search", crmCheck: true, keepNonHdh: true, includeCrmDates: true }, "mode", "match"), { mode: "match", crmCheck: false, keepNonHdh: true, includeCrmDates: false });
  });
  it("refuses dates in Match mode or without a CRM check", () => {
    assert.ok(previewRunInput(surface, "Example, Person, 01/15/2000, x", { mode: "match", crmCheck: true, includeCrmDates: true }).problem);
    assert.ok(previewRunInput(surface, "10000001", { mode: "search", crmCheck: false, includeCrmDates: true }).problem);
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

describe("the declared active-run policy, as the modal states it", () => {
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

  it("states WHY the policy is not a control, so a locked value never reads as a broken one", () => {

    assert.match(ENQUEUE_POLICY_REASON, /Fixed by this workflow/u);
  });
});

describe("why this dialog cannot start a workflow", () => {
  it("names the modal's own precondition and does not speak for the server", () => {
    const reason = START_DOOR_ABSENCE["no-typed-input"];
    // No typed-input dialog does not forbid API input; JSON submissions still use the workflow schema.
    assert.match(reason, /this dialog/u);
    assert.doesNotMatch(reason, /refus|server|not allowed|cannot be started/u);
  });

  it("has exactly one arm, because exactly one precondition exists", () => {

    assert.deepEqual(Object.keys(START_DOOR_ABSENCE), ["no-typed-input"]);
  });
});



describe("a plan outlives no change to the request that shaped it", () => {
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

    const moved: readonly [string, StartRequestShape][] = [
      ["workflowId", { ...base, workflowId: "kuali-separation" }],
      ["text", { ...base, text: "E7654321" }],
      ["dryRun", { ...base, dryRun: true }],
      ["browserMode", { ...base, browserMode: "headed" }],
      ["captureBrowserScreenshots", { ...base, captureBrowserScreenshots: false }],
      ["priority", { ...base, priority: "bulk" }],
      ["selectedStepKeys", { ...base, selectedStepKeys: [...base.selectedStepKeys, "crm-dates"] }],

      ["stepOmissionDrafts", { ...base, stepOmissionDrafts: [{ step: "kronos-timecard", draft: { lastDayWorked: "07/31/2026" } }] }],
    ];

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

describe("run-control rail numbers match the drawn groups", () => {
  it("draws no Safety group at all for a workflow that declares no dry run", () => {

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

describe("an omission form starts EMPTY", () => {
  it("seeds every typed kind with nothing and only a checkbox with an answer", () => {
    // Seed no date or identifier: untouched controls must not fabricate a person fact; false is a valid checkbox answer.
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
    // Untouched false and an optional empty text list are schema-valid answers.
    assert.equal(fold.errors["reviewed"], undefined);
    assert.equal(fold.errors["codes"], undefined);
  });
});

describe("a complete draft reads as the facts the declared schema produces", () => {
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

describe("every kind's refusal is the declared schema's own", () => {
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


const CASCADING_STEPS: readonly StepOmissionStepView[] = Object.freeze([
  { key: "read", label: "Read", control: { state: "omittable", form: EVERY_KIND, forces: ["stage"] } },
  { key: "stage", label: "Stage", control: { state: "omittable", form: { fields: [] }, forces: [] } },
  { key: "finalize", label: "Finalize", control: { state: "required", reason: "This workflow requires every node in this step." } },
]);

describe("the cascade locks exactly what the planner would refuse", () => {
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
