/**
 * Strict UCPath Person Organizational Summary read.
 *
 * Port provenance (legacy repo, commit 793abe1f8265f3213ffe8a80d6cfd9860a32a1dc):
 * - src/systems/ucpath/person-org-summary.ts @ 601d3a2407e9c6cd79f2383c240be8a9ca7261db
 * - src/workflows/person-lookup/lookup.ts @ b29f57105699e4e1ca96e1186035783ba98a414d
 * - src/workflows/person-lookup/outcome.ts @ 454320b59d280ff8ccfa24b6b0235ad49a86ae2d
 * - src/systems/ucpath/selectors.ts @ 695d88fcc7a108f262b91b45eb1b9a276deaf427
 *
 * The search ordering and preferred-assignment rules are faithful ports. Unsafe legacy fallbacks
 * are deliberately rejected: no body-name scan, no observed-EID overwrite, no extraction-error
 * empty array, no missing-table not-found, no swallowed field clear, and no drill-failure null.
 */
import type { Locator, Page } from "playwright";
import { z } from "zod";
import {
  SearchPersonOrgInputSchema,
  SearchPersonOrgOutputSchema,
  UcpathCandidateSchema,
} from "../../../domain/contracts/ucpath/search-person-org.js";
import type {
  SearchPersonOrgOutput,
  UcpathCandidate,
} from "../../../domain/contracts/ucpath/search-person-org.js";
import { EidSchema } from "../../../domain/ids.js";
import type { Eid, ElementId } from "../../../domain/ids.js";
import {
  UCPATH_JOB_SUMMARY_PAGE_STATE,
  UcpathJobRowSchema,
  UcpathJobSummaryReadSchema,
} from "../../../domain/ui/ucpath-job-summary.js";
import type {
  UcpathJobRow,
  UcpathJobSummaryRead,
} from "../../../domain/ui/ucpath-job-summary.js";
import {
  UCPATH_PERSON_ORG_ASSIGNMENTS_GRID,
  UCPATH_PERSON_ORG_EID_DISPLAY,
  UCPATH_PERSON_ORG_EID_INPUT,
  UCPATH_PERSON_ORG_EMPLOYMENT_VIEW_TOGGLE,
  UCPATH_PERSON_ORG_GIVEN_NAME_INPUT,
  UCPATH_PERSON_ORG_LAST_NAME_INPUT,
  UCPATH_PERSON_ORG_NAME_DISPLAY,
  UCPATH_PERSON_ORG_NAVIGATION_LINK,
  UCPATH_PERSON_ORG_NO_RESULTS_STATUS,
  UCPATH_PERSON_ORG_RESULTS_GRID,
  UCPATH_PERSON_ORG_RESULTS_VIEW_TOGGLE,
  UCPATH_PERSON_ORG_RESULT_DRILL_IN,
  UCPATH_PERSON_ORG_RETURN_TO_SEARCH,
  UCPATH_PERSON_ORG_SEARCH_BUTTON,
  UCPATH_PERSON_ORG_SEARCH_READY,
} from "../../../domain/ui/ucpath-person-org.js";
import {
  resolveUcpathElement,
  resolveUcpathIndexedElement,
  waitForUcpathContentFrameDocument,
  waitForUcpathState,
} from "./registry-locators.js";

const PERSON_ORG_SUMMARY_URL =
  "https://ucphrprdpub.universityofcalifornia.edu/psc/ucphrprd/EMPLOYEE/HRMS/c/NUI_FRAMEWORK.PT_AGSTARTPAGE_NUI.GBL?CONTEXTIDPARAMS=TEMPLATE_ID%3aPTPPNAVCOL&scname=ADMN_UC_ADMIN_LOC_HIRE_NAVCOLL&PanelCollapsible=Y&PTPPB_GROUPLET_ID=UC_HIRE_TASKS_TILE_FL&CRefName=UC_HIRE_TASKS_TILE_FL&AJAXTRANSFER=Y";
const OUTCOME_TIMEOUT_MS = 30_000;
const NO_RESULTS_TEXT = "No matching values were found";

const ResultGridRowSchema = z.strictObject({
  emplId: EidSchema,
  emplRecord: z.string(),
  hrStatus: z.string().min(1),
  businessUnit: z.string().min(1),
  jobCode: z.string(),
  jobCodeDescription: z.string().min(1),
  lastName: z.string().min(1),
  name: z.string().min(1),
  rowIndex: z.number().int().nonnegative(),
});
export type PersonOrgResultGridRow = z.infer<typeof ResultGridRowSchema>;

const AssignmentDetailsSchema = z.strictObject({
  emplRecord: z.string(),
  effectiveDate: z.string(),
  hrStatus: z.string().min(1),
  businessUnit: z.string().regex(/^[A-Z]{4,5}\d?$/),
  positionNumber: z.string(),
  deptId: z.string(),
  department: z.string().min(1),
  jobCode: z.string(),
  jobCodeDescription: z.string().min(1),
  expectedJobEndDate: z.string(),
  fte: z.string(),
  emplClass: z.string(),
});
export type PersonOrgAssignmentDetails = z.infer<typeof AssignmentDetailsSchema>;

const PersonOrgDetailSchema = z.strictObject({
  observedEid: EidSchema,
  displayedName: z.string().min(1),
  /**
   * Every Employment Instances row's cells, verbatim, from the ONE extraction.
   *
   * The detail deliberately does NOT carry a parsed `assignment` any more.
   * `searchPersonOrg` still selects its preferred row (through
   * `deriveAssignmentDetailsFromCells` + `selectPreferredAssignmentDetails`,
   * both unchanged), but that derivation REFUSES a blank department or job
   * description — correct for a candidate, and wrong for the job-summary read,
   * where S24's unreadable cell is data with a reason. Parsing eagerly here
   * would have made a blank department fail an identity check that never uses
   * the department. One extraction, two parses, each strict about its own
   * needs.
   */
  cells: z.array(z.array(z.string())).min(1),
  /** Whether `View All` had to be driven, or the grid was already complete. */
  employmentInstances: z.enum(["already-complete", "expanded"]),
});
export type PersonOrgDetail = z.infer<typeof PersonOrgDetailSchema>;

export type PersonOrgSearchPageOutcome =
  | Readonly<{ kind: "not-found"; marker: string }>
  | Readonly<{ kind: "detail"; detail: PersonOrgDetail }>
  | Readonly<{ kind: "grid"; rows: readonly PersonOrgResultGridRow[] }>;

export interface PersonOrgPagePort {
  readonly search: (query:
    | Readonly<{ kind: "by-eid"; eid: Eid }>
    | Readonly<{ kind: "by-name"; lastName: string; givenName: string }>) => Promise<PersonOrgSearchPageOutcome>;
  readonly drill: (rowIndex: number) => Promise<PersonOrgDetail>;
  readonly returnToResults: () => Promise<void>;
}

export interface PersonOrgViewTogglePort {
  readonly count: () => Promise<number>;
  readonly readText: () => Promise<string>;
  readonly readHref: () => Promise<string | null>;
  readonly click: () => Promise<void>;
  readonly waitForExpanded: () => Promise<void>;
}

function assertEnabledViewToggleHref(href: string | null, label: string): void {
  if (href === null || !href.startsWith("javascript:submitAction_win0(")) {
    throw new Error(`${label} enabled View All control has an unexpected href`);
  }
}

/**
 * PeopleSoft's verified completeness contract is stateful: an enabled `View All` anchor must be
 * clicked and become `View N`; an already-complete grid exposes disabled `View All` text without
 * an href. Absence or any third state is unknown and therefore fails loud.
 */
export async function ensurePersonOrgViewAllExpanded(
  port: PersonOrgViewTogglePort,
  label: string,
): Promise<"already-complete" | "expanded"> {
  const count = await port.count();
  if (count !== 1) throw new Error(`${label} requires exactly one View All state control; found ${String(count)}`);
  const text = (await port.readText()).trim();
  const href = await port.readHref();
  if (/^View [1-9]\d*$/u.test(text)) {
    assertEnabledViewToggleHref(href, label);
    return "already-complete";
  }
  if (text !== "View All") throw new Error(`${label} has unknown View All state ${JSON.stringify(text)}`);
  if (href === null) return "already-complete";
  assertEnabledViewToggleHref(href, label);
  await port.click();
  await port.waitForExpanded();
  const afterCount = await port.count();
  if (afterCount !== 1) {
    throw new Error(`${label} View All transition produced ${String(afterCount)} state controls`);
  }
  const afterText = (await port.readText()).trim();
  if (!/^View [1-9]\d*$/u.test(afterText)) {
    throw new Error(`${label} View All did not transition to a complete View N state`);
  }
  assertEnabledViewToggleHref(await port.readHref(), label);
  return "expanded";
}

export interface PersonOrgNameSearchAttempt {
  readonly lastName: string;
  readonly name: string;
}

function titleCasePersonToken(token: string): string {
  return token
    .split(/([-' ])/)
    .map((part) => {
      if (part === "-" || part === "'" || part === " ") return part;
      if (part.length === 0) return part;
      return `${part[0]?.toUpperCase() ?? ""}${part.slice(1).toLowerCase()}`;
    })
    .join("");
}

function displayPersonName(raw: string): string {
  const trimmed = raw.trim().replace(/\s+/g, " ");
  const commaIndex = trimmed.indexOf(",");
  const titleCaseTokens = (value: string): string => value
    .split(/\s+/)
    .filter(Boolean)
    .map(titleCasePersonToken)
    .join(" ");
  if (commaIndex === -1) return titleCaseTokens(trimmed).replace(/\.\s*$/, "").trim();
  const last = trimmed.slice(0, commaIndex).trim();
  const rest = trimmed.slice(commaIndex + 1).trim();
  if (last.length === 0 || rest.length === 0) return trimmed.replace(/\.\s*$/, "").trim();
  return `${titleCaseTokens(last)}, ${titleCaseTokens(rest)}`.replace(/\.\s*$/, "").trim();
}

function canonicalPersonNameKey(raw: string): string {
  return raw.toLowerCase().replaceAll(",", " ").replace(/\s+/g, " ").trim();
}

function toLastFirstSearchName(raw: string): string {
  const display = displayPersonName(raw);
  if (display.includes(",")) {
    const [last, ...rest] = display.split(",").map((part) => part.trim()).filter(Boolean);
    if (last === undefined || rest.length === 0) return display;
    return displayPersonName(`${last}, ${rest.join(" ")}`);
  }
  const parts = display.split(/\s+/).filter(Boolean);
  if (parts.length < 2) return display;
  if (parts.length === 2) return displayPersonName(`${parts[1]}, ${parts[0]}`);
  if (/^[A-Z]\.?$/i.test(parts[1] ?? "")) {
    return displayPersonName(`${parts.slice(2).join(" ")}, ${parts[0]} ${parts[1]}`);
  }
  if (parts.length >= 4) {
    return displayPersonName(`${parts.slice(-2).join(" ")}, ${parts.slice(0, -2).join(" ")}`);
  }
  return displayPersonName(`${parts.at(-1) ?? ""}, ${parts.slice(0, -1).join(" ")}`);
}

export function buildLastFirstSearchNames(raw: string): readonly string[] {
  const display = displayPersonName(raw);
  if (display.length === 0) return [];
  const values: string[] = [];
  const seen = new Set<string>();
  const add = (value: string): void => {
    const normalized = displayPersonName(value);
    if (normalized.length === 0) return;
    const key = canonicalPersonNameKey(normalized);
    if (seen.has(key)) return;
    seen.add(key);
    values.push(normalized);
  };
  add(toLastFirstSearchName(display));
  if (display.includes(",")) return values;
  const parts = display.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) add(`${parts[0]}, ${parts.slice(1).join(" ")}`);
  if (parts.length >= 3) add(`${parts.slice(0, 2).join(" ")}, ${parts.slice(2).join(" ")}`);
  return values;
}

function parseLastFirstName(input: string): Readonly<{
  lastName: string;
  first: string;
  middle: string | null;
}> {
  const display = displayPersonName(input);
  const commaIndex = display.indexOf(",");
  if (commaIndex === -1) {
    throw new Error(`Person Org name ${JSON.stringify(input)} is not in Last, First form`);
  }
  const lastName = display.slice(0, commaIndex).trim();
  const rest = display.slice(commaIndex + 1).trim().split(/\s+/).filter(Boolean);
  const first = rest[0];
  if (lastName.length === 0 || first === undefined) {
    throw new Error(`Person Org name ${JSON.stringify(input)} is missing a last or given name`);
  }
  return { lastName, first, middle: rest.length > 1 ? rest.slice(1).join(" ") : null };
}

export function buildPersonOrgNameSearchAttempts(input: Readonly<{
  lastName: string;
  first: string;
  middle: string | null;
}>): readonly PersonOrgNameSearchAttempt[] {
  const attempts: PersonOrgNameSearchAttempt[] = [];
  const seen = new Set<string>();
  const add = (lastName: string, name: string): void => {
    const normalizedLast = lastName.trim();
    const normalizedName = name.trim();
    if (normalizedLast.length === 0) return;
    const key = `${normalizedLast.toLowerCase()}\u0000${normalizedName.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    attempts.push({ lastName: normalizedLast, name: normalizedName });
  };
  add(input.lastName, input.middle === null ? input.first : `${input.first} ${input.middle}`);
  if (input.middle !== null) {
    add(input.lastName, input.first);
    add(input.lastName, input.middle);
  }
  for (const token of input.lastName.split(/\s+/).filter(Boolean)) {
    if (input.lastName.includes(" ")) add(token, input.first);
  }
  return attempts;
}

function isAcceptedHdhDepartment(department: string): boolean {
  const normalized = department.toLowerCase();
  return ["housing", "dining", "hospitality"].some((keyword) => normalized.includes(keyword));
}

function isInactiveHrStatus(status: string): boolean {
  return /inactive|terminated|separated/i.test(status);
}

export function deriveAssignmentDetailsFromCells(cells: readonly string[]): PersonOrgAssignmentDetails {
  if (cells.length < 12) {
    throw new Error(`Person Org assignment row has ${String(cells.length)} cells; expected at least 12`);
  }
  const values = cells.map((cell) => cell.trim());
  if (values[6] === "Department Description") {
    throw new Error("Person Org assignment extraction reached a header row instead of data");
  }
  return AssignmentDetailsSchema.parse({
    emplRecord: values[0],
    effectiveDate: values[1],
    hrStatus: values[2],
    businessUnit: values[3],
    positionNumber: values[4],
    deptId: values[5],
    department: values[6],
    jobCode: values[7],
    jobCodeDescription: values[8],
    expectedJobEndDate: values[9],
    fte: values[10],
    emplClass: values[11],
  });
}

function comparePreferredAssignment(
  left: PersonOrgAssignmentDetails,
  right: PersonOrgAssignmentDetails,
): number {
  const leftActive = !isInactiveHrStatus(left.hrStatus);
  const rightActive = !isInactiveHrStatus(right.hrStatus);
  if (leftActive !== rightActive) return leftActive ? -1 : 1;
  const leftHdh = isAcceptedHdhDepartment(left.department);
  const rightHdh = isAcceptedHdhDepartment(right.department);
  if (leftHdh !== rightHdh) return leftHdh ? -1 : 1;
  const leftRecord = Number.parseInt(left.emplRecord, 10);
  const rightRecord = Number.parseInt(right.emplRecord, 10);
  if (Number.isFinite(leftRecord) && Number.isFinite(rightRecord) && leftRecord !== rightRecord) {
    return rightRecord - leftRecord;
  }
  return 0;
}

/**
 * The inverse of `deriveAssignmentDetailsFromCells`, for fixtures and fakes.
 *
 * A fixture that authors a `PersonOrgAssignmentDetails` and hands it to the port
 * as `cells` exercises the REAL parse on the way back in, which is the point —
 * a fixture that skipped the parse would agree with a broken one.
 */
export function assignmentDetailsToCells(
  details: PersonOrgAssignmentDetails,
): readonly string[] {
  return [
    details.emplRecord, details.effectiveDate, details.hrStatus, details.businessUnit,
    details.positionNumber, details.deptId, details.department, details.jobCode,
    details.jobCodeDescription, details.expectedJobEndDate, details.fte, details.emplClass,
  ];
}

export function selectPreferredAssignmentDetails(
  assignments: readonly PersonOrgAssignmentDetails[],
): PersonOrgAssignmentDetails {
  const selected = [...assignments].sort(comparePreferredAssignment)[0];
  if (selected === undefined) throw new Error("Person Org detail has no parsed assignment rows");
  return selected;
}

function employeeStatus(hrStatus: string): UcpathCandidate["employeeStatus"] {
  if (/terminated|separated/i.test(hrStatus)) return "terminated";
  if (/inactive/i.test(hrStatus)) return "inactive";
  if (/active/i.test(hrStatus)) return "active";
  return "unknown";
}

function toLastFirstName(fullName: string, lastName: string): string {
  const normalizedFull = fullName.trim().replace(/\s+/g, " ");
  if (normalizedFull.includes(",")) return displayPersonName(normalizedFull);
  const normalizedLast = lastName.trim().replace(/\s+/g, " ");
  if (normalizedLast.length === 0) throw new Error(`Person Org cannot normalize displayed name ${fullName}`);
  const escapedLast = normalizedLast.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const trailingLast = new RegExp(`\\s+${escapedLast}$`, "i");
  if (!trailingLast.test(normalizedFull)) {
    throw new Error(
      `Person Org displayed name ${JSON.stringify(fullName)} does not end with expected last name ${JSON.stringify(lastName)}`,
    );
  }
  const givenNames = normalizedFull.replace(trailingLast, "").trim();
  if (givenNames.length === 0) throw new Error(`Person Org displayed name ${fullName} has no given name`);
  return displayPersonName(`${normalizedLast}, ${givenNames}`);
}

export function preferredAssignmentOf(detail: PersonOrgDetail): PersonOrgAssignmentDetails {
  return selectPreferredAssignmentDetails(
    detail.cells.map((cells) => deriveAssignmentDetailsFromCells(cells)),
  );
}

function candidateFromDetail(detail: PersonOrgDetail, expectedLastName: string): UcpathCandidate {
  const assignment = preferredAssignmentOf(detail);
  return UcpathCandidateSchema.parse({
    emplId: detail.observedEid,
    name: toLastFirstName(detail.displayedName, expectedLastName),
    department: assignment.department,
    jobTitle: assignment.jobCodeDescription,
    employeeStatus: employeeStatus(assignment.hrStatus),
    hdh: isAcceptedHdhDepartment(assignment.department),
  });
}

function lastNameFromDisplayedName(displayedName: string): string {
  const normalized = displayedName.trim().replace(/\s+/g, " ");
  if (normalized.includes(",")) {
    const last = normalized.split(",", 1)[0]?.trim();
    if (last !== undefined && last.length > 0) return last;
  }
  const last = normalized.split(" ").at(-1);
  if (last === undefined || last.length === 0) {
    throw new Error(`Person Org displayed name ${JSON.stringify(displayedName)} has no last-name token`);
  }
  return last;
}

function comparePreferredCandidate(left: UcpathCandidate, right: UcpathCandidate): number {
  const leftActive = left.employeeStatus === "active";
  const rightActive = right.employeeStatus === "active";
  if (leftActive !== rightActive) return leftActive ? -1 : 1;
  if (left.hdh !== right.hdh) return left.hdh ? -1 : 1;
  return 0;
}

function outputFor(
  input: z.output<typeof SearchPersonOrgInputSchema>,
  results: readonly UcpathCandidate[],
): SearchPersonOrgOutput {
  const parsedResults = results.map((result) => UcpathCandidateSchema.parse(result));
  const candidateEids = [...new Set(parsedResults.map(({ emplId }) => emplId))];
  const searchName = input.kind === "by-eid" ? input.emplId : input.name.trim();
  if (parsedResults.length === 0) {
    return SearchPersonOrgOutputSchema.parse({
      results: [],
      selection: { status: "not-found", selected: null, candidateEids: [], searchName },
    });
  }
  if (input.kind === "by-name" && candidateEids.length > 1) {
    return SearchPersonOrgOutputSchema.parse({
      results: parsedResults,
      selection: { status: "ambiguous", selected: null, candidateEids, searchName },
    });
  }
  const selected = [...parsedResults].sort(comparePreferredCandidate)[0];
  if (selected === undefined) throw new Error("Person Org resolved selection has no candidate");
  return SearchPersonOrgOutputSchema.parse({
    results: parsedResults,
    selection: { status: "resolved", selected, candidateEids },
  });
}

async function candidatesFromGrid(
  pagePort: PersonOrgPagePort,
  rows: readonly PersonOrgResultGridRow[],
): Promise<readonly UcpathCandidate[]> {
  const sdcmpRows = rows.filter(({ businessUnit }) => businessUnit === "SDCMP");
  const candidates: UcpathCandidate[] = [];
  for (let index = 0; index < sdcmpRows.length; index += 1) {
    const row = sdcmpRows[index];
    if (row === undefined) throw new Error(`Person Org SDCMP row ${String(index)} disappeared`);
    const detail = await pagePort.drill(row.rowIndex);
    if (detail.observedEid !== row.emplId) {
      throw new Error(
        `Person Org drill row ${String(row.rowIndex)} expected EID ${row.emplId} but displayed ${detail.observedEid}`,
      );
    }
    candidates.push(candidateFromDetail(detail, row.lastName));
    if (index < sdcmpRows.length - 1) await pagePort.returnToResults();
  }
  return candidates;
}

async function candidatesFromOutcome(
  pagePort: PersonOrgPagePort,
  outcome: PersonOrgSearchPageOutcome,
  expectedLastName: string,
): Promise<readonly UcpathCandidate[]> {
  if (outcome.kind === "not-found") return [];
  if (outcome.kind === "detail") return [candidateFromDetail(outcome.detail, expectedLastName)];
  return candidatesFromGrid(pagePort, outcome.rows);
}

export async function searchPersonOrgWithPagePort(
  pagePort: PersonOrgPagePort,
  inputValue: z.output<typeof SearchPersonOrgInputSchema>,
): Promise<SearchPersonOrgOutput> {
  const input = SearchPersonOrgInputSchema.parse(inputValue);
  if (input.kind === "by-eid") {
    const outcome = await pagePort.search({ kind: "by-eid", eid: input.emplId });
    let candidates: readonly UcpathCandidate[];
    if (outcome.kind === "grid") {
      if (outcome.rows.length === 0 || outcome.rows.some(({ emplId }) => emplId !== input.emplId)) {
        throw new Error(`Person Org EID ${input.emplId} returned an unexpected results grid`);
      }
      candidates = await candidatesFromGrid(pagePort, outcome.rows);
    } else {
      const expectedLastName = outcome.kind === "detail"
        ? lastNameFromDisplayedName(outcome.detail.displayedName)
        : "";
      candidates = await candidatesFromOutcome(pagePort, outcome, expectedLastName);
    }
    for (const candidate of candidates) {
      if (candidate.emplId !== input.emplId) {
        throw new Error(`Person Org EID search expected ${input.emplId} but observed ${candidate.emplId}`);
      }
    }
    return outputFor(input, candidates);
  }

  const searchNames = buildLastFirstSearchNames(input.name);
  if (searchNames.length === 0) throw new Error("Person Org by-name search received an empty normalized name");
  let results: readonly UcpathCandidate[] = [];
  for (const searchName of searchNames) {
    const parsed = parseLastFirstName(searchName);
    for (const attempt of buildPersonOrgNameSearchAttempts(parsed)) {
      const outcome = await pagePort.search({
        kind: "by-name",
        lastName: attempt.lastName,
        givenName: attempt.name,
      });
      results = await candidatesFromOutcome(pagePort, outcome, parsed.lastName);
      if (!input.keepNonHdh) results = results.filter(({ hdh }) => hdh);
      if (results.length > 0) return outputFor(input, results);
    }
  }
  return outputFor(input, results);
}

export function parsePersonOrgGridRows(
  cellsByRow: readonly (readonly string[])[],
): readonly PersonOrgResultGridRow[] {
  if (cellsByRow.length === 0) {
    throw new Error("Person Org results grid rendered without rows; refusing to report not-found");
  }
  return cellsByRow.map((cells, rowIndex) => {
    if (cells.length < 8) {
      throw new Error(`Person Org results row ${String(rowIndex)} has ${String(cells.length)} cells; expected at least 8`);
    }
    return ResultGridRowSchema.parse({
      emplId: cells[0]?.trim(),
      emplRecord: cells[1]?.trim(),
      hrStatus: cells[2]?.trim(),
      businessUnit: cells[3]?.trim(),
      jobCode: cells[4]?.trim(),
      jobCodeDescription: cells[5]?.trim(),
      lastName: cells[6]?.trim(),
      name: cells[7]?.trim(),
      rowIndex,
    });
  });
}

async function readRequiredText(locator: Locator, label: string): Promise<string> {
  const text = await locator.textContent();
  if (text === null || text.trim().length === 0) throw new Error(`Person Org ${label} rendered without text`);
  return text.trim();
}

function playwrightViewTogglePort(page: Page, id: ElementId, label: string): PersonOrgViewTogglePort {
  const toggle = (): Locator => resolveUcpathElement(page, id);
  return {
    count: () => toggle().count(),
    readText: () => readRequiredText(toggle(), `${label} View All state`),
    readHref: () => toggle().getAttribute("href"),
    click: () => toggle().click(),
    waitForExpanded: () => toggle().filter({ hasText: /^View [1-9]\d*$/u }).waitFor({
      state: "visible",
      timeout: OUTCOME_TIMEOUT_MS,
    }),
  };
}

async function ensureResultsExpanded(page: Page): Promise<void> {
  await ensurePersonOrgViewAllExpanded(
    playwrightViewTogglePort(page, UCPATH_PERSON_ORG_RESULTS_VIEW_TOGGLE, "Person Org search results"),
    "Person Org search results",
  );
}

/**
 * Legacy provenance for the CELL LAYOUT this reads (unchanged from the port at
 * `deriveAssignmentDetailsFromCells`): twelve columns, in this order, from the
 * Person Org Employment Instances grid. The job-summary read parses the same
 * twelve — it differs only in which of them may legitimately be blank.
 */
const JOB_ROW_CELL_COUNT = 12;

function jobCell(raw: string | undefined, label: string): { state: "present"; value: string }
  | { state: "absent"; reason: string } {
  const value = (raw ?? "").trim();
  return value.length === 0
    ? {
      state: "absent",
      reason: `the Person Org Employment Instances grid rendered ${label} as an empty cell`,
    }
    : { state: "present", value };
}

/**
 * One grid row → one `UcpathJobRow`.
 *
 * Empl record, HR status and business unit are STRUCTURAL and refuse a blank:
 * a rendered employment row always carries all three, so a blank one means the
 * extraction read something that is not an employment row (the header-row check
 * below is the same instinct). Everything else is an absent arm with a reason —
 * S24's unreadable department is data here, and the consumer that needs a
 * department is the one that refuses.
 */
export function deriveJobRowFromCells(cells: readonly string[], rowIndex: number): UcpathJobRow {
  if (cells.length < JOB_ROW_CELL_COUNT) {
    throw new Error(
      `Person Org job row ${String(rowIndex)} has ${String(cells.length)} cells; expected at least `
      + String(JOB_ROW_CELL_COUNT),
    );
  }
  const values = cells.map((cell) => cell.trim());
  if (values[6] === "Department Description") {
    throw new Error("Person Org job-summary extraction reached a header row instead of data");
  }
  return UcpathJobRowSchema.parse({
    rowIndex,
    emplRecord: values[0],
    hrStatus: values[2],
    businessUnit: values[3],
    effectiveDate: jobCell(values[1], "Effective Date"),
    positionNumber: jobCell(values[4], "Position Number"),
    deptId: jobCell(values[5], "Dept ID"),
    department: jobCell(values[6], "Department Description"),
    jobCode: jobCell(values[7], "Job Code"),
    jobTitle: jobCell(values[8], "Job Code Description"),
    expectedJobEndDate: jobCell(values[9], "Expected Job End Date"),
    fte: jobCell(values[10], "FTE"),
    emplClass: jobCell(values[11], "Empl Class"),
  });
}

/**
 * D194's read, over the SAME page port `searchPersonOrg` drives.
 *
 * The run already names the person, so this is not a resolution: it searches by
 * EID, reaches the detail page (auto-redirect, or one drill-in from the grid),
 * PROVES the displayed EID equals the requested one, and returns the whole
 * grid. Every negative it can answer is an outcome; anything mechanical throws.
 */
export async function readJobSummaryWithPagePort(
  pagePort: PersonOrgPagePort,
  input: Readonly<{ emplId: Eid }>,
  observedAt: string,
): Promise<UcpathJobSummaryRead> {
  const emplId = EidSchema.parse(input.emplId);
  const outcome = await pagePort.search({ kind: "by-eid", eid: emplId });
  if (outcome.kind === "not-found") {
    return UcpathJobSummaryReadSchema.parse({
      state: "employee-not-found",
      emplId,
      observedMarker: outcome.marker,
    });
  }
  let detail: PersonOrgDetail;
  let entry: "auto-detail" | "drilled-from-grid";
  let searchResultRows: number;
  if (outcome.kind === "detail") {
    detail = outcome.detail;
    entry = "auto-detail";
    searchResultRows = 0;
  } else {
    // A by-EID search that grids renders one row per employment instance, all
    // for the same person; drilling ANY of them reaches the same detail page,
    // whose own grid is the authority. Row 0 is chosen and then PROVED, rather
    // than a row being picked for its status — picking by status is exactly the
    // legacy shape that made S22 unobservable.
    const foreign = outcome.rows.filter(({ emplId: rowEid }) => rowEid !== emplId);
    if (foreign.length > 0) {
      throw new Error(
        `Person Org EID ${emplId} returned a results grid carrying ${String(foreign.length)} row(s) for `
        + `other people (${[...new Set(foreign.map(({ emplId: rowEid }) => rowEid))].join(", ")})`,
      );
    }
    const first = outcome.rows[0];
    if (first === undefined) throw new Error(`Person Org EID ${emplId} returned an empty results grid`);
    detail = await pagePort.drill(first.rowIndex);
    entry = "drilled-from-grid";
    searchResultRows = outcome.rows.length;
  }
  if (detail.observedEid !== emplId) {
    return UcpathJobSummaryReadSchema.parse({
      state: "subject-mismatch",
      expectedEid: emplId,
      observedEid: detail.observedEid,
    });
  }
  const jobRows = detail.cells.map((cells, rowIndex) => deriveJobRowFromCells(cells, rowIndex));
  return UcpathJobSummaryReadSchema.parse({
    state: "read",
    summary: {
      pageStateId: UCPATH_JOB_SUMMARY_PAGE_STATE,
      emplId,
      displayedName: detail.displayedName,
      jobRows,
      rowCount: jobRows.length,
      renderContext: {
        entry,
        searchResultRows,
        employmentInstances: detail.employmentInstances,
      },
      observedAt,
    },
  });
}

async function ensureEmploymentInstancesExpanded(
  page: Page,
): Promise<"already-complete" | "expanded"> {
  return ensurePersonOrgViewAllExpanded(
    playwrightViewTogglePort(
      page,
      UCPATH_PERSON_ORG_EMPLOYMENT_VIEW_TOGGLE,
      "Person Org Employment Instances",
    ),
    "Person Org Employment Instances",
  );
}

async function extractDetail(page: Page): Promise<PersonOrgDetail> {
  const eid = EidSchema.parse(await readRequiredText(
    resolveUcpathElement(page, UCPATH_PERSON_ORG_EID_DISPLAY),
    "displayed EID",
  ));
  const displayedName = await readRequiredText(
    resolveUcpathElement(page, UCPATH_PERSON_ORG_NAME_DISPLAY),
    `displayed name for EID ${eid}`,
  );
  const employmentInstances = await ensureEmploymentInstancesExpanded(page);
  const rows = await resolveUcpathElement(page, UCPATH_PERSON_ORG_ASSIGNMENTS_GRID)
    .locator("tr")
    .evaluateAll((elements) => elements.map((row) =>
      Array.from((row as HTMLTableRowElement).cells).map((cell) => cell.textContent?.trim() ?? "")
    ));
  return PersonOrgDetailSchema.parse({
    observedEid: eid,
    displayedName,
    cells: rows,
    employmentInstances,
  });
}

async function visible(locator: Locator): Promise<boolean> {
  return locator.isVisible();
}

function createPlaywrightPersonOrgPage(page: Page): PersonOrgPagePort {
  const navigateToSearch = async (): Promise<void> => {
    await page.goto(PERSON_ORG_SUMMARY_URL, {
      waitUntil: "domcontentloaded",
      timeout: OUTCOME_TIMEOUT_MS,
    });
    const navigation = resolveUcpathElement(page, UCPATH_PERSON_ORG_NAVIGATION_LINK);
    await navigation.waitFor({ state: "visible", timeout: OUTCOME_TIMEOUT_MS });
    // The step control routes through the nav collection's content frame, so
    // clicking before that frame holds a document is silently dropped.
    await waitForUcpathContentFrameDocument(page, OUTCOME_TIMEOUT_MS);
    await navigation.click();
    await waitForUcpathState(page, UCPATH_PERSON_ORG_SEARCH_READY);
  };

  return {
    async search(query) {
      await navigateToSearch();
      const eidInput = resolveUcpathElement(page, UCPATH_PERSON_ORG_EID_INPUT);
      const lastNameInput = resolveUcpathElement(page, UCPATH_PERSON_ORG_LAST_NAME_INPUT);
      const givenNameInput = resolveUcpathElement(page, UCPATH_PERSON_ORG_GIVEN_NAME_INPUT);
      await eidInput.fill("");
      await lastNameInput.fill("");
      await givenNameInput.fill("");
      if (query.kind === "by-eid") await eidInput.fill(query.eid);
      else {
        await lastNameInput.fill(query.lastName);
        await givenNameInput.fill(query.givenName);
      }
      await resolveUcpathElement(page, UCPATH_PERSON_ORG_SEARCH_BUTTON).click();

      const noResults = resolveUcpathElement(page, UCPATH_PERSON_ORG_NO_RESULTS_STATUS);
      const displayedEid = resolveUcpathElement(page, UCPATH_PERSON_ORG_EID_DISPLAY);
      const resultsGrid = resolveUcpathElement(page, UCPATH_PERSON_ORG_RESULTS_GRID);
      await noResults.or(displayedEid).or(resultsGrid).waitFor({
        state: "visible",
        timeout: OUTCOME_TIMEOUT_MS,
      });
      const states = await Promise.all([visible(noResults), visible(displayedEid), visible(resultsGrid)]);
      if (states.filter(Boolean).length !== 1) {
        throw new Error(`Person Org search outcome is ambiguous: no-results/detail/grid=${states.join("/")}`);
      }
      if (states[0] === true) {
        const text = await readRequiredText(noResults, "no-results status");
        if (!text.includes(NO_RESULTS_TEXT)) {
          throw new Error(`Person Org no-results status contained unexpected text ${JSON.stringify(text)}`);
        }
        return { kind: "not-found", marker: text };
      }
      if (states[1] === true) return { kind: "detail", detail: await extractDetail(page) };
      await ensureResultsExpanded(page);
      const cellsByRow = await resultsGrid.locator("tr").evaluateAll((elements) => elements.map((row) =>
        Array.from((row as HTMLTableRowElement).cells).map((cell) => cell.textContent?.trim() ?? "")
      ));
      return { kind: "grid", rows: parsePersonOrgGridRows(cellsByRow) };
    },
    async drill(rowIndex) {
      await resolveUcpathIndexedElement(page, UCPATH_PERSON_ORG_RESULT_DRILL_IN, rowIndex).click();
      return extractDetail(page);
    },
    async returnToResults() {
      await resolveUcpathElement(page, UCPATH_PERSON_ORG_RETURN_TO_SEARCH).click();
      await resolveUcpathElement(page, UCPATH_PERSON_ORG_RESULTS_GRID).waitFor({
        state: "visible",
        timeout: OUTCOME_TIMEOUT_MS,
      });
      await ensureResultsExpanded(page);
    },
  };
}

export async function searchPersonOrgOnPage(
  page: Page,
  input: z.output<typeof SearchPersonOrgInputSchema>,
): Promise<SearchPersonOrgOutput> {
  return searchPersonOrgWithPagePort(createPlaywrightPersonOrgPage(page), input);
}

export async function readJobSummaryOnPage(
  page: Page,
  input: Readonly<{ emplId: Eid }>,
  observedAt: string,
): Promise<UcpathJobSummaryRead> {
  return readJobSummaryWithPagePort(createPlaywrightPersonOrgPage(page), input, observedAt);
}

export const UCPATH_PERSON_ORG_OPERATION_ELEMENTS: readonly ElementId[] = Object.freeze([
  UCPATH_PERSON_ORG_NAVIGATION_LINK,
  UCPATH_PERSON_ORG_EID_INPUT,
  UCPATH_PERSON_ORG_LAST_NAME_INPUT,
  UCPATH_PERSON_ORG_GIVEN_NAME_INPUT,
  UCPATH_PERSON_ORG_SEARCH_BUTTON,
  UCPATH_PERSON_ORG_NO_RESULTS_STATUS,
  UCPATH_PERSON_ORG_RESULTS_GRID,
  UCPATH_PERSON_ORG_RESULTS_VIEW_TOGGLE,
  UCPATH_PERSON_ORG_RESULT_DRILL_IN,
  UCPATH_PERSON_ORG_EID_DISPLAY,
  UCPATH_PERSON_ORG_NAME_DISPLAY,
  UCPATH_PERSON_ORG_EMPLOYMENT_VIEW_TOGGLE,
  UCPATH_PERSON_ORG_ASSIGNMENTS_GRID,
  UCPATH_PERSON_ORG_RETURN_TO_SEARCH,
]);
