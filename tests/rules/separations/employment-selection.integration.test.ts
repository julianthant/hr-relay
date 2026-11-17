
import assert from "node:assert/strict";
import { describe,it } from "vitest";
import type { UcpathJobRow } from "../../../src/models/ui/ucpath-job-summary.js";
import type { EmploymentRequest } from "../../../src/rules/separations/employment-selection.js";
import { selectSeparationEmployment } from "../../../src/rules/separations/employment-selection.js";

const cell = (value: string) => ({ state: "present" as const, value });
const noCell = (reason: string) => ({ state: "absent" as const, reason });

const noTitle: EmploymentRequest = {
  studentTitleCode: { state: "present", value: "- - -" },
  additionalComments: { state: "absent", reason: "the field rendered empty" },
};

function titled(studentTitleCode: string, comments?: string): EmploymentRequest {
  return {
    studentTitleCode: { state: "present", value: studentTitleCode },
    additionalComments: comments === undefined
      ? { state: "absent", reason: "the field rendered empty" }
      : { state: "present", value: comments },
  };
}

function row(overrides: Partial<UcpathJobRow> = {}): UcpathJobRow {
  return {
    rowIndex: 0,
    emplRecord: "0",
    hrStatus: cell("Active"),
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
      row({ rowIndex: 0, emplRecord: "1", hrStatus: cell("Terminated") }),
      row({ rowIndex: 1, emplRecord: "0" }),
    ], noTitle);
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

  it("selects the only record when UCPath shows no status for it, and says so", () => {
    const selection = selectSeparationEmployment([row({ hrStatus: noCell("the detail page shows no status") })], noTitle);
    assert.equal(selection.state, "selected");
    if (selection.state !== "selected") return;
    assert.equal(selection.employment.emplRecord, "0");
    assert.equal(selection.employment.hrStatus, "Not shown (the detail page shows no status)");
    assert.equal(selection.employment.rowCount, 1);
  });

  it("refuses a missing status when there is more than one record", () => {
    const selection = selectSeparationEmployment([
      row({ rowIndex: 0, hrStatus: noCell("the detail page shows no status") }),
      row({ rowIndex: 1, emplRecord: "1" }),
    ], noTitle);
    assert.equal(selection.state, "refused");
    if (selection.state !== "refused") return;
    assert.equal(selection.code, "indeterminate-employment-status");
    assert.match(selection.reason, /empl record 0 — status not shown/u);
  });

  it("refuses no-active / concurrent / indeterminate, each by its own code", () => {
    for (const [code, rows] of [
      ["no-active-employment", [row({ hrStatus: cell("Terminated") })]],
      ["concurrent-active-employments", [row({ rowIndex: 0 }), row({ rowIndex: 1, emplRecord: "1" })]],
      ["indeterminate-employment-status", [row({ hrStatus: cell("Suspended-Pending Review") })]],
    ] as const) {
      const selection = selectSeparationEmployment(rows, noTitle);
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
      const selection = selectSeparationEmployment([row(overrides)], noTitle);
      assert.equal(selection.state, "refused", code);
      if (selection.state !== "refused") continue;
      assert.equal(selection.code, code);
    }
  });

  it("names the rows it refused over, verbatim, so the operator reads UCPath's own words", () => {
    const selection = selectSeparationEmployment([row({ hrStatus: cell("Terminated") })], noTitle);
    assert.equal(selection.state, "refused");
    if (selection.state !== "refused") return;
    assert.match(selection.reason, /empl record 0 — Terminated/u);
  });
});

describe("the EMPLOYMENT selection by the Kuali student title", () => {
  const stdt2 = row({ rowIndex: 0, emplRecord: "0", jobCode: cell("004921"), jobTitle: cell("STDT 2") });
  const stdt3 = row({
    rowIndex: 1, emplRecord: "1", positionNumber: cell("40067890"), jobCode: cell("004920"), jobTitle: cell("STDT 3"),
  });

  it("refuses concurrent open jobs even when the form names one: transaction checks are person-scoped", () => {
    for (const rows of [
      [stdt2, stdt3],
      [stdt2, { ...stdt3, jobCode: cell("004921"), jobTitle: cell("STDT 2") }],
      [stdt2, row({ rowIndex: 1, emplRecord: "1", positionNumber: cell("40067890"), jobCode: cell("004444"), jobTitle: cell("CASHIER") })],
    ]) {
      const selection = selectSeparationEmployment(rows, titled("4920 - STDT 3"));
      assert.equal(selection.state, "refused");
      if (selection.state !== "refused") continue;
      assert.equal(selection.code, "concurrent-active-employments");
      assert.match(selection.reason, /004920/u);
    }
  });

  it("picks the open job the form names over a terminated one", () => {
    const selection = selectSeparationEmployment(
      [{ ...stdt2, hrStatus: cell("Terminated") }, stdt3],
      titled("4920 - STDT 3"),
    );
    assert.equal(selection.state, "selected");
    if (selection.state !== "selected") return;
    assert.equal(selection.employment.emplRecord, "1");
    assert.equal(selection.employment.payrollTitleCode, "004920");
    assert.equal(selection.employment.rowCount, 2);
  });

  it("takes the comment's STDT level when the title code is blank, and refuses when the two disagree", () => {
    const fromComment = selectSeparationEmployment(
      [{ ...stdt2, hrStatus: cell("Terminated") }, stdt3],
      titled("- - -", "Last shift as STDT 3."),
    );
    assert.equal(fromComment.state, "selected");
    if (fromComment.state === "selected") assert.equal(fromComment.employment.emplRecord, "1");

    const conflict = selectSeparationEmployment([stdt2, stdt3], titled("4921 - STDT 2", "Ending STDT 3"));
    assert.equal(conflict.state, "refused");
    if (conflict.state === "refused") assert.equal(conflict.code, "requested-title-conflict");

    const twoLevels = selectSeparationEmployment([stdt2, stdt3], titled("- - -", "STDT 2 and STDT 3"));
    assert.equal(twoLevels.state, "refused");
    if (twoLevels.state === "refused") assert.equal(twoLevels.code, "requested-title-conflict");
  });

  it("refuses when the named job is already terminated, rather than filing against another one", () => {
    const selection = selectSeparationEmployment(
      [stdt2, { ...stdt3, hrStatus: cell("Terminated") }],
      titled("4920 - STDT 3"),
    );
    assert.equal(selection.state, "refused");
    if (selection.state !== "refused") return;
    assert.equal(selection.code, "requested-employment-inactive");
    assert.match(selection.reason, /empl record 1 — Terminated/u);
  });

  it("picks the one active job of two that share the named title", () => {
    const selection = selectSeparationEmployment(
      [{ ...stdt2, hrStatus: cell("Terminated") }, { ...stdt3, jobCode: cell("004921"), jobTitle: cell("STDT 2") }],
      titled("4921 - STDT 2"),
    );
    assert.equal(selection.state, "selected");
    if (selection.state === "selected") assert.equal(selection.employment.emplRecord, "1");
  });

  it("falls back to the one open student job when the named title is not among the rows", () => {
    const formerJob = row({
      rowIndex: 1, emplRecord: "1", positionNumber: cell("40067890"), jobCode: cell("004444"), jobTitle: cell("CASHIER"),
      hrStatus: cell("Terminated"),
    });
    const selection = selectSeparationEmployment([stdt2, formerJob], titled("4919 - STDT 4"));
    assert.equal(selection.state, "selected");
    if (selection.state === "selected") assert.equal(selection.employment.emplRecord, "0");
  });

  it("takes the sole record when the named title is not on it", () => {
    const selection = selectSeparationEmployment(
      [row({ hrStatus: noCell("the detail page shows no status") })],
      titled("4919 - STDT 4"),
    );
    assert.equal(selection.state, "selected");
    if (selection.state === "selected") assert.equal(selection.employment.emplRecord, "0");
  });

  it("refuses when the named title matches no row and no single student job remains", () => {
    const cashier = row({ jobCode: cell("004444"), jobTitle: cell("CASHIER") });
    const selection = selectSeparationEmployment(
      [cashier, { ...stdt3, hrStatus: cell("Terminated") }],
      titled("4919 - STDT 4"),
    );
    assert.equal(selection.state, "refused");
    if (selection.state !== "refused") return;
    assert.equal(selection.code, "requested-title-not-found");
    assert.match(selection.reason, /004919/u);
  });

  it("refuses an unrecognized Student Title Code instead of ignoring it", () => {
    const selection = selectSeparationEmployment([stdt2, stdt3], titled("STDT TWO"));
    assert.equal(selection.state, "refused");
    if (selection.state === "refused") assert.equal(selection.code, "requested-title-unreadable");
  });
});
