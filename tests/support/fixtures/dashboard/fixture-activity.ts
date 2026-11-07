import { ActivityReportWireSchema, type ActivityReportWire } from "../../../../src/models/dashboard/activity.js";
import { ActivityVolumeSchema, buildActivityVolumeBoundarySkeleton, createActivityDatePartReader } from "../../../../src/models/dashboard/activity-volume.js";
import { FIXTURE_DAY, uuidOf } from "./fixture-identity.js";
const ACTIVITY_SAMPLE_RUN_ID = "aa11bb22-0001-4000-8000-aa11bb220001";
const ACTIVITY_BLOCKED_RUN_ID = "aa11bb22-0002-4000-8000-aa11bb220002";
const at = (minute: number): string => `${FIXTURE_DAY}T${String(9 + Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}:00.000Z`;

export const FIXTURE_ACTIVITY_RANGE = { from: "2026-07-01", to: FIXTURE_DAY } as const;
export const FIXTURE_ACTIVITY_UNAVAILABLE_RANGE = { from: "2026-07-02", to: FIXTURE_DAY } as const;
const FIXTURE_ACTIVITY_TIME_ZONE = "America/Los_Angeles";
const FIXTURE_ACTIVITY_DAYS = [
  { day: "2026-07-29", runs: 3 },
  { day: "2026-07-30", runs: 4 },
  { day: FIXTURE_DAY, runs: 5 },
] as const;

function fixtureActivityVolume(range: { from: string; to: string }, days: readonly { day: string; runs: number }[]) {
  const boundary = buildActivityVolumeBoundarySkeleton(range, FIXTURE_ACTIVITY_TIME_ZONE);
  const datePart = createActivityDatePartReader(FIXTURE_ACTIVITY_TIME_ZONE);
  const coveredRuns = days.reduce((total, day) => total + day.runs, 0);
  return ActivityVolumeSchema.parse({
    state: "complete",
    ...boundary,
    coveredRuns,
    // This synthetic report assigns counts to three known calendar dates. Fold those counts into
    // real report-zone intervals; do not invent per-run instants for the chart.
    buckets: boundary.buckets.map((bucket) => {
      const startDay = datePart(bucket.start);
      const endDay = datePart(bucket.endExclusive);
      const runs = days.reduce((total, day) => total + (day.day >= startDay && day.day < endDay ? day.runs : 0), 0);
      return { ...bucket, runs };
    }),
  });
}

export const FIXTURE_ACTIVITY_REPORT: ActivityReportWire = ActivityReportWireSchema.parse({
  wireVersion: 1,
  from: FIXTURE_ACTIVITY_RANGE.from,
  to: FIXTURE_ACTIVITY_RANGE.to,
  generatedAt: at(120),
  totalRuns: 12,
  terminalRuns: 10,
  inFlightRuns: 2,

  people: { state: "present", distinct: 8, evidenceRows: 12 },
  days: FIXTURE_ACTIVITY_DAYS,
  volume: fixtureActivityVolume(FIXTURE_ACTIVITY_RANGE, FIXTURE_ACTIVITY_DAYS),

  completion: { readBack: 5, warnings: 1, warningsUnknown: 1 },
  workflows: [
    {
      workflowId: "person-lookup",
      registration: { state: "registered", label: "Person Lookup", code: "pl", categoryId: "people" },
      runs: 9,
      completion: { readBack: 5, warnings: 1, warningsUnknown: 0 },
      failed: 1, cancelled: 0, partial: 0, open: 2,
    },

    {
      workflowId: "retired-workflow",
      registration: {
        state: "unregistered",
        reason: "workflow retired-workflow is no longer registered; its label and category are unavailable",
      },
      runs: 3,
      completion: { readBack: 0, warnings: 0, warningsUnknown: 1 },
      failed: 1, cancelled: 1, partial: 0, open: 0,
    },
  ],
  categories: [
    { category: { state: "registered", categoryId: "people" }, runs: 9 },
    {
      category: { state: "unregistered", reason: "the workflows behind these runs are no longer registered" },
      runs: 3,
    },
  ],
  statuses: [
    { status: "done", runs: 7, sample: [] },
    { status: "failed", runs: 2, sample: [] },

    { status: "running", runs: 2, sample: [uuidOf(20), ACTIVITY_SAMPLE_RUN_ID] },
    { status: "cancelled", runs: 1, sample: [] },
  ],
  outcomes: [
    { outcome: "done", runs: 7 },
    { outcome: "failed", runs: 2 },
    { outcome: "cancelled", runs: 1 },
  ],
  failures: [
    { code: "SESSION_LOST", runs: 1, transient: 1, sample: [ACTIVITY_SAMPLE_RUN_ID] },
    { code: "SUBJECT_MISMATCH", runs: 1, transient: 0, sample: [ACTIVITY_BLOCKED_RUN_ID] },
  ],
  durations: {
    measuredRuns: 9,
    unmeasuredRuns: 1,
    medianMs: { state: "present", value: 874_000 },
    longestMs: { state: "present", value: 1_632_000, runId: ACTIVITY_SAMPLE_RUN_ID },
    totalMs: 8_431_000,
  },

  ledger: {
    systems: [
      { system: "ucpath", entries: 6, prod: 6, test: 0 },
      { system: "kuali", entries: 3, prod: 2, test: 1 },
    ],
  },
});


export const FIXTURE_ACTIVITY_UNAVAILABLE_REPORT: ActivityReportWire = ActivityReportWireSchema.parse({
  ...FIXTURE_ACTIVITY_REPORT,
  from: FIXTURE_ACTIVITY_UNAVAILABLE_RANGE.from,
  to: FIXTURE_ACTIVITY_UNAVAILABLE_RANGE.to,
  volume: fixtureActivityVolume(FIXTURE_ACTIVITY_UNAVAILABLE_RANGE, FIXTURE_ACTIVITY_DAYS),
  people: {
    state: "absent",
    evidenceRows: 12,
    unavailableRows: 0,
    reason: "current run/member rows lack validated canonical identity; distinct people is unavailable",
  },
});

