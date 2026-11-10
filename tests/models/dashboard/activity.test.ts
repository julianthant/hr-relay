import { describe, expect, it } from "vitest";
import { ActivityFailureTotalSchema, ActivityWorkflowTotalSchema } from "../../../src/models/dashboard/activity.js";

const workflow = { workflowId: "fixture", registration: { state: "unregistered", reason: "No registry entry" }, runs: 3,
  completion: { readBack: 1, warnings: 0, warningsUnknown: 0 }, failed: 1, needsAttention: 1, cancelled: 0, partial: 0, open: 1,
  typicalTime: { measure: "successful-root-run-mean", measuredRuns: 1, unmeasuredRuns: 0, meanMs: { state: "present", value: 0 } } };

describe("Analytics outcome and failure rows", () => {
  it("requires exact failed attention and explicit successful-root mean coverage", () => {
    expect(ActivityWorkflowTotalSchema.safeParse(workflow).success).toBe(true);
    for (const value of [{ ...workflow, needsAttention: 2 }, { ...workflow, extra: true },
      { ...workflow, typicalTime: { ...workflow.typicalTime, measuredRuns: 0 } },
      { ...workflow, typicalTime: { ...workflow.typicalTime, unmeasuredRuns: 1 } },
      { ...workflow, typicalTime: { ...workflow.typicalTime, meanMs: { state: "absent", reason: "Missing" } } },
      { ...workflow, typicalTime: { ...workflow.typicalTime, meanMs: { state: "present", value: -1 } } },
      { ...workflow, typicalTime: { ...workflow.typicalTime, measure: "median" } }])
      expect(ActivityWorkflowTotalSchema.safeParse(value).success).toBe(false);
  });

  it("requires workflow identity, registration state and operator sentence for failures", () => {
    const failure = { workflowId: "fixture", registration: workflow.registration, code: "FIXTURE_FAILURE", sentence: "A plain failure reason.", runs: 1, transient: 0, sample: [] };
    expect(ActivityFailureTotalSchema.safeParse(failure).success).toBe(true);
    for (const value of [{ ...failure, sentence: "" }, { ...failure, workflowId: "" }, { ...failure, registration: { state: "registered" } }, { ...failure, extra: true }])
      expect(ActivityFailureTotalSchema.safeParse(value).success).toBe(false);
  });
});
