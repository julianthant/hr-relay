import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { applyStartStepSelection, projectStartSteps } from "../../src/services/start/step-selection.js";
import { personLookupDescriptor } from "../../src/workflows/person-lookup/descriptor.js";
import { separationsDescriptor } from "../../src/workflows/separations/descriptor.js";

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

  it("refuses an omitted required separations step", () => {
    const steps = projectStartSteps(separationsDescriptor);
    assert.ok(steps.every(({ control }) => control.state === "required"));
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
