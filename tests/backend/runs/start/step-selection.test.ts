import { z } from "zod";
import { flow } from "../../../../src/workflow-kit/flow.js";
import { defineWorkflowDescriptor } from "../../../../src/workflow-kit/workflow.js";
import { EidSchema } from "../../../../src/rules/identity/ids.js";
import { defineCanonicalInput } from "../../../../src/models/workflow/canonical-input.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../../src/models/workflow/presentation.js";
import { FixtureReadReceipt } from "../../../support/fixtures/descriptor-fixtures.js";
import { HASH_A } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import assert from "node:assert/strict";
import { describe,it } from "vitest";
import {
applyStartStepSelection,
projectStartRows,
projectStartSteps,
resolveStartStepOmissions,
StartStepOmissionRefusedError,
} from "../../../../src/backend/runs/start/step-selection.js";
import {
omissionAssertingDescriptor,
omissionBlockedDescriptor,
omissionCascadingDescriptor,
READING_FORM,
} from "../../../support/fixtures/start-step-omission-fixtures.js";
import { personLookupDescriptor,separationsDescriptor } from "../../../support/helpers/registered-workflows.js";
import { WORKFLOW_MODULES } from "../../../../src/backend/app/registries/workflow-registry.js";

const READING_LABELS = { effectiveDate: "Effective date", eid: "Employee id" };

describe("start step selection", () => {
  it("projects the current conditional person-lookup step as selectable", () => {
    assert.deepEqual(
      projectStartSteps(personLookupDescriptor).map(({ key, includedByDefault, control }) => ({
        key, includedByDefault, state: control.state,
      })),
      [
        { key: "reference-check", includedByDefault: true, state: "required" },
        { key: "searching", includedByDefault: true, state: "omittable" },
        { key: "cross-verify", includedByDefault: true, state: "selectable" },
        { key: "active-status", includedByDefault: true, state: "omittable" },
        { key: "crm-dates", includedByDefault: true, state: "selectable" },
      ],
    );
  });

  it("writes an enabled optional step into the submission the planner parses", () => {
    const selected = projectStartSteps(personLookupDescriptor).map(({ key }) => key);
    assert.deepEqual(
      applyStartStepSelection(personLookupDescriptor, {
        emplId: "10873698", keepNonHdh: false, includeCrmDates: false,
      }, selected),
      { emplId: "10873698", keepNonHdh: false, includeCrmDates: true, crmCheck: true },
    );
  });

  it("projects every Separations step as omittable except the reference check, which runs under Verify employee identity", () => {
    const steps = projectStartSteps(separationsDescriptor);
    assert.deepEqual(
      steps.map(({ key, control }) => [key, control.state, control.state === "omittable" ? control.forces : []]),
      [
        ["reference-check", "required", []],
        ["kuali-extraction", "omittable", ["identity-check", "identity-review", "kuali-finalization"]],
        ["identity-check", "omittable", ["identity-review"]],
        ["kronos-timecard", "omittable", []],
        ["identity-review", "omittable", []],
        ["pending-termination", "omittable", []],
        ["ucpath-transaction", "omittable", []],
        ["kuali-finalization", "omittable", []],
      ],
    );
    // The reference check has no row of its own, so leaving it out still refuses by name.
    assert.throws(
      () => applyStartStepSelection(
        separationsDescriptor,
        { documentNumber: "123456" },
        steps.filter(({ key }) => key !== "reference-check").map(({ key }) => key),
      ),
      /is required and cannot be omitted/,
    );
  });
});


describe("start step omission projection", () => {
  it("projects a declared omission whose cascade is clean as omittable", () => {
    const steps = projectStartSteps(omissionAssertingDescriptor);
    assert.deepEqual(
      steps.map(({ key, includedByDefault, control }) => ({ key, includedByDefault, state: control.state })),
      [
        { key: "reading", includedByDefault: true, state: "omittable" },
        { key: "folding", includedByDefault: true, state: "required" },
        { key: "auditing", includedByDefault: true, state: "omittable" },
      ],
    );
    const reading = steps[0]?.control;
    assert.ok(reading?.state === "omittable");
    // The step folder's own form travels verbatim — the screen draws it, and a
    // restated vocabulary is how a wire and a planner drift.
    assert.deepEqual(reading.form, READING_FORM);
    // `read` is rebuilt from the typed facts, so `fold` still reads a value
    // and nothing is dragged out with the choice.
    assert.deepEqual(reading.forces, []);
  });

  it("names the steps a legal omission forces out, in timeline order", () => {
    const reading = projectStartSteps(omissionCascadingDescriptor)[0]?.control;
    assert.ok(reading?.state === "omittable");
    assert.deepEqual(reading.forces, ["folding"]);
    // The forced step is itself omittable and forces nothing further.
    const folding = projectStartSteps(omissionCascadingDescriptor)[1]?.control;
    assert.ok(folding?.state === "omittable");
    assert.deepEqual(folding.forces, []);
  });

  it("projects a blocked omission as required, naming the step that must run", () => {
    const reading = projectStartSteps(omissionBlockedDescriptor)[0]?.control;
    assert.ok(reading?.state === "required");
    assert.equal(
      reading.reason,
      'Omitting this step would also require omitting "Folding", which must run.',
    );
  });

  it("offers only Person Lookup's two required reading steps for manual entry", () => {
    assert.deepEqual(
      projectStartSteps(personLookupDescriptor).filter(({ control }) => control.state === "omittable").map(({ key }) => key),
      ["searching", "active-status"],
    );
  });
});

const READING_FACTS = { eid: "10873698", effectiveDate: "01/02/2026" };
const AUDITING_FACTS = { reviewed: true };

function refusal(run: () => unknown): StartStepOmissionRefusedError {
  try {
    run();
  } catch (error) {
    assert.ok(error instanceof StartStepOmissionRefusedError, `threw ${String(error)}`);
    return error;
  }
  return assert.fail("the omission was accepted");
}

describe("resolveStartStepOmissions", () => {
  it("returns the omitted steps in timeline order, whatever order they were submitted in", () => {
    assert.deepEqual(
      resolveStartStepOmissions(
        omissionAssertingDescriptor,
        ["folding"],
        [{ step: "auditing", facts: AUDITING_FACTS }, { step: "reading", facts: READING_FACTS }],
      ),
      [{ step: "reading", facts: READING_FACTS, labels: READING_LABELS }, { step: "auditing", facts: AUDITING_FACTS, labels: { reviewed: "Reviewed" } }],
    );
  });

  it("returns undefined when every omittable step is selected to run", () => {
    assert.equal(
      resolveStartStepOmissions(omissionAssertingDescriptor, ["reading", "folding", "auditing"], undefined),
      undefined,
    );
  });

  it("refuses omissions submitted without an explicit step selection", () => {
    assert.equal(
      refusal(() => resolveStartStepOmissions(
        omissionAssertingDescriptor,
        undefined,
        [{ step: "reading", facts: READING_FACTS }],
      )).code,
      "selection-required",
    );
  });

  it("refuses an omitted step that carries no typed facts at all", () => {
    const error = refusal(() => resolveStartStepOmissions(
      omissionAssertingDescriptor,
      ["folding", "auditing"],
      undefined,
    ));
    assert.equal(error.code, "facts-missing");
    assert.match(error.message, /start step reading is omitted and carries no typed facts/u);
  });

  it("refuses facts for a step the operator selected to run", () => {
    assert.equal(
      refusal(() => resolveStartStepOmissions(
        omissionAssertingDescriptor,
        ["reading", "folding", "auditing"],
        [{ step: "reading", facts: READING_FACTS }],
      )).code,
      "step-not-omitted",
    );
  });

  it("refuses facts for a step that declares no omission", () => {
    assert.equal(
      refusal(() => resolveStartStepOmissions(
        omissionBlockedDescriptor,
        ["reading", "auditing"],
        [{ step: "folding", facts: { folded: "typed" } }],
      )).code,
      "step-not-omittable",
    );
  });

  it("refuses facts for a step whose declared omission the cascade blocks", () => {
    assert.equal(
      refusal(() => resolveStartStepOmissions(
        omissionBlockedDescriptor,
        ["folding", "auditing"],
        [{ step: "reading", facts: READING_FACTS }],
      )).code,
      "step-not-omittable",
    );
  });

  it("refuses a step that is not on this workflow's timeline", () => {
    assert.equal(
      refusal(() => resolveStartStepOmissions(
        omissionAssertingDescriptor,
        ["folding", "auditing"],
        [{ step: "reading", facts: READING_FACTS }, { step: "invoicing", facts: {} }],
      )).code,
      "unknown-step",
    );
  });

  it("refuses the same step omitted twice", () => {
    assert.equal(
      refusal(() => resolveStartStepOmissions(
        omissionAssertingDescriptor,
        ["folding", "auditing"],
        [{ step: "reading", facts: READING_FACTS }, { step: "reading", facts: READING_FACTS }],
      )).code,
      "duplicate-step",
    );
  });

  it("names the field key a fact fails on, and never the value", () => {
    const error = refusal(() => resolveStartStepOmissions(
      omissionAssertingDescriptor,
      ["folding", "auditing"],
      [{ step: "reading", facts: { eid: "10873698", effectiveDate: "2026-01-02" } }],
    ));
    assert.equal(error.code, "facts-invalid");
    assert.match(error.message, /omission facts are invalid at: effectiveDate$/u);
    // The typed facts are operator input about a real person; a refusal that
    // echoed them would put them in a wire body and a log line at once.
    assert.ok(!error.message.includes("2026-01-02"));
    assert.ok(!error.message.includes("10873698"));
  });

  it("refuses an omission the operator's own selection leaves unread", () => {

    const error = refusal(() => resolveStartStepOmissions(
      omissionCascadingDescriptor,
      ["folding", "auditing"],
      [{ step: "reading", facts: READING_FACTS }],
    ));
    assert.equal(error.code, "cascade-refused");
    assert.match(error.message, /\[dependency-omitted\]: node "fold" \(step "folding"\) reads "read"/u);
  });

  it("accepts the same omission once the forced step travels with it", () => {
    assert.deepEqual(
      resolveStartStepOmissions(
        omissionCascadingDescriptor,
        ["auditing"],
        [{ step: "reading", facts: READING_FACTS }, { step: "folding", facts: { folded: "typed" } }],
      ),
      [{ step: "reading", facts: READING_FACTS, labels: READING_LABELS }, { step: "folding", facts: { folded: "typed" }, labels: { folded: "Folded" } }],
    );
  });
});

function authoredSelection(options: Readonly<{
  inputField?: string; nonBoolean?: boolean; missingDefault?: boolean; booleanSample?: boolean;
  contradictory?: boolean; omission?: boolean;
}> = {}) {
  const enabled = options.nonBoolean ? z.union([z.boolean(), z.string()]) : z.boolean();
  const input = z.strictObject({ eid: EidSchema, enabled: enabled.default(true) });
  const canonical = defineCanonicalInput(input, z.strictObject({ eid: EidSchema, enabled }),
    [{ eid: "10873698", enabled: options.nonBoolean && !options.booleanSample ? "yes" : true }]);
  return defineWorkflowDescriptor({
    id: "authored-start-selection", version: 1, contractFingerprint: HASH_A,
    code: "ass", label: "Authored selection", icon: "Search", category: "operations",
    canonicalInput: canonical, inputSubject: "eid", surface: { shape: "single" },
    enqueue: "reject-active", actions: STANDARD_WORKFLOW_ACTIONS,
    surfaces: { inputRun: { placeholder: "Employee ID", parser: {
      split: { kind: "delimited", delimiters: [";"] },
      rules: [{ when: { kind: "otherwise" }, emit: "eid" }],
      constants: options.missingDefault ? [] : [{ field: "enabled", value: { kind: "boolean", value: true } }],
    }, examples: [{ key: "one", label: "One", text: "10873698", note: "One person" }] } },
    details: [], identity: { matchKey: value => value.eid },
    presentation: { title: value => value.eid }, scenarios: ["ucpath/person-org-happy"],
    timeline: [{ key: "reading", label: "Read", nodes: ["read"],
      selection: { inputField: options.inputField ?? "enabled", selectedWhen: true },
      ...(options.omission ? { manual: { form: READING_FORM, produces: {}, skips: ["read"] } } : {}),
    }],
    flow: flow(input).step("read", FixtureReadReceipt, { dependsOn: [], replay: "checkpoint",
      when: { kind: options.contradictory ? "is-false" : "is-true", of: { from: "input", path: "enabled" } },
      bind: ({ input: value }) => ({ eid: value.eid }),
    }).build({ schema: z.strictObject({ eid: EidSchema }), dependsOn: [],
      derive: ({ input: value }) => ({ eid: value.eid }),
    }),
  });
}

describe("authored start selection admission", () => {
  it("retains the two real PL controls and refuses invalid declarations", () => {
    assert.deepEqual(projectStartSteps(personLookupDescriptor).flatMap(step =>
      step.control.state === "selectable" ? [step.control.inputField] : []), ["crmCheck", "includeCrmDates"]);
    assert.equal(projectStartSteps(authoredSelection())[0].control.state, "selectable");
    for (const [options, reason] of [
      [{ inputField: "unknown" }, /selection/],
      [{ nonBoolean: true }, /field must be boolean/],
      [{ nonBoolean: true, booleanSample: true }, /field must be boolean/],
      [{ missingDefault: true }, /requires a boolean default/],
      [{ contradictory: true }, /contradicts its condition/],
    ] as const) assert.throws(() => authoredSelection(options), reason);
    assert.equal(projectStartSteps(authoredSelection({ omission: true }))[0].control.state, "selectable");
  });
});

describe("served start rows", () => {
  const SERVED_ROWS: Readonly<Record<string, readonly (readonly [string, string, string | null])[]>> = {
    "person-lookup": [["searching", "switch", null], ["cross-verify", "switch", null], ["active-status", "switch", null], ["crm-dates", "switch", null]],
    separations: [["kuali-extraction", "switch", null], ["identity-check", "switch", null], ["kronos-timecard", "switch", null], ["identity-review", "switch", null],
      ["pending-termination", "switch", null], ["submit-termination", "switch", null], ["kuali-finalization", "switch", null]],
    onboarding: [["crm-data", "switch", null], ["ucpath-search", "switch", null], ["i9-search", "switch", null], ["hire-review", "switch", null],
      ["reference-check", "switch", null], ["i9-creation", "switch", null], ["ucpath-hire", "switch", null], ["master-results", "switch", null]],
    "work-study": [["ucpath-auth", "switch", null], ["transaction", "switch", null]],
    "i9-check-start": [["documents", "switch", null], ["ocr-source-pages", "switch", null], ["read-forms", "switch", null],
      ["ocr-group-records", "switch", null], ["match-people", "switch", null], ["ocr-signer-lookups", "switch", null], ["review-records", "switch", null],
      ["roster-reference", "switch", null], ["ucpath-match", "switch", null], ["ucpath-dates", "switch", null], ["retention", "switch", null], ["tracker-row", "switch", null]],
    "crm-doc-download": [["search-records", "switch", null], ["reference", "switch", null], ["read-idocs", "switch", null], ["package-worksheets", "switch", null]],
    "emergency-contact": [["ocr-source-pages", "switch", null], ["read-emergency-contact", "switch", null], ["ocr-group-records", "switch", null],
      ["match-extracted-people", "switch", null], ["ocr-signer-lookups", "switch", null], ["review-extracted-records", "switch", null],
      ["read-existing-contacts", "locked", "bound-read"], ["fill-emergency-contact", "locked", "form-action"], ["save-emergency-contact", "locked", "form-action"]],
  };

  it("serves one row per step with its kind and lock reason for every public workflow", () => {
    assert.deepEqual(Object.fromEntries(WORKFLOW_MODULES.map(({ descriptor }) => [String(descriptor.id),
      projectStartRows(descriptor).map((row) => [row.key, row.kind, row.lockReason ?? null])])), SERVED_ROWS);
  });

  it("omits nothing for every public workflow when every switch is on and nothing is typed", () => {
    for (const { descriptor } of WORKFLOW_MODULES) {
      assert.equal(resolveStartStepOmissions(descriptor, projectStartSteps(descriptor).map(({ key }) => key), undefined), undefined, String(descriptor.id));
    }
  });
});
