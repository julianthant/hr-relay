import assert from "node:assert/strict";
import { describe,it } from "vitest";
import {
REVIEWED_UNVERIFIABLE_BY_PAGE_POLICY,
defineReviewedUnverifiableByPagePolicy,
} from "../../../src/models/task/write-safety.js";
import { TaskIdSchema } from "../../../src/rules/identity/ids.js";

describe("sealed task contracts", () => {

  it("recursively freezes reviewed unverifiable-by-page policy entries", () => {
    const policy = defineReviewedUnverifiableByPagePolicy({
      schemaVersion: 1,
      contracts: [{
        taskId: TaskIdSchema.parse("onbase/upload-document"),
        reason: "the reviewed page cannot expose a durable receipt",
      }],
    });
    assert.equal(Object.isFrozen(policy), true);
    assert.equal(Object.isFrozen(policy.contracts), true);
    assert.equal(Object.isFrozen(policy.contracts[0]), true);
    assert.equal(Reflect.set(policy.contracts[0], "reason", "mutated"), false);
    assert.equal(policy.contracts[0]?.reason, "the reviewed page cannot expose a durable receipt");
    assert.equal(Object.isFrozen(REVIEWED_UNVERIFIABLE_BY_PAGE_POLICY), true);
    assert.equal(Object.isFrozen(REVIEWED_UNVERIFIABLE_BY_PAGE_POLICY.contracts), true);
  });
});
