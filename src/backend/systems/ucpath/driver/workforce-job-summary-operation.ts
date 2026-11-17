import type { Locator, Page } from "playwright";
import { z } from "zod";
import { recordBrowserAction } from "../../browser-shared/action-notes.js";
import { EidSchema } from "../../../../rules/identity/ids.js";
import type { Eid, LocalDate } from "../../../../rules/identity/ids.js";
import { directIdentifierDisplay } from "../../../../rules/redaction/redaction.js";
import {
  UCPATH_JOB_SUMMARY_PAGE_STATE,
  UcpathJobRowSchema,
  UcpathJobSummaryReadSchema,
} from "../../../../models/ui/ucpath-job-summary.js";
import type { UcpathJobCell, UcpathJobRow, UcpathJobSummaryRead } from "../../../../models/ui/ucpath-job-summary.js";
import { UCPATH_WORKFORCE_JOB_SUMMARY_UI as ui } from "./workforce-job-summary-ui-registry.js";

const BOUND_MS = 30_000;
const GRID_RENDER_MS = 15_000;
const US_DATE = /^(\d{2})\/(\d{2})\/(\d{4})$/u;
const DIGITS = /^\d+$/u;
const POSITION_NUMBER = /^\d{7,8}$/u;
const JOB_CODE = /^\d{6}$/u;
const BUSINESS_UNIT = /^[A-Z]{4,5}\d?$/u;

/** Work Location right-table columns: Position, Description, Company, Dept ID, Department, Location, Business Unit, Supervisor. */
const WORK_LOCATION = { position: 0, deptId: 3, department: 4, businessUnit: 6, minCells: 7 } as const;
/** Job Information right-table columns: Job Code, Description, then descriptive columns whose only date is the Expected Job End Date. */
const JOB_INFORMATION = { jobCode: 0, jobTitle: 1, minCells: 2 } as const;
/** Left frozen-table columns: Org Relationship, Empl Record, Effective Date, Seq. */
const LEFT = { emplRecord: 1, effectiveDate: 2, seq: 3, minCells: 4 } as const;

export const WorkforceJobSummaryResultRowSchema = z.strictObject({
  rowIndex: z.number().int().nonnegative(),
  emplRecord: z.string().regex(DIGITS),
  jobCode: z.string(),
  payrollStatus: z.string().min(1),
});
export type WorkforceJobSummaryResultRow = z.infer<typeof WorkforceJobSummaryResultRowSchema>;

/** One tab of the frozen grid, as cell text per row of each table. */
export const FrozenGridSchema = z.strictObject({
  left: z.array(z.array(z.string())),
  right: z.array(z.array(z.string())),
});
export type FrozenGrid = z.infer<typeof FrozenGridSchema>;

export const WorkforceJobSummaryDetailSchema = z.strictObject({
  /** The header's Empl ID, verbatim; the read proves it equals the searched EID. */
  displayedEid: z.string().min(1),
  displayedName: z.string().min(1),
  workLocation: FrozenGridSchema,
  jobInformation: FrozenGridSchema,
});
export type WorkforceJobSummaryDetail = z.infer<typeof WorkforceJobSummaryDetailSchema>;

export type WorkforceJobSummarySearchOutcome =
  | Readonly<{ kind: "not-found"; marker: string }>
  | Readonly<{ kind: "detail" }>
  | Readonly<{ kind: "grid"; rows: readonly WorkforceJobSummaryResultRow[] }>;

export interface WorkforceJobSummaryPagePort {
  /** Opens a fresh search page, searches one EID and reports what the page settled on. */
  readonly search: (eid: Eid) => Promise<WorkforceJobSummarySearchOutcome>;
  readonly drill: (rowIndex: number) => Promise<void>;
  /** Reads the open detail page: header name, then the Work Location and Job Information tabs. */
  readonly readDetail: () => Promise<WorkforceJobSummaryDetail>;
}

/** One effective-dated grid row: the left table's keys joined to both tabs' cells at the same index. */
export interface JobSummaryGridRow {
  readonly gridIndex: number;
  readonly emplRecord: string;
  readonly effectiveDate: string;
  readonly seq: number;
  readonly workLocation: readonly string[];
  readonly jobInformation: readonly string[];
}

function dateKey(usDate: string): number {
  const match = US_DATE.exec(usDate);
  if (match === null) throw new Error(`Workforce Job Summary date ${JSON.stringify(usDate)} is not MM/DD/YYYY`);
  return Number(match[3]) * 10_000 + Number(match[1]) * 100 + Number(match[2]);
}

function localDateKey(date: LocalDate): number {
  return Number(date.replaceAll("-", ""));
}

function sameRows(a: readonly (readonly string[])[], b: readonly (readonly string[])[]): boolean {
  return a.length === b.length && a.every((row, index) => row.join("\u0000") === (b[index] ?? []).join("\u0000"));
}

/**
 * Joins the two tabs of one detail page row by row. Both tabs are column views of the same effective-dated rows, so their
 * left tables must be identical and each right table must have exactly as many rows; the Effective Date comes only from the left table.
 */
export function pairJobSummaryGrid(workLocation: FrozenGrid, jobInformation: FrozenGrid): JobSummaryGridRow[] {
  if (workLocation.left.length === 0) throw new Error("Workforce Job Summary rendered no rows in its frozen grid");
  for (const [label, grid] of [["Work Location", workLocation], ["Job Information", jobInformation]] as const) {
    if (grid.left.length !== grid.right.length) {
      throw new Error(
        `Workforce Job Summary ${label} grid has ${String(grid.left.length)} frozen row(s) but `
        + `${String(grid.right.length)} column row(s); refusing to pair dates with the wrong job rows`,
      );
    }
  }
  if (!sameRows(workLocation.left, jobInformation.left)) {
    throw new Error("Workforce Job Summary Work Location and Job Information list different effective-dated rows");
  }
  return workLocation.left.map((left, gridIndex) => {
    const emplRecord = left[LEFT.emplRecord] ?? "";
    const effectiveDate = left[LEFT.effectiveDate] ?? "";
    const seq = left[LEFT.seq] ?? "";
    if (left.length < LEFT.minCells || !DIGITS.test(emplRecord) || !US_DATE.test(effectiveDate) || !DIGITS.test(seq)) {
      throw new Error(
        `Workforce Job Summary frozen row ${String(gridIndex)} is not Org Relationship, Empl Record, Effective Date, Seq `
        + `(${String(left.length)} cells); the frozen layout moved`,
      );
    }
    return {
      gridIndex,
      emplRecord,
      effectiveDate,
      seq: Number(seq),
      workLocation: workLocation.right[gridIndex] ?? [],
      jobInformation: jobInformation.right[gridIndex] ?? [],
    };
  });
}

/** The row in effect on `asOf`: the latest effective date on or before it, else the earliest row; without `asOf`, the latest row. Ties go to the higher Seq, then the later grid row. */
export function pickRowInEffect(rows: readonly JobSummaryGridRow[], asOf: LocalDate | undefined): JobSummaryGridRow {
  const keyed = rows.map((row) => ({ row, key: dateKey(row.effectiveDate) }));
  const later = (a: typeof keyed[number], b: typeof keyed[number]) =>
    b.key !== a.key ? b.key > a.key : b.row.seq !== a.row.seq ? b.row.seq > a.row.seq : b.row.gridIndex > a.row.gridIndex;
  const latest = (candidates: typeof keyed) => candidates.reduce((a, b) => (later(a, b) ? b : a));
  if (keyed.length === 0) throw new Error("Workforce Job Summary has no rows to pick from");
  if (asOf === undefined) return latest(keyed).row;
  const cutoff = localDateKey(asOf);
  const onOrBefore = keyed.filter(({ key }) => key <= cutoff);
  if (onOrBefore.length > 0) return latest(onOrBefore).row;
  return keyed.reduce((a, b) => (later(b, a) ? b : a)).row;
}

function cell(raw: string | undefined, label: string): UcpathJobCell {
  const value = (raw ?? "").trim();
  return value.length === 0
    ? { state: "absent", reason: `the Workforce Job Summary ${label} cell rendered empty` }
    : { state: "present", value };
}

/** A search that matches one record opens its detail page directly; only the results grid carries a status column. */
const STATUS_NOT_SHOWN: UcpathJobCell = {
  state: "absent",
  reason: "Workforce Job Summary opened the only employment record directly, and its detail page shows no status",
};

const NOT_READ_FROM_WORKFORCE_JOB_SUMMARY = (label: string): UcpathJobCell => ({
  state: "absent",
  reason: `Workforce Job Summary has no verified ${label} column, so this read does not report it`,
});

/** Projects the picked row of one employee record onto the job-summary row shape; a missing structural cell refuses. */
export function deriveWorkforceJobRow(
  picked: JobSummaryGridRow,
  hrStatus: UcpathJobCell,
  rowIndex: number,
): UcpathJobRow {
  const location = picked.workLocation;
  const job = picked.jobInformation;
  const where = `empl record ${picked.emplRecord}, effective ${picked.effectiveDate}`;
  if (location.length < WORK_LOCATION.minCells) {
    throw new Error(`Workforce Job Summary Work Location row (${where}) has ${String(location.length)} cells; the column layout moved`);
  }
  if (job.length < JOB_INFORMATION.minCells) {
    throw new Error(`Workforce Job Summary Job Information row (${where}) has ${String(job.length)} cells; the column layout moved`);
  }
  const position = (location[WORK_LOCATION.position] ?? "").trim();
  if (position.length > 0 && !POSITION_NUMBER.test(position)) {
    throw new Error(`Workforce Job Summary Work Location row (${where}) does not start with a Position Number; the column layout moved`);
  }
  const jobCode = (job[JOB_INFORMATION.jobCode] ?? "").trim();
  if (jobCode.length > 0 && !JOB_CODE.test(jobCode)) {
    throw new Error(`Workforce Job Summary Job Information row (${where}) does not start with a Job Code; the column layout moved`);
  }
  const businessUnit = (location[WORK_LOCATION.businessUnit] ?? "").trim();
  if (!BUSINESS_UNIT.test(businessUnit)) {
    throw new Error(`Workforce Job Summary Work Location row (${where}) has no Business Unit in its Business Unit column`);
  }
  const endDates = job.slice(JOB_INFORMATION.jobTitle + 1).map((value) => value.trim()).filter((value) => US_DATE.test(value));
  if (endDates.length > 1) {
    throw new Error(`Workforce Job Summary Job Information row (${where}) shows ${String(endDates.length)} dates; only the Expected Job End Date is expected`);
  }
  return UcpathJobRowSchema.parse({
    rowIndex,
    emplRecord: picked.emplRecord,
    hrStatus,
    businessUnit,
    effectiveDate: { state: "present", value: picked.effectiveDate },
    positionNumber: cell(position, "Position Number"),
    deptId: cell(location[WORK_LOCATION.deptId], "Dept ID"),
    department: cell(location[WORK_LOCATION.department], "Department"),
    jobCode: cell(jobCode, "Job Code"),
    jobTitle: cell(job[JOB_INFORMATION.jobTitle], "Job Code Description"),
    expectedJobEndDate: endDates[0] === undefined
      ? { state: "absent", reason: "the Workforce Job Summary Job Information row shows no Expected Job End Date" }
      : { state: "present", value: endDates[0] },
    fte: NOT_READ_FROM_WORKFORCE_JOB_SUMMARY("FTE"),
    emplClass: NOT_READ_FROM_WORKFORCE_JOB_SUMMARY("Empl Class"),
  });
}

function uniqueRecords(rows: readonly WorkforceJobSummaryResultRow[], emplId: Eid): Map<string, WorkforceJobSummaryResultRow> {
  const byRecord = new Map<string, WorkforceJobSummaryResultRow>();
  for (const row of rows) {
    if (byRecord.has(row.emplRecord)) {
      throw new Error(
        `Workforce Job Summary EID ${directIdentifierDisplay(emplId)} lists empl record ${row.emplRecord} on more than one result row`,
      );
    }
    byRecord.set(row.emplRecord, row);
  }
  return byRecord;
}

/**
 * Reads every employee record of one EID from Workforce Job Summary. One record opens the detail page directly; several render a
 * results grid, and each record not yet seen on a detail page is drilled from a fresh search. Each record reports the row in effect on `asOf`,
 * with the grid's Payroll Status as its status; the directly opened single record has none.
 */
export async function readWorkforceJobSummaryWithPagePort(
  pagePort: WorkforceJobSummaryPagePort,
  input: Readonly<{ emplId: Eid; asOf?: LocalDate }>,
  observedAt: string,
): Promise<UcpathJobSummaryRead> {
  const emplId = EidSchema.parse(input.emplId);
  const outcome = await pagePort.search(emplId);
  if (outcome.kind === "not-found") {
    return UcpathJobSummaryReadSchema.parse({ state: "employee-not-found", emplId, observedMarker: outcome.marker });
  }

  const gridRows: JobSummaryGridRow[] = [];
  const names = new Set<string>();
  /** Adds one detail page's rows, or returns the refusal when the page shows another person. */
  const addDetail = (detail: WorkforceJobSummaryDetail): UcpathJobSummaryRead | undefined => {
    const observed = EidSchema.safeParse(detail.displayedEid.trim());
    if (!observed.success) {
      throw new Error("Workforce Job Summary detail header shows an Empl ID that is not an EID");
    }
    if (observed.data !== emplId) {
      return UcpathJobSummaryReadSchema.parse({ state: "subject-mismatch", expectedEid: emplId, observedEid: observed.data });
    }
    names.add(detail.displayedName);
    const seen = new Set(gridRows.map(({ emplRecord }) => emplRecord));
    for (const row of pairJobSummaryGrid(detail.workLocation, detail.jobInformation)) {
      if (!seen.has(row.emplRecord)) gridRows.push(row);
    }
    return undefined;
  };

  let statusByRecord: ReadonlyMap<string, string>;
  let searchResultRows: number;
  if (outcome.kind === "detail") {
    const refused = addDetail(await pagePort.readDetail());
    if (refused !== undefined) return refused;
    searchResultRows = 0;
    statusByRecord = new Map();
  } else {
    const results = uniqueRecords(outcome.rows, emplId);
    if (results.size === 0) throw new Error(`Workforce Job Summary EID ${directIdentifierDisplay(emplId)} rendered an empty results grid`);
    let first = true;
    for (const [record, result] of results) {
      if (gridRows.some(({ emplRecord }) => emplRecord === record)) continue;
      if (!first) {
        const again = await pagePort.search(emplId);
        if (again.kind !== "grid" || !sameRows(
          again.rows.map((row) => [row.emplRecord, row.jobCode, row.payrollStatus]),
          outcome.rows.map((row) => [row.emplRecord, row.jobCode, row.payrollStatus]),
        )) {
          throw new Error(`Workforce Job Summary EID ${directIdentifierDisplay(emplId)} returned different results on a repeated search`);
        }
      }
      first = false;
      await pagePort.drill(result.rowIndex);
      const refused = addDetail(await pagePort.readDetail());
      if (refused !== undefined) return refused;
    }
    const missing = [...results.keys()].filter((record) => !gridRows.some(({ emplRecord }) => emplRecord === record));
    if (missing.length > 0) {
      throw new Error(`Workforce Job Summary detail pages showed no rows for empl record(s) ${missing.join(", ")}`);
    }
    const extra = gridRows.filter(({ emplRecord }) => !results.has(emplRecord));
    if (extra.length > 0) {
      throw new Error(`Workforce Job Summary detail pages showed empl record(s) ${[...new Set(extra.map(({ emplRecord }) => emplRecord))].join(", ")} the results grid did not list`);
    }
    searchResultRows = results.size;
    statusByRecord = new Map([...results].map(([record, row]) => [record, row.payrollStatus]));
  }

  if (names.size !== 1) throw new Error("Workforce Job Summary detail pages for one EID displayed different names");
  const records = [...new Set(gridRows.map(({ emplRecord }) => emplRecord))];
  const jobRows = records.map((record, rowIndex) => {
    const status = statusByRecord.get(record);
    return deriveWorkforceJobRow(
      pickRowInEffect(gridRows.filter(({ emplRecord }) => emplRecord === record), input.asOf),
      status === undefined ? STATUS_NOT_SHOWN : { state: "present", value: status },
      rowIndex,
    );
  });
  return UcpathJobSummaryReadSchema.parse({
    state: "read",
    summary: {
      pageStateId: UCPATH_JOB_SUMMARY_PAGE_STATE,
      emplId,
      displayedName: [...names][0],
      jobRows,
      rowCount: jobRows.length,
      renderContext: {
        entry: outcome.kind === "detail" ? "auto-detail" : "drilled-from-grid",
        searchResultRows,
        employmentInstances: "already-complete",
      },
      observedAt,
    },
  });
}

async function readText(assertCurrent: () => void, locator: Locator, label: string): Promise<string> {
  assertCurrent();
  if (await locator.count() !== 1) throw new Error(`Workforce Job Summary ${label} did not render exactly once`);
  const text = (await locator.innerText({ timeout: BOUND_MS })).trim();
  assertCurrent();
  return text;
}

/** Waits until the frozen grid shows the requested tab: every right row starts with that tab's anchor and both tables have the same row count. */
async function readFrozenGrid(assertCurrent: () => void, page: Page, tab: "work-location" | "job-information"): Promise<FrozenGrid> {
  const ids = { left: ui.frozenLeftTableId, right: ui.frozenRightTableId, anchor: tab === "work-location" ? POSITION_NUMBER.source : JOB_CODE.source };
  assertCurrent();
  await page.waitForFunction(({ left, right, anchor }) => {
    const leftTable = document.getElementById(left) as HTMLTableElement | null;
    const rightTable = document.getElementById(right) as HTMLTableElement | null;
    if (leftTable === null || rightTable === null || rightTable.rows.length === 0) return false;
    const pattern = new RegExp(anchor, "u");
    return leftTable.rows.length === rightTable.rows.length
      && Array.from(rightTable.rows).every((row) => pattern.test((row.cells[0]?.textContent ?? "").replace(/\s+/gu, " ").trim()));
  }, ids, { timeout: GRID_RENDER_MS });
  assertCurrent();
  const grid = await page.evaluate(({ left, right }) => {
    const rowsOf = (id: string) => Array.from((document.getElementById(id) as HTMLTableElement | null)?.rows ?? [])
      .map((row) => Array.from(row.cells).map((cellElement) => (cellElement.textContent ?? "").replace(/\s+/gu, " ").trim()));
    return { left: rowsOf(left), right: rowsOf(right) };
  }, ids);
  assertCurrent();
  return FrozenGridSchema.parse(grid);
}

function createPlaywrightWorkforceJobSummaryPage(assertCurrent: () => void, page: Page): WorkforceJobSummaryPagePort {
  const goto = async () => {
    assertCurrent();
    await page.goto(ui.url, { waitUntil: "domcontentloaded", timeout: BOUND_MS });
    assertCurrent();
    recordBrowserAction("opened", "ucpath.workforce-job-summary.search");
  };
  const openSearch = async () => {
    await goto();
    if (page.url().includes(ui.campusDiscoveryUrlMarker)) {
      // Choosing the campus lands on the portal home, not the deep link, so open the component again once the campus is set.
      await ui.campusDiscoveryUcsdLink(page).click({ timeout: BOUND_MS });
      assertCurrent();
      recordBrowserAction("clicked", "ucpath.workforce-job-summary.campus-discovery-ucsd");
      await page.waitForURL((url) => !url.href.includes(ui.campusDiscoveryUrlMarker), { timeout: BOUND_MS });
      assertCurrent();
      if (!page.url().includes(ui.componentUrlMarker)) await goto();
    }
    await ui.emplIdInput(page).waitFor({ state: "visible", timeout: BOUND_MS });
    assertCurrent();
  };
  const waitForDetail = async () => {
    assertCurrent();
    await ui.personName(page).waitFor({ state: "visible", timeout: BOUND_MS });
    assertCurrent();
  };
  const openTab = async (tab: Locator, id: string) => {
    assertCurrent();
    await tab.click({ timeout: BOUND_MS });
    assertCurrent();
    recordBrowserAction("clicked", id);
  };

  return {
    async search(eid) {
      await openSearch();
      await ui.emplIdInput(page).fill(eid, { timeout: BOUND_MS });
      assertCurrent();
      recordBrowserAction("typed", "ucpath.workforce-job-summary.empl-id-input", eid);
      await ui.searchButton(page).click({ timeout: BOUND_MS });
      assertCurrent();
      recordBrowserAction("clicked", "ucpath.workforce-job-summary.search-button");

      const noResults = ui.noResults(page);
      const detail = ui.personName(page);
      const rows = ui.resultRows(page);
      await noResults.or(detail).or(rows.first()).first().waitFor({ state: "visible", timeout: BOUND_MS });
      assertCurrent();
      const [noResultsShown, detailShown, rowCount] = await Promise.all([noResults.isVisible(), detail.isVisible(), rows.count()]);
      assertCurrent();
      if ([noResultsShown, detailShown, rowCount > 0].filter(Boolean).length !== 1) {
        throw new Error("Workforce Job Summary search settled on more than one of: no results, a detail page, a results grid");
      }
      if (noResultsShown) return { kind: "not-found", marker: await readText(assertCurrent, noResults, "no-results message") };
      if (detailShown) return { kind: "detail" };
      const parsed: WorkforceJobSummaryResultRow[] = [];
      for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
        const row = rows.nth(rowIndex);
        parsed.push(WorkforceJobSummaryResultRowSchema.parse({
          rowIndex,
          emplRecord: await readText(assertCurrent, ui.resultEmplRecord(row), "result Empl Record"),
          jobCode: await readText(assertCurrent, ui.resultJobCode(row), "result Job Code"),
          payrollStatus: await readText(assertCurrent, ui.resultPayrollStatus(row), "result Payroll Status"),
        }));
      }
      return { kind: "grid", rows: parsed };
    },
    async drill(rowIndex) {
      assertCurrent();
      await ui.resultDrillIn(ui.resultRows(page).nth(rowIndex)).click({ timeout: BOUND_MS });
      assertCurrent();
      recordBrowserAction("clicked", "ucpath.workforce-job-summary.result-drill-in");
      await waitForDetail();
    },
    async readDetail() {
      await waitForDetail();
      const displayedEid = await readText(assertCurrent, ui.displayedEmplId(page), "displayed Empl ID");
      const displayedName = await readText(assertCurrent, ui.personName(page), "displayed name");
      await openTab(ui.workLocationTab(page), "ucpath.workforce-job-summary.work-location-tab");
      const workLocation = await readFrozenGrid(assertCurrent, page, "work-location");
      await openTab(ui.jobInformationTab(page), "ucpath.workforce-job-summary.job-information-tab");
      const jobInformation = await readFrozenGrid(assertCurrent, page, "job-information");
      recordBrowserAction("read", "ucpath.workforce-job-summary.job-grid");
      return WorkforceJobSummaryDetailSchema.parse({ displayedEid, displayedName, workLocation, jobInformation });
    },
  };
}

export async function readWorkforceJobSummaryOnPage(
  assertCurrent: () => void,
  page: Page,
  input: Readonly<{ emplId: Eid; asOf?: LocalDate }>,
  observedAt: string,
): Promise<UcpathJobSummaryRead> {
  const result = await readWorkforceJobSummaryWithPagePort(createPlaywrightWorkforceJobSummaryPage(assertCurrent, page), input, observedAt);
  assertCurrent();
  return result;
}
