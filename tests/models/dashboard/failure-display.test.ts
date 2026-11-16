import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { ErrorCodeSchema } from "../../../src/rules/identity/ids.js";
import { FailureDisplaySchema, projectFailureDisplay } from "../../../src/models/dashboard/failure-display.js";
import { failureCodeFromTaskCode } from "../../../src/models/failures/error-catalog.js";

describe("failure display", () => {
  it("keeps captured values in a strict value row with a closed outcome", () => {
    const display = { title: "Read employee", observation: "The page was unavailable.", attemptedAction: "Read Employee ID",
      lastCompleted: "Entered Employee ID", field: { label: "Employee ID", value: "10000001", outcome: "Entered" } };
    assert.deepEqual(FailureDisplaySchema.parse(display), display);
    assert.equal(FailureDisplaySchema.safeParse({ ...display, field: { ...display.field, outcome: "Unknown" } }).success, false);
    assert.equal(FailureDisplaySchema.safeParse({ ...display, field: { ...display.field, raw: "Unclassified" } }).success, false);
  });
  it("describes an approved employment-record mismatch under the declared task code", () => {
    assert.deepEqual(projectFailureDisplay({ code: ErrorCodeSchema.parse(failureCodeFromTaskCode("employment-record-mismatch")) }), {
      title: "Employment record mismatch",
      observation: "The observed employment record differs from the approved target.",
    });
  });
  it("preserves the employee identity mismatch copy", () => {
    assert.deepEqual(projectFailureDisplay({ code: ErrorCodeSchema.parse("SUBJECT_MISMATCH") }), {
      title: "Employee identity mismatch",
      observation: "The observed identity differs from the expected subject.",
    });
  });
});
