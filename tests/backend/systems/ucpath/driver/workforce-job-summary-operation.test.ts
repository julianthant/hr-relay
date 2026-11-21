import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type {
  FrozenGrid,
  WorkforceJobSummaryDetail,
  WorkforceJobSummaryPagePort,
  WorkforceJobSummaryResultRow,
  WorkforceJobSummarySearchOutcome,
} from "../../../../../src/backend/systems/ucpath/driver/workforce-job-summary-operation.js";
import {
  deriveWorkforceJobRow,
  pairJobSummaryGrid,
  pickRowInEffect,
  readWorkforceJobSummaryWithPagePort,
} from "../../../../../src/backend/systems/ucpath/driver/workforce-job-summary-operation.js";
import { EidSchema, LocalDateSchema } from "../../../../../src/rules/identity/ids.js";

const EID = EidSchema.parse("10800003");
const OBSERVED_AT = "2026-11-17T10:00:00.000Z";
const NAME = "Rivera Quinn";
const ACTIVE = { state: "present", value: "Active" } as const;

/** Left frozen row: Org Relationship, Empl Record, Effective Date, Seq. */
const left = (record: string, date: string, seq = "0") => ["EMP", record, date, seq];
/** Work Location right row: Position, Description, Company, Dept ID, Department, Location, Business Unit, Supervisor, row header. */
const location = (position: string, title: string, deptId = "000412", department = "HOUSING/DINING/HOSPITALITY") =>
  [position, title, "UCS", deptId, department, "6840-1", "SDCMP", "Avery Example", ""];
/** Job Information right row: Job Code, Description, descriptive columns, Expected Job End Date, trailing blanks. */
const job = (code: string, title: string, endDate: string) => [code, title, "PSS", "Active", "Variable", "17.60", "0.440000", "Nonexempt", endDate, "", ""];

/** Shaped like the live 2026-08-20 grid: STDT 2 rows, then a promotion to STDT 3 effective 03/29/2026; each row's end date is not its effective date. */
const PROMOTION_DATES = ["01/31/2025", "06/20/2025", "12/21/2025", "03/29/2026", "03/29/2026", "06/12/2026", "06/21/2026"];
const PROMOTION_TITLES = ["STDT 2", "STDT 2", "STDT 2", "STDT 3", "STDT 3", "STDT 3", "STDT 3"];
const PROMOTION_END_DATES = ["06/30/2025", "09/21/2025", "06/30/2026", "06/30/2026", "06/30/2026", "06/30/2026", "09/20/2026"];

function gridsFor(record: string, dates: readonly string[], titles: readonly string[], endDates: readonly string[], seqs?: readonly string[]) {
  const leftRows = dates.map((date, index) => left(record, date, seqs?.[index] ?? "0"));
  return {
    workLocation: {
      left: leftRows,
      right: titles.map((title) => location(title === "STDT 3" ? "40000002" : "40000001", title)),
    },
    jobInformation: {
      left: leftRows,
      right: titles.map((title, index) => job(title === "STDT 3" ? "004920" : "004921", title, endDates[index] ?? "")),
    },
  } satisfies Pick<WorkforceJobSummaryDetail, "workLocation" | "jobInformation">;
}

const promotion = gridsFor("0", PROMOTION_DATES, PROMOTION_TITLES, PROMOTION_END_DATES);

function merge(...grids: Pick<WorkforceJobSummaryDetail, "workLocation" | "jobInformation">[]) {
  const join = (key: "workLocation" | "jobInformation"): FrozenGrid => ({
    left: grids.flatMap((grid) => grid[key].left),
    right: grids.flatMap((grid) => grid[key].right),
  });
  return { workLocation: join("workLocation"), jobInformation: join("jobInformation") };
}

describe("pairJobSummaryGrid", () => {
  it("takes each row's Effective Date from the frozen left table, never the Job Information end date", () => {
    const rows = pairJobSummaryGrid(promotion.workLocation, promotion.jobInformation);
    assert.deepEqual(rows.map(({ effectiveDate }) => effectiveDate), PROMOTION_DATES);
    assert.deepEqual(rows.map(({ jobInformation }) => jobInformation[1]), PROMOTION_TITLES);
    assert.deepEqual(rows.map(({ emplRecord }) => emplRecord), PROMOTION_DATES.map(() => "0"));
  });

  it("refuses when a tab's frozen and column tables have different row counts", () => {
    assert.throws(
      () => pairJobSummaryGrid({ ...promotion.workLocation, right: promotion.workLocation.right.slice(1) }, promotion.jobInformation),
      /Work Location grid has 7 frozen row\(s\) but 6 column row\(s\)/u,
    );
  });

  it("refuses when the two tabs list different effective-dated rows", () => {
    const shifted = { ...promotion.jobInformation, left: promotion.jobInformation.left.map((row, index) => (index === 0 ? left("0", "02/01/2025") : row)) };
    assert.throws(() => pairJobSummaryGrid(promotion.workLocation, shifted), /list different effective-dated rows/u);
  });

  it("refuses a frozen row that is not Org Relationship, Empl Record, Effective Date, Seq", () => {
    const moved = { left: [["EMP", "01/31/2025", "0", "0"]], right: [location("40000001", "STDT 2")] };
    assert.throws(() => pairJobSummaryGrid(moved, { left: moved.left, right: [job("004921", "STDT 2", "")] }), /frozen layout moved/u);
  });

  it("refuses an empty grid", () => {
    assert.throws(() => pairJobSummaryGrid({ left: [], right: [] }, { left: [], right: [] }), /rendered no rows/u);
  });
});

describe("pickRowInEffect", () => {
  const rows = pairJobSummaryGrid(promotion.workLocation, promotion.jobInformation);

  it("picks the latest row on or before the as-of date", () => {
    const picked = pickRowInEffect(rows, LocalDateSchema.parse("2026-06-16"));
    assert.deepEqual([picked.effectiveDate, picked.jobInformation[0], picked.jobInformation[1]], ["06/12/2026", "004920", "STDT 3"]);
  });

  it("keeps the earlier job when the as-of date precedes the promotion", () => {
    const picked = pickRowInEffect(rows, LocalDateSchema.parse("2026-03-01"));
    assert.deepEqual([picked.effectiveDate, picked.jobInformation[1]], ["12/21/2025", "STDT 2"]);
  });

  it("picks the latest row without an as-of date", () => {
    assert.equal(pickRowInEffect(rows, undefined).effectiveDate, "06/21/2026");
  });

  it("refuses when every row is after the as-of date", () => {
    assert.throws(
      () => pickRowInEffect(rows, LocalDateSchema.parse("2024-12-31")),
      /Workforce Job Summary has no row in effect on 2024-12-31/u,
    );
  });

  it("breaks a same-date tie by the higher Seq", () => {
    const tie = gridsFor("0", ["03/29/2026", "03/29/2026"], ["STDT 2", "STDT 3"], ["", ""], ["1", "0"]);
    const picked = pickRowInEffect(pairJobSummaryGrid(tie.workLocation, tie.jobInformation), undefined);
    assert.equal(picked.jobInformation[1], "STDT 2");
  });
});

describe("deriveWorkforceJobRow", () => {
  const [first] = pairJobSummaryGrid(promotion.workLocation, promotion.jobInformation);
  assert.ok(first);

  it("reads every Work Location and Job Information value and says FTE and Empl Class are not read", () => {
    const row = deriveWorkforceJobRow(first, ACTIVE, 0);
    assert.deepEqual(row, {
      rowIndex: 0,
      emplRecord: "0",
      hrStatus: ACTIVE,
      businessUnit: "SDCMP",
      effectiveDate: { state: "present", value: "01/31/2025" },
      positionNumber: { state: "present", value: "40000001" },
      deptId: { state: "present", value: "000412" },
      department: { state: "present", value: "HOUSING/DINING/HOSPITALITY" },
      jobCode: { state: "present", value: "004921" },
      jobTitle: { state: "present", value: "STDT 2" },
      expectedJobEndDate: { state: "present", value: "06/30/2025" },
      fte: { state: "absent", reason: "Workforce Job Summary has no verified FTE column, so this read does not report it" },
      emplClass: { state: "absent", reason: "Workforce Job Summary has no verified Empl Class column, so this read does not report it" },
    });
  });

  it("reports an empty department cell as absent with its reason", () => {
    const row = deriveWorkforceJobRow({ ...first, workLocation: location("40000001", "STDT 2", "000412", "") }, ACTIVE, 0);
    assert.deepEqual(row.department, { state: "absent", reason: "the Workforce Job Summary Department cell rendered empty" });
  });

  it("refuses a row without a Business Unit", () => {
    const noUnit = location("40000001", "STDT 2").map((value, index) => (index === 6 ? "" : value));
    assert.throws(() => deriveWorkforceJobRow({ ...first, workLocation: noUnit }, ACTIVE, 0), /no Business Unit/u);
  });

  it("refuses when the Job Information row does not start with a Job Code", () => {
    assert.throws(() => deriveWorkforceJobRow({ ...first, jobInformation: ["STDT 2", "004921"] }, ACTIVE, 0), /does not start with a Job Code/u);
  });

  it("refuses when the Work Location row does not start with a Position Number", () => {
    assert.throws(() => deriveWorkforceJobRow({ ...first, workLocation: location("STDT 2", "UCS") }, ACTIVE, 0), /does not start with a Position Number/u);
  });

  it("refuses a Job Information row with two dates", () => {
    const twoDates = job("004921", "STDT 2", "06/30/2025").map((value, index) => (index === 4 ? "07/01/2025" : value));
    assert.throws(() => deriveWorkforceJobRow({ ...first, jobInformation: twoDates }, ACTIVE, 0), /shows 2 dates/u);
  });
});

function resultRow(rowIndex: number, emplRecord: string, payrollStatus: string): WorkforceJobSummaryResultRow {
  return { rowIndex, emplRecord, jobCode: "004920", payrollStatus };
}

/** A scripted page: each search answers the same outcome, each drill opens the detail listed for that result row. */
function scriptedPage(outcome: WorkforceJobSummarySearchOutcome, details: readonly WorkforceJobSummaryDetail[]) {
  const calls: string[] = [];
  let open: WorkforceJobSummaryDetail | undefined = outcome.kind === "detail" ? details[0] : undefined;
  const port: WorkforceJobSummaryPagePort = {
    search: async (eid) => {
      calls.push(`search ${eid}`);
      open = outcome.kind === "detail" ? details[0] : undefined;
      return outcome;
    },
    drill: async (rowIndex) => {
      calls.push(`drill ${String(rowIndex)}`);
      open = details[rowIndex];
    },
    readDetail: async () => {
      calls.push("read");
      if (open === undefined) throw new Error("no detail page is open");
      return open;
    },
  };
  return { port, calls };
}

const recordZero = gridsFor("0", ["01/31/2025", "06/12/2026"], ["STDT 2", "STDT 3"], ["06/30/2025", "06/30/2026"]);
const recordOne = gridsFor("1", ["09/01/2025"], ["STDT 2"], ["06/30/2026"]);

describe("readWorkforceJobSummaryWithPagePort", () => {
  it("returns UCPath's no-results answer as employee-not-found", async () => {
    const { port } = scriptedPage({ kind: "not-found", marker: "No matching values were found." }, []);
    assert.deepEqual(await readWorkforceJobSummaryWithPagePort(port, { emplId: EID }, OBSERVED_AT), {
      state: "employee-not-found",
      emplId: EID,
      observedMarker: "No matching values were found.",
    });
  });

  it("drills every employee record from a fresh search when each detail page shows only its own record", async () => {
    const { port, calls } = scriptedPage(
      { kind: "grid", rows: [resultRow(0, "0", "Active"), resultRow(1, "1", "Terminated")] },
      [{ displayedEid: EID, displayedName: NAME, ...recordZero }, { displayedEid: EID, displayedName: NAME, ...recordOne }],
    );
    const read = await readWorkforceJobSummaryWithPagePort(port, { emplId: EID, asOf: LocalDateSchema.parse("2026-06-16") }, OBSERVED_AT);
    assert.deepEqual(calls, [`search ${EID}`, "drill 0", "read", `search ${EID}`, "drill 1", "read"]);
    assert.ok(read.state === "read");
    assert.equal(read.summary.displayedName, NAME);
    assert.deepEqual(read.summary.renderContext, { entry: "drilled-from-grid", searchResultRows: 2, employmentInstances: "already-complete" });
    assert.deepEqual(read.summary.jobRows.map((row) => [row.rowIndex, row.emplRecord, row.hrStatus, row.jobTitle, row.effectiveDate]), [
      [0, "0", ACTIVE, { state: "present", value: "STDT 3" }, { state: "present", value: "06/12/2026" }],
      [1, "1", { state: "present", value: "Terminated" }, { state: "present", value: "STDT 2" }, { state: "present", value: "09/01/2025" }],
    ]);
    assert.equal(read.summary.rowCount, 2);
  });

  it("drills once when the first detail page already lists every record", async () => {
    const both = merge(recordZero, recordOne);
    const { port, calls } = scriptedPage(
      { kind: "grid", rows: [resultRow(0, "0", "Active"), resultRow(1, "1", "Active")] },
      [{ displayedEid: EID, displayedName: NAME, ...both }, { displayedEid: EID, displayedName: NAME, ...both }],
    );
    const read = await readWorkforceJobSummaryWithPagePort(port, { emplId: EID }, OBSERVED_AT);
    assert.deepEqual(calls, [`search ${EID}`, "drill 0", "read"]);
    assert.ok(read.state === "read");
    assert.deepEqual(read.summary.jobRows.map(({ emplRecord }) => emplRecord), ["0", "1"]);
  });

  it("refuses when a listed record never shows rows on its detail page", async () => {
    const { port } = scriptedPage(
      { kind: "grid", rows: [resultRow(0, "0", "Active"), resultRow(1, "1", "Active")] },
      [{ displayedEid: EID, displayedName: NAME, ...recordZero }, { displayedEid: EID, displayedName: NAME, ...recordZero }],
    );
    await assert.rejects(readWorkforceJobSummaryWithPagePort(port, { emplId: EID }, OBSERVED_AT), /showed no rows for empl record\(s\) 1/u);
  });

  it("refuses when two detail pages for one EID display different names", async () => {
    const { port } = scriptedPage(
      { kind: "grid", rows: [resultRow(0, "0", "Active"), resultRow(1, "1", "Active")] },
      [{ displayedEid: EID, displayedName: NAME, ...recordZero }, { displayedEid: EID, displayedName: "Someone Else", ...recordOne }],
    );
    await assert.rejects(readWorkforceJobSummaryWithPagePort(port, { emplId: EID }, OBSERVED_AT), /displayed different names/u);
  });

  it("refuses a results grid that lists one record twice", async () => {
    const { port } = scriptedPage({ kind: "grid", rows: [resultRow(0, "0", "Active"), resultRow(1, "0", "Terminated")] }, []);
    await assert.rejects(readWorkforceJobSummaryWithPagePort(port, { emplId: EID }, OBSERVED_AT), /lists empl record 0 on more than one result row/u);
  });

  it("reads a single auto-opened record with its status not shown", async () => {
    const { port, calls } = scriptedPage({ kind: "detail" }, [{ displayedEid: EID, displayedName: NAME, ...recordZero }]);
    const read = await readWorkforceJobSummaryWithPagePort(port, { emplId: EID, asOf: LocalDateSchema.parse("2026-03-01") }, OBSERVED_AT);
    assert.deepEqual(calls, [`search ${EID}`, "read"]);
    assert.ok(read.state === "read");
    assert.deepEqual(read.summary.renderContext, { entry: "auto-detail", searchResultRows: 0, employmentInstances: "already-complete" });
    const [row] = read.summary.jobRows;
    assert.ok(row !== undefined && read.summary.rowCount === 1);
    assert.deepEqual(row.hrStatus, {
      state: "absent",
      reason: "Workforce Job Summary opened the only employment record directly, and its detail page shows no status",
    });
    assert.deepEqual([row.effectiveDate, row.jobTitle], [{ state: "present", value: "01/31/2025" }, { state: "present", value: "STDT 2" }]);
  });

  it("refuses a detail page that shows another person's Empl ID, on the auto-opened and the drilled path", async () => {
    const other = EidSchema.parse("10800004");
    const single = scriptedPage({ kind: "detail" }, [{ displayedEid: other, displayedName: NAME, ...recordZero }]);
    assert.deepEqual(await readWorkforceJobSummaryWithPagePort(single.port, { emplId: EID }, OBSERVED_AT), {
      state: "subject-mismatch", expectedEid: EID, observedEid: other,
    });
    const drilled = scriptedPage(
      { kind: "grid", rows: [resultRow(0, "0", "Active"), resultRow(1, "1", "Active")] },
      [{ displayedEid: EID, displayedName: NAME, ...recordZero }, { displayedEid: other, displayedName: NAME, ...recordOne }],
    );
    assert.deepEqual(await readWorkforceJobSummaryWithPagePort(drilled.port, { emplId: EID }, OBSERVED_AT), {
      state: "subject-mismatch", expectedEid: EID, observedEid: other,
    });
  });

  it("refuses a detail header whose Empl ID is not an EID", async () => {
    const { port } = scriptedPage({ kind: "detail" }, [{ displayedEid: "Pending", displayedName: NAME, ...recordZero }]);
    await assert.rejects(readWorkforceJobSummaryWithPagePort(port, { emplId: EID }, OBSERVED_AT), /Empl ID that is not an EID/u);
  });
});
