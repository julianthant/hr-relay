import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { PendingImplBindingsSchema } from "../../../../../src/workflow-kit/validation/impl-bindings.js";

const valid = {
  milestone: "1f",
  reason: "implementation pending",
  tasks: [{ taskId: "crm/read-onboarding-record", workflowId: "person-lookup", note: "tracked" }],
} as const;

describe("pending implementation binding declaration", () => {
  it("accepts a named task, workflow and nonempty reason without changing the values", () => {
    assert.deepEqual(PendingImplBindingsSchema.parse(valid), valid);
  });

  it("refuses undeclared fields at both declaration and task boundaries", () => {
    assert.equal(PendingImplBindingsSchema.safeParse({ ...valid, extra: true }).success, false);
    assert.equal(PendingImplBindingsSchema.safeParse({
      ...valid, tasks: [{ ...valid.tasks[0], extra: true }],
    }).success, false);
  });

  it("refuses blank provenance and malformed task or workflow identifiers", () => {
    assert.equal(PendingImplBindingsSchema.safeParse({ ...valid, reason: "" }).success, false);
    assert.equal(PendingImplBindingsSchema.safeParse({
      ...valid, tasks: [{ ...valid.tasks[0], note: "" }],
    }).success, false);
    assert.equal(PendingImplBindingsSchema.safeParse({
      ...valid, tasks: [{ ...valid.tasks[0], taskId: "not-a-task-id" }],
    }).success, false);
    assert.equal(PendingImplBindingsSchema.safeParse({
      ...valid, tasks: [{ ...valid.tasks[0], workflowId: "Not_A_Workflow" }],
    }).success, false);
  });
});
