
import assert from "node:assert/strict";
import { describe,it } from "vitest";
import { dsStatusOf,PROPOSED_STATUS } from "../../../src/dashboard/surfaces/shared/status/status-model.js";
import {
activityReportCaveats,
ActivityReportWireSchema,
type ActivityReportWire,
} from "../../../src/models/dashboard/activity.js";
import {
DISPLAY_STATUS_LABELS,
displayStatusOf,
displayStatusProseLabelOf,
} from "../../../src/models/dashboard/status-vocabulary.js";

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
  days: [{ day: "2026-08-03", runs: 3 }],
  workflows: [{
    workflowId: "retired-workflow",
    registration: {
      state: "unregistered",
      // A comma inside a cell: the export must QUOTE it, never rewrite it.
      reason: "workflow retired-workflow is no longer registered; its label, and its category, are unavailable",
    },
    runs: 3,
    completion: { readBack: 1, warnings: 0, warningsUnknown: 0 },
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
    code: "SESSION_LOST", runs: 1, transient: 1, sample: ["22222222-2222-4222-8222-222222222222"],
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

describe("the Activity report's CSV export", () => {
  it("uses the shared display vocabulary and sentence treatment for all closed statuses", () => {
    const caveat = activityReportCaveats(FILLED).find((value) => value.startsWith("Error rate counts"));
    assert.ok(caveat);
    assert.equal(DISPLAY_STATUS_LABELS[displayStatusOf("blocked")], PROPOSED_STATUS[dsStatusOf("blocked")].label);
    assert.equal(DISPLAY_STATUS_LABELS.parked, "Write parked");
    assert.equal(
      caveat,
      "Error rate counts only runs that reached a terminal state. Anything queued, running, waiting on you "
      + "or write parked is excluded and reported separately as still open, so a busy span cannot read as a finished one.",
    );
    assert.equal(caveat.includes("blocked"), false);

    const proseLabels = [
      ["queued", "queued"],
      ["running", "running"],
      ["blocked", "write parked"],
      ["awaiting-approval", "waiting on you"],
      ["done", "done"],
      ["failed", "failed"],
      ["cancelled", "cancelled"],
      ["partial", "done with warnings"],
    ] as const;
    for (const [status, expected] of proseLabels) {
      assert.equal(displayStatusProseLabelOf(status), expected);
    }
  });
});
