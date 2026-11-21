import { describe, expect, it } from "vitest";
import { ActivityFailureTotalSchema, ActivityWorkflowTotalSchema, ActivityReportWireSchema } from "../../../src/models/dashboard/activity.js";
import { createActivityReportFixtures } from "../../support/helpers/dashboard/activity-report-fixtures.js";

const day = { day: "2026-08-03", runs: 3, outcomes: { done: 1, failed: 1, attention: 0 }, typicalTime: { measuredRuns: 1, medianMs: { state: "present", value: 0 } } };
const workflow = { workflowId: "fixture", registration: { state: "unregistered", reason: "No registry entry" }, runs: 3,
  completion: { readBack: 1, warnings: 0, warningsUnknown: 0 }, failed: 1, needsAttention: 1, cancelled: 0, partial: 0, open: 1,
  typicalTime: { measure: "successful-root-run-mean", measuredRuns: 1, unmeasuredRuns: 0, meanMs: { state: "present", value: 0 } },
  typicalMedian: { measuredRuns: 1, medianMs: { state: "present", value: 0 } },
  outcomes: { done: 1, failed: 1, attention: 0 }, days: [day],
  failedAt: [{ state: "unavailable", reason: "the failed run has no task span that records the step where it failed", runs: 1 }] };

describe("Analytics outcome and failure rows", () => {
  it("requires assistant series to cover exactly the selected report dates in order", () => {
    const { EMPTY } = createActivityReportFixtures();
    expect(ActivityReportWireSchema.safeParse(EMPTY).success).toBe(true);
    for (const field of ["assistantMessages", "assistantActions"] as const) {
      const series = EMPTY[field], days = series.days;
      for (const invalid of [days.slice(1), [...days].reverse(), [...days, days[0]], days.map(() => days[0])]) {
        expect(ActivityReportWireSchema.safeParse({ ...EMPTY, [field]: { ...series, days: invalid } }).success).toBe(false);
      }
    }
  });

  it("requires nonnegative integer counts and explicit unrecorded tools and approvals", () => {
    const { EMPTY } = createActivityReportFixtures();
    for (const count of [-1, 0.5]) {
      expect(ActivityReportWireSchema.safeParse({ ...EMPTY, assistantMessages: { ...EMPTY.assistantMessages,
        days: EMPTY.assistantMessages.days.map(row => ({ ...row, count })) } }).success).toBe(false);
      expect(ActivityReportWireSchema.safeParse({ ...EMPTY, assistantActions: { ...EMPTY.assistantActions,
        days: EMPTY.assistantActions.days.map(row => ({ ...row, proposed: count })) } }).success).toBe(false);
    }
    expect(ActivityReportWireSchema.safeParse({ ...EMPTY, assistantTools: { state: "recorded", count: 0 } }).success).toBe(false);
    expect(ActivityReportWireSchema.safeParse({ ...EMPTY, assistantActions: { ...EMPTY.assistantActions, approved: 0 } }).success).toBe(false);
  });

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
