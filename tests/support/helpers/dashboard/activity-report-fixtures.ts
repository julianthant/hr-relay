import { operatorFailureSentence } from "../../../../src/models/failures/error-catalog.js";
import { ACTIVITY_MEDIAN_ABSENT_REASON, ActivityReportWireSchema, type ActivityReportWire } from "../../../../src/models/dashboard/activity.js";

const NO_FAILED_STEP = "the failed run has no task span that records the step where it failed";
const ABSENT_MEDIAN = { measuredRuns: 0, medianMs: { state: "absent" as const, reason: ACTIVITY_MEDIAN_ABSENT_REASON } };

export function createActivityReportFixtures() {
  const EMPTY: ActivityReportWire = ActivityReportWireSchema.parse({
    wireVersion: 1,
    from: "2026-08-01",
    to: "2026-08-07",
    generatedAt: "2026-08-07T12:00:00.000Z",
    totalRuns: 0,
    terminalRuns: 0,
    inFlightRuns: 0,
    people: { state: "present", distinct: 0, evidenceRows: 0 },
    completion: { readBack: 0, warnings: 0, warningsUnknown: 0 },
    outcomeSplit: { done: 0, failed: 0, attention: 0 },
    typicalMedian: ABSENT_MEDIAN,
    days: [],
    workflows: [],
    categories: [],
    statuses: [],
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
  });

  const FILLED: ActivityReportWire = ActivityReportWireSchema.parse({
    ...EMPTY,
    totalRuns: 3,
    terminalRuns: 2,
    inFlightRuns: 1,
    people: { state: "present", distinct: 2, evidenceRows: 3 },
    completion: { readBack: 1, warnings: 0, warningsUnknown: 0 },
    outcomeSplit: { done: 1, failed: 1, attention: 0 },
    typicalMedian: { measuredRuns: 2, medianMs: { state: "present", value: 12_000 } },
    days: [{
      day: "2026-08-03", runs: 3,
      outcomes: { done: 1, failed: 1, attention: 0 },
      typicalTime: { measuredRuns: 2, medianMs: { state: "present", value: 12_000 } },
    }],
    workflows: [{
      workflowId: "retired-workflow",
      registration: {
        state: "unregistered",
        // A comma inside a cell: the export must QUOTE it, never rewrite it.
        reason: "workflow retired-workflow is no longer registered; its label, and its category, are unavailable",
      },
      runs: 3,
      completion: { readBack: 1, warnings: 0, warningsUnknown: 0 },
      needsAttention: 1, typicalTime: { measure: "successful-root-run-mean", measuredRuns: 1, unmeasuredRuns: 0, meanMs: { state: "present", value: 12000 } },
      typicalMedian: { measuredRuns: 2, medianMs: { state: "present", value: 12_000 } },
      outcomes: { done: 1, failed: 1, attention: 0 },
      days: [{
        day: "2026-08-03", runs: 3,
        outcomes: { done: 1, failed: 1, attention: 0 },
        typicalTime: { measuredRuns: 2, medianMs: { state: "present", value: 12_000 } },
      }],
      failedAt: [{ state: "unavailable", reason: NO_FAILED_STEP, runs: 1 }],
      failed: 1, cancelled: 0, partial: 0, open: 1,
    }],
    categories: [{
      category: { state: "unregistered", reason: "the workflows behind these runs are no longer registered" },
      runs: 3,
    }],
    statuses: [
      { status: "done", runs: 1, sample: [] },
      { status: "failed", runs: 1, sample: [] },
      { status: "running", runs: 1, sample: ["11111111-1111-4111-8111-111111111111"] },
    ],
    outcomes: [{ outcome: "done", runs: 1 }, { outcome: "failed", runs: 1 }],
    failures: [{
      code: "SESSION_LOST", sentence: operatorFailureSentence("SESSION_LOST"), workflowId: "retired-workflow", registration: { state: "unregistered", reason: "workflow registration is unavailable" }, runs: 1, transient: 1, sample: ["22222222-2222-4222-8222-222222222222"],
    }],
    durations: {
      measuredRuns: 2,
      unmeasuredRuns: 0,
      medianMs: { state: "present", value: 12_000 },
      longestMs: { state: "present", value: 30_000, runId: "22222222-2222-4222-8222-222222222222" },
      totalMs: 42_000,
    },
    ledger: {
      systems: [
        { system: "ucpath", entries: 4, prod: 3, test: 1 },
        { system: "kuali", entries: 1, prod: 1, test: 0 },
      ],
    },
  });
  return { EMPTY, FILLED };
}
