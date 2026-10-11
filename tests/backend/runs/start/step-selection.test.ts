import assert from "node:assert/strict";
import { describe,it } from "vitest";
import {
applyStartStepSelection,
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

describe("start step selection", () => {
  it("projects the current conditional person-lookup step as selectable", () => {
    assert.deepEqual(
      projectStartSteps(personLookupDescriptor).map(({ key, includedByDefault, control }) => ({
        key, includedByDefault, state: control.state,
      })),
      [
        { key: "searching", includedByDefault: true, state: "required" },
        { key: "cross-verify", includedByDefault: true, state: "required" },
        { key: "active-status", includedByDefault: true, state: "required" },
        { key: "crm-dates", includedByDefault: false, state: "selectable" },
      ],
    );
  });

  it("writes an enabled optional step into the submission the planner parses", () => {
    const selected = projectStartSteps(personLookupDescriptor).map(({ key }) => key);
    assert.deepEqual(
      applyStartStepSelection(personLookupDescriptor, {
        emplId: "10873698", keepNonHdh: false, includeCrmDates: false,
      }, selected),
      { emplId: "10873698", keepNonHdh: false, includeCrmDates: true },
    );
  });

  it("projects Separations' three omittable write-side steps and keeps its read steps required", () => {
    const steps = projectStartSteps(separationsDescriptor);
    assert.deepEqual(
      steps.map(({ key, control }) => [key, control.state]),
      [
        ["kuali-extraction", "required"],
        ["identity-check", "required"],
        ["job-summary", "required"],
        ["kronos-timecard", "omittable"],
        ["ucpath-transaction", "omittable"],
        ["kuali-finalization", "omittable"],
      ],
    );
    for (const step of steps) {
      if (step.control.state === "omittable") assert.deepEqual(step.control.forces, []);
    }
    // Omitting a REQUIRED read step still refuses by name.
    assert.throws(
      () => applyStartStepSelection(
        separationsDescriptor,
        { documentNumber: "123456" },
        steps.slice(1).map(({ key }) => key),
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

  it("leaves Person Lookup steps locked", () => {
    assert.ok(
      projectStartSteps(personLookupDescriptor).every(({ control }) => control.state !== "omittable"),
      String(personLookupDescriptor.id),
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
      [{ step: "reading", facts: READING_FACTS }, { step: "auditing", facts: AUDITING_FACTS }],
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
      [{ step: "reading", facts: READING_FACTS }, { step: "folding", facts: { folded: "typed" } }],
    );
  });
});
