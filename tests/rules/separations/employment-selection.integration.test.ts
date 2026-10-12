
import assert from "node:assert/strict";
import { describe,it } from "vitest";
import type { UcpathJobRow } from "../../../src/models/ui/ucpath-job-summary.js";
import { selectSeparationEmployment } from "../../../src/rules/separations/employment-selection.js";

const cell = (value: string) => ({ state: "present" as const, value });
const noCell = (reason: string) => ({ state: "absent" as const, reason });

function row(overrides: Partial<UcpathJobRow> = {}): UcpathJobRow {
  return {
    rowIndex: 0,
    emplRecord: "0",
    hrStatus: "Active",
    businessUnit: "SDCMP",
    effectiveDate: cell("07/01/2025"),
    positionNumber: cell("40012345"),
    deptId: cell("000412"),
    department: cell("HOUSING/DINING/HOSPITALITY"),
    jobCode: cell("004921"),
    jobTitle: cell("STDT 2"),
    expectedJobEndDate: noCell("the grid rendered this cell empty"),
    fte: cell("0.500000"),
    emplClass: cell("Student"),
    ...overrides,
  };
}

describe("the EMPLOYMENT selection", () => {
  it("selects the single active row and passes its dept cells through untouched", () => {
    const selection = selectSeparationEmployment([
      row({ rowIndex: 0, emplRecord: "1", hrStatus: "Terminated" }),
      row({ rowIndex: 1, emplRecord: "0" }),
    ]);
    assert.equal(selection.state, "selected");
    if (selection.state !== "selected") return;
    assert.equal(selection.employment.emplRecord, "0");
    assert.equal(selection.employment.payrollTitleCode, "004921");
    assert.equal(selection.employment.payrollTitle, "STDT 2");
    assert.equal(selection.employment.rowCount, 2);
    // The department cells are NOT refused here — `match-department-option`
    // owns that refusal, and one fact with two durable codes is worse than one.
    assert.deepEqual(selection.employment.deptId, cell("000412"));
  });

  it("refuses no-active / concurrent / indeterminate, each by its own code", () => {
    for (const [code, rows] of [
      ["no-active-employment", [row({ hrStatus: "Terminated" })]],
      ["concurrent-active-employments", [row({ rowIndex: 0 }), row({ rowIndex: 1, emplRecord: "1" })]],
      ["indeterminate-employment-status", [row({ hrStatus: "Suspended-Pending Review" })]],
    ] as const) {
      const selection = selectSeparationEmployment(rows);
      assert.equal(selection.state, "refused", code);
      if (selection.state !== "refused") continue;
      assert.equal(selection.code, code);
    }
  });

  it("refuses an unreadable job code or title, because both are STAGED into Kuali", () => {
    for (const [code, overrides] of [
      ["payroll-title-code-unreadable", { jobCode: noCell("the grid rendered this cell empty") }],
      ["payroll-title-unreadable", { jobTitle: noCell("the grid rendered this cell empty") }],
    ] as const) {
      const selection = selectSeparationEmployment([row(overrides)]);
      assert.equal(selection.state, "refused", code);
      if (selection.state !== "refused") continue;
      assert.equal(selection.code, code);
    }
  });

  it("names the rows it refused over, verbatim, so the operator reads UCPath's own words", () => {
    const selection = selectSeparationEmployment([row({ hrStatus: "Terminated" })]);
    assert.equal(selection.state, "refused");
    if (selection.state !== "refused") return;
    assert.match(selection.reason, /empl record 0 — Terminated/u);
  });
});
