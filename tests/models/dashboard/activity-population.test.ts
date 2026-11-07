import { describe, expect, it } from "vitest";
import { ActivityPopulationRangeSchema, ActivityPopulationSelectionSchema, ActivityPopulationSelectedRequestSchema, ActivityPopulationBrowseSchema } from "../../../src/models/dashboard/activity-population.js";
import { buildActivityVolumeBoundarySkeleton } from "../../../src/models/dashboard/activity-volume.js";
import { createActivityReportFixtures } from "../../support/helpers/dashboard/activity-report-fixtures.js";

function selection() {
  const report = createActivityReportFixtures().EMPTY;
  const skeleton = buildActivityVolumeBoundarySkeleton(report, "UTC");
  const identity = { from: report.from, to: report.to, generatedAt: report.generatedAt, expiresAt: "2026-08-07T12:15:00.000Z", sourceIdentity: "a".repeat(64), authorityGeneration: 1, reportDigest: "b".repeat(64) };
  return { report: { ...report, volume: { state: "complete", ...skeleton, coveredRuns: 0, buckets: skeleton.buckets.map(bucket => ({ ...bucket, runs: 0 })) }, snapshot: { ...identity, token: "as1.fixture.signature" } }, population: [], successfulTiming: [], snapshot: { ...identity, reportToken: "as1.fixture.signature", populationDigest: "c".repeat(64), token: "ap1.fixture.signature" } };
}

describe("browser-safe Analytics population contract", () => {
  it("parses a complete selection and refuses foreign report identity or population totals", () => {
    const valid = selection();
    expect(ActivityPopulationSelectionSchema.parse(valid)).toEqual(valid);
    for (const snapshot of [{ ...valid.snapshot, from: "2026-08-02" }, { ...valid.snapshot, reportToken: "as1.foreign.signature" }, { ...valid.snapshot, reportDigest: "d".repeat(64) }])
      expect(ActivityPopulationSelectionSchema.safeParse({ ...valid, snapshot }).success).toBe(false);
    const run = { runId: "11111111-1111-4111-8111-111111111111", workflowId: "fixture", title: "Fixture", attempt: 1, parentRunId: null, shape: "single", day: valid.report.from, status: "queued", terminal: false, durationMs: null, readback: null, receiptResult: null, warningCount: null };
    expect(ActivityPopulationSelectionSchema.safeParse({ ...valid, population: [run] }).success).toBe(false);
    expect(ActivityPopulationSelectionSchema.safeParse({ ...valid, extra: true }).success).toBe(false);
  });
  it("requires named ordered ranges, AP1 snapshot tokens and exact browse vocabulary", () => {
    const range = { from: "2026-08-01", to: "2026-08-07" };
    expect(ActivityPopulationRangeSchema.safeParse(range).success).toBe(true);
    for (const value of [{ from: range.from }, { ...range, from: "today" }, { ...range, to: "2026-07-31" }, { ...range, extra: true }])
      expect(ActivityPopulationRangeSchema.safeParse(value).success).toBe(false);
    const request = { ...range, snapshot: "ap1.fixture.signature", browse: { metric: "timed", page: 0, sort: { column: "duration", direction: "descending" } } };
    expect(ActivityPopulationSelectedRequestSchema.parse(request)).toEqual(request);
    expect(ActivityPopulationSelectedRequestSchema.safeParse({ ...request, snapshot: "as1.fixture.signature" }).success).toBe(false);
    for (const browse of [{ metric: "timed", page: -1 }, { metric: "all", page: 0 }, { metric: "timed", page: 0, extra: true }])
      expect(ActivityPopulationBrowseSchema.safeParse(browse).success).toBe(false);
  });
});
