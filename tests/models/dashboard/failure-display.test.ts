import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { ErrorCodeSchema } from "../../../src/rules/identity/ids.js";
import { projectFailureDisplay } from "../../../src/models/dashboard/failure-display.js";
import { failureCodeFromTaskCode } from "../../../src/models/failures/error-catalog.js";

describe("failure display", () => {
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
