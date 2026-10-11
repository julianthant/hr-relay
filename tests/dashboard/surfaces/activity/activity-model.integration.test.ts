import assert from "node:assert/strict";
import { describe,it } from "vitest";
import {
activityPeopleEvidenceItems,
activityPeriodOf,
activityPeriodRange,
activityRangeLabel,
activityRangeValue,
parseActivityRange,
resolveActivityWho,
type QueueRowIdentity,
} from "../../../../src/dashboard/surfaces/activity/activity-model.js";
import { buildActivityVolumeBoundarySkeleton } from "../../../../src/models/dashboard/activity-volume.js";
import {
ActivityReportWireSchema,
type ActivityReportWire,
} from "../../../../src/models/dashboard/activity.js";

const RUN_A = "11111111-1111-4111-8111-111111111111";
const RUN_B = "22222222-2222-4222-8222-222222222222";

function report(overrides: Record<string, unknown> = {}): ActivityReportWire {
  const value = {
    wireVersion: 1,
    from: "2026-09-08",
    to: "2026-09-09",
    generatedAt: "2026-09-09T12:00:00.000Z",
    totalRuns: 2,
    terminalRuns: 0,
    inFlightRuns: 2,
    people: { state: "present", distinct: 1, evidenceRows: 2 },
    completion: { readBack: 0, warnings: 0, warningsUnknown: 0 },
    days: [{ day: "2026-09-08", runs: 1 }, { day: "2026-09-09", runs: 1 }],
    workflows: [{
      workflowId: "separations",
      registration: { state: "registered", code: "sp", label: "Separations", categoryId: "employment" },
      runs: 2,
      completion: { readBack: 0, warnings: 0, warningsUnknown: 0 },
      failed: 0,
      cancelled: 0,
      partial: 0,
      open: 2,
    }],
    categories: [{ category: { state: "registered", categoryId: "employment" }, runs: 2 }],
    statuses: [{ status: "queued", runs: 2, sample: [RUN_A, RUN_B] }],
    outcomes: [],
    failures: [],
    durations: {
      measuredRuns: 0,
      unmeasuredRuns: 0,
      medianMs: { state: "absent", reason: "no terminal run in range carries both a start and an end instant" },
      longestMs: { state: "absent", reason: "no terminal run in range carries both a start and an end instant" },
      totalMs: 0,
    },
    ledger: { systems: [] },
    ...overrides,
  };
  const from = typeof value.from === "string" ? value.from : "2026-09-08";
  const to = typeof value.to === "string" ? value.to : "2026-09-09";
  const totalRuns = typeof value.totalRuns === "number" ? value.totalRuns : 2;
  const days = Array.isArray(value.days) ? value.days as { day: string; runs: number }[] : [];
  const volumeSkeleton = buildActivityVolumeBoundarySkeleton({ from, to }, "UTC");
  const dayCounts = new Map(days.map(({ day, runs }) => [day, runs]));
  const buckets = volumeSkeleton.buckets.map((bucket, index) => ({
    ...bucket,
    runs: volumeSkeleton.granularity === "daily"
      ? dayCounts.get(bucket.start.slice(0, 10)) ?? 0
      : index === 0 ? totalRuns : 0,
  }));
  const volume = { state: "complete" as const, ...volumeSkeleton, coveredRuns: buckets.reduce((sum, bucket) => sum + bucket.runs, 0), buckets };
  return ActivityReportWireSchema.parse({ ...value, volume });
}

const queueRow: QueueRowIdentity = {
  runId: RUN_A,
  workflowId: "separations",
  traceId: "sp-20260909-0001",
  title: "System title",
  displayName: { state: "present", value: "Named by operator" },
};

describe("Activity consumes the served summary boundary", () => {
  it("uses validated canonical identity language and never revives retired pseudonym claims", () => {
    const items = activityPeopleEvidenceItems(report().people);
    assert.match(items.join(" "), /validated canonical identity/u);
    assert.match(items.join(" "), /only the count reaches/u);
    assert.doesNotMatch(items.join(" "), /pseudonym|key generation/u);
  });

  it("resolves a sampled run only from Queue rows already held and names an absent row by id", () => {
    const value = report();
    assert.deepEqual(resolveActivityWho(RUN_A, [queueRow], value), {
      runId: RUN_A,
      name: { state: "present", value: "Named by operator" },
      workflowLabel: "Separations",
      traceId: queueRow.traceId,
    });
    assert.deepEqual(resolveActivityWho(RUN_B, [queueRow], value), {
      runId: RUN_B,
      name: {
        state: "absent",
        reason: "this run is not among the queue rows loaded for the day on screen, so its name is not known here",
      },
      workflowLabel: undefined,
      traceId: undefined,
    });
  });

  it("keeps a valid URL range explicit and refuses invalid explicit selections without substituting month-to-date", () => {
    const valid = parseActivityRange("2026-09-08..2026-09-09", "2026-09-10");
    assert.deepEqual(valid, { from: "2026-09-08", to: "2026-09-09" });
    assert.equal(activityRangeValue(valid), "2026-09-08..2026-09-09");
    assert.equal(activityRangeLabel(valid.from, valid.to), "09/08/2026 – 09/09/2026");
    assert.deepEqual(activityPeriodRange("week", "2026-09-10"), { from: "2026-09-06", to: "2026-09-10" });
    assert.equal(activityPeriodOf({ from: "2026-09-06", to: "2026-09-10" }, "2026-09-10"), "week");
    assert.deepEqual(parseActivityRange("", "2026-09-10"), {
      from: "2026-09-01",
      to: "2026-09-10",
    });
    for (const input of ["2026-09-10..2026-09-08", "2026-02-30..2026-03-01", "2026-09-08..", "2026-09-08..2026-09-09..extra"]) {
      assert.match(parseActivityRange(input, "2026-09-10").refusal ?? "", /requested range was not replaced/u);
    }
  });

});
