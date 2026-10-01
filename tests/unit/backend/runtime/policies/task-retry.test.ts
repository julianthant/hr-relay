import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { shouldRetryTaskFailure } from "../../../../../src/backend/runtime/policies/task-retry.js";

describe("failed task attempt decision", () => {
  it("retries only a transient failure with an attempt still available", () => {
    assert.equal(shouldRetryTaskFailure(true, 1, 2), true);
    assert.equal(shouldRetryTaskFailure(true, 2, 2), false);
    assert.equal(shouldRetryTaskFailure(false, 1, 2), false);
    assert.equal(shouldRetryTaskFailure(false, 2, 2), false);
  });
});
