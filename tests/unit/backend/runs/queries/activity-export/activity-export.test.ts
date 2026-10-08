/**
 * D240 — the Activity report's CSV export.
 *
 * The recorded condition on building it (`docs/rebuild/findings/activity.md`) was that
 * an export carrying the numbers without the rules is the lying artifact this
 * surface's design exists to prevent, so the load-bearing assertions here are
 * about what travels WITH the numbers: the named window, every caveat sentence
 * the panel shows behind its ⓘ, the honest absence reasons, and the write
 * ledger's own statement that it is a different authority.
 */
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  activityReportCaveats,
  ActivityReportWireSchema,
  type ActivityReportWire,
} from "../../../../../../src/models/dashboard/activity.js";
import {
  activityReportCsv,
  activityReportCsvFileName,
} from "../../../../../../src/backend/runs/queries/activity-export.js";
import {
  DISPLAY_STATUS_LABELS,
  displayStatusOf,
  displayStatusProseLabelOf,
} from "../../../../../../src/models/dashboard/status-vocabulary.js";
import { dsStatusOf, PROPOSED_STATUS } from "../../../../../../src/dashboard/surfaces/shared/status/status-model.js";

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

function lines(csv: string): readonly string[] {
  return csv.split("\r\n");
}

describe("the Activity report's CSV export (D240)", () => {
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

  it("names the window in the artifact and in the file name", () => {
    assert.equal(activityReportCsvFileName(FILLED), "activity-2026-08-01_2026-08-07.csv");
    const rows = lines(activityReportCsv(FILLED));
    assert.equal(rows[0], "Activity report");
    assert.equal(rows[1], "Window from,2026-08-01");
    assert.equal(rows[2], "Window to,2026-08-07");
    assert.equal(rows[3], "Generated at,2026-08-07T12:00:00.000Z");
  });

  it("carries every caveat the panel shows, ahead of the totals they qualify", () => {
    const csv = activityReportCsv(FILLED);
    const rows = lines(csv);
    const caveats = activityReportCaveats(FILLED);
    assert.ok(caveats.length > 0);
    for (const caveat of caveats) {
      assert.ok(
        rows.includes(caveat.includes(",") ? `"${caveat}"` : caveat),
        `the export must carry the rule verbatim: ${caveat}`,
      );
    }
    // AHEAD of the numbers: a reader who stops after one screen has still read
    // the rules the numbers were counted by.
    assert.ok(rows.indexOf("How this report is counted") < rows.indexOf("Totals"));
    // The error rate is the tile's own derivation, not a second rounding.
    assert.ok(rows.includes("Error rate %,50"));
  });

  it("exports an absent quantile's REASON, never a zero", () => {
    const rows = lines(activityReportCsv(EMPTY));
    assert.ok(rows.includes(
      "Median duration (ms),no terminal run in range carries both a start and an end instant",
    ));
    assert.ok(rows.includes(
      "Longest duration (ms),no terminal run in range carries both a start and an end instant",
    ));
    assert.equal(rows.includes("Median duration (ms),0"), false);
  });

  it("exports distinct people as a count or a named absence, never the same zero", () => {
    const present = lines(activityReportCsv(FILLED));
    assert.ok(present.includes("Distinct people,2"));
    assert.ok(present.includes("Person identity evidence rows,3"));

    const absentReason = "1 of 3 person-bearing rows lacks a declared stable redacted identity digest";
    const absent = ActivityReportWireSchema.parse({
      ...FILLED,
      people: { state: "absent", evidenceRows: 2, unavailableRows: 1, reason: absentReason },
    });
    const absentRows = lines(activityReportCsv(absent));
    assert.ok(absentRows.includes(`Distinct people,${absentReason}`));
    assert.ok(absentRows.includes("Person identity evidence rows,2"));
    assert.ok(absentRows.includes("Person identity unavailable rows,1"));
    assert.equal(absentRows.includes("Distinct people,0"), false);
  });

  it("quotes a cell that carries a comma rather than rewriting it", () => {
    const csv = activityReportCsv(FILLED);
    assert.ok(csv.includes(
      '"workflow retired-workflow is no longer registered; its label, and its category, are unavailable"',
    ));
    // And an unregistered workflow never exports an id dressed as a label.
    assert.equal(csv.includes("retired-workflow,retired-workflow"), false);
  });

  it("states the write ledger's seam in the file, and says so when nothing was filed", () => {
    const filled = lines(activityReportCsv(FILLED));
    assert.ok(filled.includes("Write ledger — what was actually filed"));
    assert.ok(filled.includes(
      "A separate authority from every total above; confirmed entries survive Archive transfer and remain until explicit owner deletion.",
    ));
    assert.ok(filled.includes("ucpath,4,3,1"));
    assert.ok(filled.includes("kuali,1,1,0"));

    const empty = lines(activityReportCsv(EMPTY));
    assert.ok(empty.includes(
      "No ledger entries. Nothing in this report's reach filed anything into a real HR system.",
    ));
  });

  it("says the failure block is empty rather than leaving a headerless hole", () => {
    assert.ok(lines(activityReportCsv(EMPTY)).includes(
      "No run in this range settled with a structured failure.",
    ));
  });
});
