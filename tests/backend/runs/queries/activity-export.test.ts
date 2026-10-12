import { createActivityReportFixtures } from "../../../support/helpers/dashboard/activity-report-fixtures.js";

import assert from "node:assert/strict";
import { describe,it } from "vitest";
import {
activityReportCsv,
activityReportCsvFileName,
} from "../../../../src/backend/runs/queries/activity-export.js";
import {
activityReportCaveats,
ActivityReportWireSchema
} from "../../../../src/models/dashboard/activity.js";

const { EMPTY, FILLED } = createActivityReportFixtures();

function lines(csv: string): readonly string[] {
  return csv.split("\r\n");
}

describe("the Activity report's CSV export", () => {

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
