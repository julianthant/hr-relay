import assert from "node:assert/strict";
import { describe,it } from "vitest";
import { BoundaryFailureSchema } from "../../../src/models/failures/boundary-failure.js";

describe("strict domain primitives", () => {

  it("keeps boundary issue objects closed", () => {
    const failure = {
      kind: "boundary-failure",
      source: "config",
      summary: "invalid value",
      issues: [{ path: ["timeouts", "taskMs"], code: "too_small", message: "must be positive" }],
    };
    assert.equal(BoundaryFailureSchema.safeParse(failure).success, true);
    assert.equal(BoundaryFailureSchema.safeParse({
      ...failure,
      issues: [{ ...failure.issues[0], leaked: true }],
    }).success, false);
  });
});
