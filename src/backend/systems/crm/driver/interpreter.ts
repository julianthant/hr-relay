import { CrmDiscoveredRecordSchema, CrmRecordIdentityDriftError, type CrmDiscoveredRecord } from "../../../../models/systems/crm/search-onboarding-records.js";
import type { Locator, Page } from "playwright";
import { recordBrowserAction } from "../../browser-shared/action-notes.js";
import { z } from "zod";
import {
  CrmReadOnboardingDates, PersonLookupCrmDatesCheckError,
} from "../../../../models/systems/crm/read-onboarding-dates.js";
import {
  CrmReadOnboardingRecord,
  ReadOnboardingRecordOutputSchema,
} from "../../../../models/systems/crm/read-onboarding-record.js";
import { DateOnlySchema, EidSchema } from "../../../../rules/identity/ids.js";
import { directIdentifierDisplay } from "../../../../rules/redaction/redaction.js";
import {
  CRM_ONBOARDING_DISPLAYED_EID,
  CrmOnboardingDatesReadSchema,
  CrmOnboardingDriverSchema,
  CrmOnboardingRecordReadSchema,
  CrmSubjectBindingSchema,
} from "../../../../models/ui/crm-onboarding.js";
import type {
  CrmOnboardingDatesRead,
  CrmOnboardingDriver,
  CrmOnboardingRecordRead,
} from "../../../../models/ui/crm-onboarding.js";
import { CRM_UI_REGISTRY } from "./ui-registry.js";

const CRM_HOST = "act-crm.my.site.com";
const CRM_SEARCH_PATH = "/hr/ONB_SearchOnboardings";
const CRM_RECORD_PATH = "/hr/ONB_ViewOnboarding";
const NAVIGATION_TIMEOUT_MS = 30_000;
const STATE_TIMEOUT_MS = 30_000;
const EXPECTED_SEARCH_DATA_CELLS = 5;

const SearchRowSchema = z.strictObject({
  fullName: z.string().min(1),
  rawStage: z.string().min(1),
  recordId: z.string().min(1),
  recordUrl: z.url(),
});
type CrmOnboardingSearchRow = z.infer<typeof SearchRowSchema>;

const ExactRecordSchema = SearchRowSchema.extend({
  observedEid: EidSchema,
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  firstDayOfService: z.string(),
  department: z.string(), dateSigned: z.string(),
});
export type ExactCrmOnboardingRecord = z.infer<typeof ExactRecordSchema>;

const ExactRecordResolutionSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("found"), record: ExactRecordSchema }),
  z.strictObject({ state: z.literal("absent") }),
]);
export type ExactCrmRecordResolution = z.infer<typeof ExactRecordResolutionSchema>;


function elementRecipe(id: string) {
  const element = CRM_UI_REGISTRY.elements.find((candidate) => candidate.id === id);
  if (element === undefined) throw new Error(`CRM UI registry has no element ${id}`);
  return element.locator;
}

function assertExactCrmLocation(
  rawUrl: string,
  expectedPath: string,
  expectedRecordId?: string,
): URL {
  const url = new URL(rawUrl);
  if (url.protocol !== "https:" || url.hostname !== CRM_HOST || url.pathname !== expectedPath) {
    throw new Error(
      `CRM navigation expected https://${CRM_HOST}${expectedPath} but landed on ${url.origin}${url.pathname}`,
    );
  }
  if (expectedRecordId !== undefined && url.searchParams.get("id") !== expectedRecordId) {
    throw new Error(`CRM navigation expected record ${expectedRecordId} but landed on a different record id`);
  }
  return url;
}

function searchUrl(query: string): string {
  const url = new URL(`https://${CRM_HOST}${CRM_SEARCH_PATH}`);
  url.searchParams.set("q", query);
  return url.href;
}

function recordUrlFromHref(href: string): Readonly<{ recordId: string; recordUrl: string }> {
  const url = new URL(href, `https://${CRM_HOST}`);
  assertExactCrmLocation(url.href, CRM_RECORD_PATH);
  const recordId = url.searchParams.get("id")?.trim();
  if (recordId === undefined || recordId.length === 0) {
    throw new Error(`CRM onboarding record link ${url.pathname} is missing its record id`);
  }
  return { recordId, recordUrl: url.href };
}



async function waitForExactHeading(assertCurrent: () => void, page: Page, name: string): Promise<Locator> {
  const heading = page.getByRole("heading", { name, exact: true });
  assertCurrent();
  await heading.first().waitFor({ state: "visible", timeout: STATE_TIMEOUT_MS });
  assertCurrent();
  const count = await heading.count();
  if (count !== 1) throw new Error(`CRM expected exactly one heading "${name}" but found ${String(count)}`);
  assertCurrent();
  return heading;
}

async function waitForSearchReady(assertCurrent: () => void, page: Page, query: string): Promise<void> {
  assertCurrent();
  const url = assertExactCrmLocation(page.url(), CRM_SEARCH_PATH);
  if (url.searchParams.get("q") !== query) {
    throw new Error(`CRM search expected query ${query} but the rendered page used a different query`);
  }
  assertCurrent();
  await waitForExactHeading(assertCurrent, page, "Search Results");
  assertCurrent();
}

function searchRowsLocator(page: Page): Locator {
  const recipe = elementRecipe("crm.onboarding.search-result-rows");
  if (recipe.kind !== "css") throw new Error("CRM search-result row recipe changed kind unexpectedly");
  return page.locator(recipe.selector);
}

function directRowCells(row: Locator): Locator {
  const recipe = elementRecipe("crm.onboarding.search-result-row-cells");
  if (recipe.kind !== "row-cells") throw new Error("CRM search-result cells recipe changed kind unexpectedly");
  return row.locator(recipe.selector);
}

function rowNameLink(row: Locator): Locator {
  const recipe = elementRecipe("crm.onboarding.search-result-name-link");
  if (recipe.kind !== "row-name-link") throw new Error("CRM search-result link recipe changed kind unexpectedly");
  return row.locator(recipe.selector);
}

async function readRequiredText(assertCurrent: () => void, locator: Locator, field: string): Promise<string> {
  assertCurrent();
  const text = await locator.textContent();
  if (text === null) throw new Error(`CRM ${field} rendered without text`);
  const value = text.trim();
  if (value.length === 0) throw new Error(`CRM ${field} was blank`);
  assertCurrent();
  return value;
}

// CRM search data rows have five cells; the verified two-cell auxiliary row is not data.
async function searchCrmOnboardingRows(
  assertCurrent: () => void,
  page: Page,
  query: string,
): Promise<readonly CrmOnboardingSearchRow[]> {
  if (query.trim().length === 0) throw new Error("CRM onboarding search query cannot be blank");
  assertCurrent();
  await page.goto(searchUrl(query), {
    waitUntil: "domcontentloaded",
    timeout: NAVIGATION_TIMEOUT_MS,
  });
  assertCurrent();
  recordBrowserAction("opened", "crm.onboarding.search");
  assertCurrent();
  await waitForSearchReady(assertCurrent, page, query);

  const rows = searchRowsLocator(page);
  assertCurrent();
  const rowCount = await rows.count();
  const results: CrmOnboardingSearchRow[] = [];
  let auxiliaryRows = 0;
  for (let index = 0; index < rowCount; index += 1) {
    const row = rows.nth(index);
    const cells = directRowCells(row);
    assertCurrent();
    const cellCount = await cells.count();
    if (cellCount === 2) {
      auxiliaryRows += 1;
      if (auxiliaryRows > 1) throw new Error("CRM search rendered more than one auxiliary two-cell row");
      continue;
    }
    if (cellCount !== EXPECTED_SEARCH_DATA_CELLS) {
      throw new Error(
        `CRM search row ${String(index)} had ${String(cellCount)} direct cells; expected exactly ${String(EXPECTED_SEARCH_DATA_CELLS)}`,
      );
    }
    const link = rowNameLink(row);
    assertCurrent();
    const linkCount = await link.count();
    if (linkCount !== 1) {
      throw new Error(`CRM search row ${String(index)} had ${String(linkCount)} record links; expected exactly one`);
    }
    assertCurrent();
    const href = await link.getAttribute("href");
    if (href === null || href.trim().length === 0) {
      throw new Error(`CRM search row ${String(index)} record link had no href`);
    }
    const { recordId, recordUrl } = recordUrlFromHref(href);
    assertCurrent();
    results.push(SearchRowSchema.parse({
      fullName: await readRequiredText(assertCurrent, cells.nth(0), `search row ${String(index)} name`),
      rawStage: await readRequiredText(assertCurrent, cells.nth(4), `search row ${String(index)} process stage`),
      recordId,
      recordUrl,
    }));
  }

  const emptyHeading = page.getByRole("heading", {
    name: "No search results were found.",
    exact: true,
  });
  if (results.length === 0) {
    assertCurrent();
    await emptyHeading.first().waitFor({ state: "visible", timeout: STATE_TIMEOUT_MS });
    assertCurrent();
    const emptyCount = await emptyHeading.count();
    if (emptyCount !== 1) {
      throw new Error(`CRM zero-result search expected one verified empty-state heading but found ${String(emptyCount)}`);
    }
  } else {
    assertCurrent();
    if (await emptyHeading.count() !== 0) {
    throw new Error("CRM search rendered data rows and the no-results state simultaneously");
  }
  }
  assertCurrent();
  return Object.freeze(results);
}

type RecordFieldLabel =
  | "Employee First Name"
  | "Employee Last Name"
  | "UCPath Employee ID"
  | "First Day of Service (Effective Date)"
  | "Department"
  | "Date Signed";

function recordFieldLocator(page: Page, label: RecordFieldLabel): Locator {
  const recipe = elementRecipe("crm.onboarding.record-field-value");
  if (recipe.kind !== "label-following-cell") {
    throw new Error("CRM record-field recipe changed kind unexpectedly");
  }
  return page
    .locator(recipe.labelCell)
    .filter({ hasText: new RegExp(`^\\s*${label.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}\\s*$`, "u") })
    .locator(recipe.valueSelector);
}

async function readRecordField(
  assertCurrent: () => void,
  page: Page,
  label: RecordFieldLabel,
  blank: "allow" | "reject",
): Promise<string> {
  const locator = recordFieldLocator(page, label);
  assertCurrent();
  await locator.first().waitFor({ state: "visible", timeout: STATE_TIMEOUT_MS });
  assertCurrent();
  const count = await locator.count();
  if (count !== 1) throw new Error(`CRM record field "${label}" resolved ${String(count)} values; expected exactly one`);
  assertCurrent();
  const text = await locator.textContent();
  if (text === null) throw new Error(`CRM record field "${label}" rendered without text`);
  const value = text.trim();
  if (blank === "reject" && value.length === 0) throw new Error(`CRM record field "${label}" was blank`);
  assertCurrent();
  return value;
}


async function openAndReadCrmRecord(
  assertCurrent: () => void,
  page: Page,
  row: CrmOnboardingSearchRow,
): Promise<ExactCrmOnboardingRecord> {
  assertCurrent();
  await page.goto(row.recordUrl, {
    waitUntil: "domcontentloaded",
    timeout: NAVIGATION_TIMEOUT_MS,
  });
  assertCurrent();
  recordBrowserAction("opened", "crm.onboarding.record");
  assertCurrent();
  assertExactCrmLocation(page.url(), CRM_RECORD_PATH, row.recordId);
  assertCurrent();
  const observedEid = EidSchema.parse(await readRecordField(assertCurrent, page, "UCPath Employee ID", "reject"));
  assertCurrent();
  const firstDayOfService = await readRecordField(assertCurrent, page, "First Day of Service (Effective Date)", "allow");
  assertCurrent();
  const dateSigned = await readRecordField(assertCurrent, page, "Date Signed", "allow");
  if (firstDayOfService !== "") parseCrmDateOnly(firstDayOfService, "First Day of Service");
  if (dateSigned !== "") parseCrmDateOnly(dateSigned, "Date Signed");
  assertCurrent();
  const result = ExactRecordSchema.parse({
    ...row,
    observedEid,
    firstName: await readRecordField(assertCurrent, page, "Employee First Name", "reject"),
    lastName: await readRecordField(assertCurrent, page, "Employee Last Name", "reject"),
    firstDayOfService,
    department: await readRecordField(assertCurrent, page, "Department", "allow"),
    dateSigned,
  });
  assertCurrent();
  return result;
}

export function chooseExactCrmRecord(
  recordsInput: readonly ExactCrmOnboardingRecord[],
  expectedEidInput: string,
): ExactCrmRecordResolution {
  const expectedEid = EidSchema.parse(expectedEidInput);
  const records = recordsInput.map((record) => ExactRecordSchema.parse(record));
  const exact = records.filter(({ observedEid }) => observedEid === expectedEid);
  if (exact.length > 1) {
    throw new Error(`CRM lookup for EID ${directIdentifierDisplay(expectedEid)} resolved ${String(exact.length)} exact displayed-EID records`);
  }
  return ExactRecordResolutionSchema.parse(
    exact[0] === undefined ? { state: "absent" } : { state: "found", record: exact[0] },
  );
}

async function exactRecordsFromRows(
  assertCurrent: () => void,
  page: Page,
  rows: readonly CrmOnboardingSearchRow[],
  expectedEid: string,
): Promise<readonly ExactCrmOnboardingRecord[]> {
  const exact: ExactCrmOnboardingRecord[] = [];
  for (const row of rows) {
    assertCurrent();
    const record = await openAndReadCrmRecord(assertCurrent, page, row);
    if (record.observedEid === expectedEid) exact.push(record);
  }
  assertCurrent();
  return Object.freeze(exact);
}

function nameSearchQueries(name: string): readonly string[] {
  const queries: string[] = [];
  const seen = new Set<string>();
  const add = (value: string): void => {
    const normalized = value.trim().replace(/\s+/gu, " ");
    if (normalized.length < 2) return;
    const key = normalized.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    queries.push(normalized);
  };
  for (const part of name.split(",")) add(part);
  for (const token of name.split(/[^\p{L}]+/u)) add(token);
  return Object.freeze(queries);
}

function nameTokens(name: string): readonly string[] {
  return Object.freeze(name
    .toLocaleLowerCase("en-US")
    .split(/[^\p{L}]+/u)
    .filter((token) => token.length >= 2));
}

function plausibleNameRows(
  rows: readonly CrmOnboardingSearchRow[],
  name: string,
): readonly CrmOnboardingSearchRow[] {
  const tokens = nameTokens(name);
  if (tokens.length === 0) return Object.freeze([]);
  return Object.freeze(rows.filter((row) => {
    const candidate = row.fullName.toLocaleLowerCase("en-US");
    return tokens.every((token) => candidate.includes(token));
  }));
}

// CRM search is fuzzy; open every plausible record and prove its displayed EID exactly.
async function resolveExactCrmOnboardingRecord(
  assertCurrent: () => void,
  page: Page,
  input: Readonly<{ eid: string; name?: string }>,
): Promise<ExactCrmRecordResolution> {
  const expectedEid = EidSchema.parse(input.eid);
  assertCurrent();
  const eidRows = await searchCrmOnboardingRows(assertCurrent, page, expectedEid);
  assertCurrent();
  const byEid = chooseExactCrmRecord(
    await exactRecordsFromRows(assertCurrent, page, eidRows, expectedEid),
    expectedEid,
  );
  if (byEid.state === "found" || input.name === undefined) {
    assertCurrent();
    return byEid;
  }

  const fallbackRows = new Map<string, CrmOnboardingSearchRow>();
  for (const query of nameSearchQueries(input.name)) {
    assertCurrent();
    const rows = plausibleNameRows(await searchCrmOnboardingRows(assertCurrent, page, query), input.name);
    for (const row of rows) {
      const prior = fallbackRows.get(row.recordId);
      if (prior !== undefined &&
          (prior.recordUrl !== row.recordUrl || prior.fullName !== row.fullName || prior.rawStage !== row.rawStage)) {
        throw new Error(`CRM name fallback returned conflicting rows for record ${row.recordId}`);
      }
      fallbackRows.set(row.recordId, row);
    }
  }
  assertCurrent();
  const result = chooseExactCrmRecord(
    await exactRecordsFromRows(assertCurrent, page, [...fallbackRows.values()], expectedEid),
    expectedEid,
  );
  assertCurrent();
  return result;
}

export function parseCrmDateOnly(raw: string, field: string): z.infer<typeof DateOnlySchema> {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+\d{1,2}:\d{2}\s+(?:AM|PM))?$/u.exec(raw.trim());
  if (match === null) throw new Error(`CRM ${field} date "${raw}" is not M/D/YYYY with an optional time`);
  const month = Number(match[1]);
  const day = Number(match[2]);
  const year = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new Error(`CRM ${field} date "${raw}" is not a real calendar date`);
  }
  return DateOnlySchema.parse(
    `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
  );
}

function bindingForFound(expectedEid: string, record: ExactCrmOnboardingRecord) {
  return CrmSubjectBindingSchema.parse({
    state: "displayed-record",
    observationId: CRM_ONBOARDING_DISPLAYED_EID,
    expectedEid,
    observedEid: record.observedEid,
  });
}

function bindingForAbsent(expectedEid: string) {
  return CrmSubjectBindingSchema.parse({
    state: "absent-query",
    expectedEid,
    queriedEid: expectedEid,
  });
}

async function readOnboardingRecord(
  assertCurrent: () => void,
  page: Page,
  input: z.output<typeof CrmReadOnboardingRecord.input>,
): Promise<CrmOnboardingRecordRead> {
  assertCurrent();
  const resolution = await resolveExactCrmOnboardingRecord(assertCurrent, page, input);
  if (resolution.state === "absent") {
    assertCurrent();
    return CrmOnboardingRecordReadSchema.parse({
      binding: bindingForAbsent(input.eid),
      output: ReadOnboardingRecordOutputSchema.parse({
        state: "absent",
        queriedEid: input.eid,
        reason: `CRM has no onboarding record with exact displayed EID ${directIdentifierDisplay(input.eid)}`,
      }),
    });
  }
  const record = resolution.record;
  assertCurrent();
  recordBrowserAction("read", "crm.onboarding.record", JSON.stringify(record));
  assertCurrent();
  return CrmOnboardingRecordReadSchema.parse({
    binding: bindingForFound(input.eid, record),
    output: ReadOnboardingRecordOutputSchema.parse({
      state: "found",
      record: {
        recordId: record.recordId,
        emplId: record.observedEid,
        fullName: `${record.lastName}, ${record.firstName}`,
        rawStage: record.rawStage,
      },
    }),
  });
}

async function readOnboardingDates(
  assertCurrent: () => void,
  page: Page,
  input: z.output<typeof CrmReadOnboardingDates.input>,
): Promise<CrmOnboardingDatesRead> {
  if (input.name === undefined) {
    assertCurrent();
    return CrmOnboardingDatesReadSchema.parse({ binding: { state: "not-read", expectedEid: input.eid }, output: { emplId: input.eid, state: "no-confident-record", employmentDate: null, oathDate: null, reason: "No confident CRM record" } });
  }
  try {
    const records = new Map<string, ExactCrmOnboardingRecord>();
    for (const query of nameSearchQueries(input.name)) {
      assertCurrent();
      recordBrowserAction("typed", "crm.onboarding.date-search", query);
      assertCurrent();
      recordBrowserAction("clicked", "crm.onboarding.date-search");
      assertCurrent();
      const queryRows = await searchCrmOnboardingRows(assertCurrent, page, query);
      const rows = plausibleNameRows(queryRows, input.name);
      for (const row of rows) {
        assertCurrent();
        const record = await openAndReadCrmRecord(assertCurrent, page, row);
        if (record.observedEid === input.eid) records.set(record.recordId, record);
      }
      assertCurrent();
      const restoredRows = await searchCrmOnboardingRows(assertCurrent, page, query);
      if (JSON.stringify(restoredRows) !== JSON.stringify(queryRows)) throw new Error("CRM date results changed before capture");
      assertCurrent();
      recordBrowserAction("read", "crm.onboarding.restored-results", JSON.stringify(restoredRows));
      if (records.size > 0) break;
    }
    if (records.size !== 1) {
      assertCurrent();
      return CrmOnboardingDatesReadSchema.parse({
      binding: bindingForAbsent(input.eid), output: { emplId: input.eid, state: "no-confident-record", employmentDate: null, oathDate: null, reason: "No confident CRM record" },
    });
    }
    const selected = [...records.values()][0];
    if (selected === undefined) throw new Error("CRM date record disappeared");
    assertCurrent();
    const record = await openAndReadCrmRecord(assertCurrent, page, selected);
    if (record.observedEid !== input.eid || record.firstName !== selected.firstName || record.lastName !== selected.lastName) {
      throw new CrmRecordIdentityDriftError();
    }
    assertCurrent();
    recordBrowserAction("read", "crm.onboarding.dates", JSON.stringify({ employmentDate: record.firstDayOfService, oathDate: record.dateSigned }));
    assertCurrent();
    return CrmOnboardingDatesReadSchema.parse({ binding: bindingForFound(input.eid, record), output: {
      emplId: input.eid, state: "read",
      employmentDate: record.firstDayOfService === "" ? null : parseCrmDateOnly(record.firstDayOfService, "First Day of Service"),
      oathDate: record.dateSigned === "" ? null : parseCrmDateOnly(record.dateSigned, "Date Signed"), reason: "",
    } });
  } catch (error) {
    assertCurrent();
    if (error instanceof Error && error.name === "AbortError") throw error;
    const failure = new PersonLookupCrmDatesCheckError(error);
    assertCurrent();
    return CrmOnboardingDatesReadSchema.parse({ binding: bindingForAbsent(input.eid), output: {
      emplId: input.eid, state: "check-failed", code: failure.code, employmentDate: null, oathDate: null, reason: failure.message,
    } });
  }
}


export function createCrmOnboardingDriver(assertCurrent: () => void, page: Page): CrmOnboardingDriver {
  return Object.freeze(CrmOnboardingDriverSchema.parse({
    system: "crm",
    async searchOnboardingRecords(input: Readonly<{ name?: string; eid?: string }>) {
      const discovered = new Map<string, ExactCrmOnboardingRecord>();
      const names = input.name === undefined ? [] : nameSearchQueries(input.name);
      const queries = input.eid === undefined ? names : [input.eid, ...names];
      for (const query of queries) {
        assertCurrent();
        recordBrowserAction("typed", "crm.onboarding.search-criteria", query);
        assertCurrent();
        recordBrowserAction("clicked", "crm.onboarding.search");
        assertCurrent();
        const rows = await searchCrmOnboardingRows(assertCurrent, page, query);
        assertCurrent();
        recordBrowserAction("read", "crm.onboarding.record-count", String(rows.length));
        const plausible = query === input.eid ? rows : plausibleNameRows(rows, input.name === undefined ? "" : input.name);
        for (const row of plausible) {
          assertCurrent();
          const record = await openAndReadCrmRecord(assertCurrent, page, row);
          if (input.eid === undefined || record.observedEid === input.eid) discovered.set(record.recordId, record);
        }
        assertCurrent();
        const restoredRows = await searchCrmOnboardingRows(assertCurrent, page, query);
        if (JSON.stringify(restoredRows) !== JSON.stringify(rows)) throw new Error("CRM discovery results changed before capture");
        assertCurrent();
        recordBrowserAction("read", "crm.onboarding.restored-results", JSON.stringify(restoredRows));
        if (discovered.size > 0) break;
      }
      assertCurrent();
      return [...discovered.values()].map((record) => CrmDiscoveredRecordSchema.parse({
        recordId: record.recordId, recordUrl: record.recordUrl, emplId: record.observedEid,
        name: `${record.lastName}, ${record.firstName}`, department: record.department,
        firstDayOfService: record.firstDayOfService, dateSigned: record.dateSigned,
      }));
    },
    async verifyOnboardingRecord(input: CrmDiscoveredRecord) {
      assertCurrent();
      const record = await openAndReadCrmRecord(assertCurrent, page, { fullName: input.name, rawStage: "Verification", recordId: input.recordId, recordUrl: input.recordUrl });
      if (record.observedEid !== input.emplId || `${record.lastName}, ${record.firstName}` !== input.name) throw new CrmRecordIdentityDriftError();
      const current = CrmDiscoveredRecordSchema.parse({ ...input, department: record.department, firstDayOfService: record.firstDayOfService, dateSigned: record.dateSigned });
      assertCurrent();
      recordBrowserAction("read", "crm.onboarding.record", JSON.stringify(current));
      assertCurrent();
      return current;
    },
    async readOnboardingRecord(input: z.output<typeof CrmReadOnboardingRecord.input>) {
      const result = await readOnboardingRecord(assertCurrent, page, input);
      assertCurrent();
      return result;
    },
    async readOnboardingDates(input: z.output<typeof CrmReadOnboardingDates.input>) {
      const result = await readOnboardingDates(assertCurrent, page, input);
      assertCurrent();
      return result;
    },
  }));
}
