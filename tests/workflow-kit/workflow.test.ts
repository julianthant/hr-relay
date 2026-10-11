import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { defineWorkflowStep } from "../../src/workflow-kit/workflow.js";

describe("workflow flow builder", () => {
  describe("workflow steps", () => {
    it("refuses a step whose folder key is not a kebab-case slug", () => {
      assert.throws(
        () => defineWorkflowStep({ key: "Not Kebab", label: "Invalid folder" }),
        /timeline category key must be a kebab-case slug/,
      );
    });
  });
});
