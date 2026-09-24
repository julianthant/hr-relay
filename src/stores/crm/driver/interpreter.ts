import type { Locator, Page } from "playwright";
import { recordBrowserAction } from "../../../infra/browser/action-notes.js";
import { z } from "zod";
import {
  CrmReadOnboardingDates,
  ReadOnboardingDatesOutputSchema,
} from "../../../domain/contracts/crm/read-onboarding-dates.js";
import {
  CrmReadOnboardingRecord,
  ReadOnboardingRecordOutputSchema,
} from "../../../domain/contracts/crm/read-onboarding-record.js";
import { DateOnlySchema, EidSchema } from "../../../domain/ids.js";
import { directIdentifierDigestReference } from "../../../domain/redaction.js";
import {
  CRM_ONBOARDING_DISPLAYED_EID,
  CrmOnboardingDatesReadSchema,
  CrmOnboardingDriverSchema,
  CrmOnboardingRecordReadSchema,
  CrmSubjectBindingSchema,
} from "../../../domain/ui/crm-onboarding.js";
import type {
  CrmOnboardingDatesRead,
  CrmOnboardingDriver,
  CrmOnboardingRecordRead,
} from "../../../domain/ui/crm-onboarding.js";
import { CRM_UI_REGISTRY } from "./ui-registry.js";

const CRM_HOST = "act-crm.my.site.com";
const CRM_SEARCH_PATH = "/hr/ONB_SearchOnboardings";
const CRM_RECORD_PATH = "/hr/ONB_ViewOnboarding";
const CRM_HISTORY_PATH = "/hr/ONB_ShowOnboardingHistory";
const NAVIGATION_TIMEOUT_MS = 30_000;
const STATE_TIMEOUT_MS = 30_000;
const EXPECTED_SEARCH_DATA_CELLS = 5;
const EXPECTED_HISTORY_DATA_CELLS = 5;
const HISTORY_FIELD = "ProcessStageText";
const OFFER_LETTER_SENT = "Offer Letter Sent";
const COMPLETED = "Completed";

const SearchRowSchema = z.strictObject({
  fullName: z.string().min(1),
  rawStage: z.string().min(1),
  recordId: z.string().min(1),
  recordUrl: z.url(),
});
export type CrmOnboardingSearchRow = z.infer<typeof SearchRowSchema>;

const ExactRecordSchema = SearchRowSchema.extend({
  observedEid: EidSchema,
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  firstDayOfService: z.string(),
});
export type ExactCrmOnboardingRecord = z.infer<typeof ExactRecordSchema>;

const ExactRecordResolutionSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("found"), record: ExactRecordSchema }),
  z.strictObject({ state: z.literal("absent") }),
]);
export type ExactCrmRecordResolution = z.infer<typeof ExactRecordResolutionSchema>;

const HistoryTransitionSchema = z.strictObject({
  changedOn: DateOnlySchema,
  field: z.string(),
  newValue: z.string(),
});
type HistoryTransition = z.infer<typeof HistoryTransitionSchema>;

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

function historyUrl(recordId: string): string {
  const url = new URL(`https://${CRM_HOST}${CRM_HISTORY_PATH}`);
  url.searchParams.set("id", recordId);
  return url.href;
}

async function waitForExactHeading(page: Page, name: string): Promise<Locator> {
  const heading = page.getByRole("heading", { name, exact: true });
  await heading.first().waitFor({ state: "visible", timeout: STATE_TIMEOUT_MS });
  const count = await heading.count();
  if (count !== 1) throw new Error(`CRM expected exactly one heading "${name}" but found ${String(count)}`);
  return heading;
}

async function waitForSearchReady(page: Page, query: string): Promise<void> {
  const url = assertExactCrmLocation(page.url(), CRM_SEARCH_PATH);
  if (url.searchParams.get("q") !== query) {
    throw new Error(`CRM search expected query ${query} but the rendered page used a different query`);
  }
  await waitForExactHeading(page, "Search Results");
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

async function readRequiredText(locator: Locator, field: string): Promise<string> {
  const text = await locator.textContent();
  if (text === null) throw new Error(`CRM ${field} rendered without text`);
  const value = text.trim();
  if (value.length === 0) throw new Error(`CRM ${field} was blank`);
  return value;
}

/**
 * Port of the pinned search-grid row semantics from legacy commit
 * 793abe1f8265f3213ffe8a80d6cfd9860a32a1dc:
 * `src/systems/crm/onboarding-records.ts` (blob 71e0195f358f7e27afbb5cb43f8e6e390c8918e8)
 * plus `src/systems/crm/selectors.ts` (blob e63530d375478dd330d07460c740f2027dbd7bdd).
 * The live 2026-08-02 page contains one verified two-cell auxiliary row around the exact five-cell
 * data rows. Any other row shape is an unexpected page state, not an empty-result fallback.
 */
export async function searchCrmOnboardingRows(
  page: Page,
  query: string,
): Promise<readonly CrmOnboardingSearchRow[]> {
  if (query.trim().length === 0) throw new Error("CRM onboarding search query cannot be blank");
  await page.goto(searchUrl(query), {
    waitUntil: "domcontentloaded",
    timeout: NAVIGATION_TIMEOUT_MS,
  });
  recordBrowserAction("opened", "crm.onboarding.search");
  await waitForSearchReady(page, query);

  const rows = searchRowsLocator(page);
  const rowCount = await rows.count();
  const results: CrmOnboardingSearchRow[] = [];
  let auxiliaryRows = 0;
  for (let index = 0; index < rowCount; index += 1) {
    const row = rows.nth(index);
    const cells = directRowCells(row);
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
    const linkCount = await link.count();
    if (linkCount !== 1) {
      throw new Error(`CRM search row ${String(index)} had ${String(linkCount)} record links; expected exactly one`);
    }
    const href = await link.getAttribute("href");
    if (href === null || href.trim().length === 0) {
      throw new Error(`CRM search row ${String(index)} record link had no href`);
    }
    const { recordId, recordUrl } = recordUrlFromHref(href);
    results.push(SearchRowSchema.parse({
      fullName: await readRequiredText(cells.nth(0), `search row ${String(index)} name`),
      rawStage: await readRequiredText(cells.nth(4), `search row ${String(index)} process stage`),
      recordId,
      recordUrl,
    }));
  }

  const emptyHeading = page.getByRole("heading", {
    name: "No search results were found.",
    exact: true,
  });
  if (results.length === 0) {
    await emptyHeading.first().waitFor({ state: "visible", timeout: STATE_TIMEOUT_MS });
    const emptyCount = await emptyHeading.count();
    if (emptyCount !== 1) {
      throw new Error(`CRM zero-result search expected one verified empty-state heading but found ${String(emptyCount)}`);
    }
  } else if (await emptyHeading.count() !== 0) {
    throw new Error("CRM search rendered data rows and the no-results state simultaneously");
  }
  return Object.freeze(results);
}

type RecordFieldLabel =
  | "Employee First Name"
  | "Employee Last Name"
  | "UCPath Employee ID"
  | "First Day of Service (Effective Date)";

function recordFieldLocator(page: Page, label: RecordFieldLabel): Locator {
  const recipe = elementRecipe("crm.onboarding.record-field-value");
  if (recipe.kind !== "label-following-cell") {
    throw new Error("CRM record-field recipe changed kind unexpectedly");
  }
  return page
    .locator(recipe.labelCell)
    .filter({ hasText: label })
    .locator(recipe.valueSelector);
}

async function readRecordField(
  page: Page,
  label: RecordFieldLabel,
  blank: "allow" | "reject",
): Promise<string> {
  const locator = recordFieldLocator(page, label);
  await locator.first().waitFor({ state: "visible", timeout: STATE_TIMEOUT_MS });
  const count = await locator.count();
  if (count !== 1) throw new Error(`CRM record field "${label}" resolved ${String(count)} values; expected exactly one`);
  const text = await locator.textContent();
  if (text === null) throw new Error(`CRM record field "${label}" rendered without text`);
  const value = text.trim();
  if (blank === "reject" && value.length === 0) throw new Error(`CRM record field "${label}" was blank`);
  return value;
}

/**
 * Port of legacy CRM field extraction with the only live-proven strategy retained:
 * `record.thLabelFollowingTd()` from `src/systems/crm/selectors.ts` at commit 793abe1f..., blob
 * e63530d375478dd330d07460c740f2027dbd7bdd. The broader legacy fallbacks are intentionally absent;
 * selector loss throws instead of turning an extraction failure into a blank field.
 */
async function openAndReadCrmRecord(
  page: Page,
  row: CrmOnboardingSearchRow,
): Promise<ExactCrmOnboardingRecord> {
  await page.goto(row.recordUrl, {
    waitUntil: "domcontentloaded",
    timeout: NAVIGATION_TIMEOUT_MS,
  });
  recordBrowserAction("opened", "crm.onboarding.record");
  assertExactCrmLocation(page.url(), CRM_RECORD_PATH, row.recordId);
  const observedEid = EidSchema.parse(await readRecordField(page, "UCPath Employee ID", "reject"));
  return ExactRecordSchema.parse({
    ...row,
    observedEid,
    firstName: await readRecordField(page, "Employee First Name", "reject"),
    lastName: await readRecordField(page, "Employee Last Name", "reject"),
    firstDayOfService: await readRecordField(page, "First Day of Service (Effective Date)", "allow"),
  });
}

export function chooseExactCrmRecord(
  recordsInput: readonly ExactCrmOnboardingRecord[],
  expectedEidInput: string,
): ExactCrmRecordResolution {
  const expectedEid = EidSchema.parse(expectedEidInput);
  const records = recordsInput.map((record) => ExactRecordSchema.parse(record));
  const exact = records.filter(({ observedEid }) => observedEid === expectedEid);
  if (exact.length > 1) {
    throw new Error(`CRM lookup for EID ${directIdentifierDigestReference(expectedEid)} resolved ${String(exact.length)} exact displayed-EID records`);
  }
  return ExactRecordResolutionSchema.parse(
    exact[0] === undefined ? { state: "absent" } : { state: "found", record: exact[0] },
  );
}

async function exactRecordsFromRows(
  page: Page,
  rows: readonly CrmOnboardingSearchRow[],
  expectedEid: string,
): Promise<readonly ExactCrmOnboardingRecord[]> {
  const exact: ExactCrmOnboardingRecord[] = [];
  for (const row of rows) {
    const record = await openAndReadCrmRecord(page, row);
    if (record.observedEid === expectedEid) exact.push(record);
  }
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

/**
 * Shared resolver for both Person Lookup CRM reads. The fuzzy `?q=` search is never identity proof:
 * every plausible record is opened and its displayed UCPath Employee ID must equal the request.
 */
export async function resolveExactCrmOnboardingRecord(
  page: Page,
  input: Readonly<{ eid: string; name?: string }>,
): Promise<ExactCrmRecordResolution> {
  const expectedEid = EidSchema.parse(input.eid);
  const eidRows = await searchCrmOnboardingRows(page, expectedEid);
  const byEid = chooseExactCrmRecord(
    await exactRecordsFromRows(page, eidRows, expectedEid),
    expectedEid,
  );
  if (byEid.state === "found" || input.name === undefined) return byEid;

  const fallbackRows = new Map<string, CrmOnboardingSearchRow>();
  for (const query of nameSearchQueries(input.name)) {
    const rows = plausibleNameRows(await searchCrmOnboardingRows(page, query), input.name);
    for (const row of rows) {
      const prior = fallbackRows.get(row.recordId);
      if (prior !== undefined &&
          (prior.recordUrl !== row.recordUrl || prior.fullName !== row.fullName || prior.rawStage !== row.rawStage)) {
        throw new Error(`CRM name fallback returned conflicting rows for record ${row.recordId}`);
      }
      fallbackRows.set(row.recordId, row);
    }
  }
  return chooseExactCrmRecord(
    await exactRecordsFromRows(page, [...fallbackRows.values()], expectedEid),
    expectedEid,
  );
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

function historyRowsLocator(page: Page): Locator {
  const recipe = elementRecipe("crm.onboarding.history-rows");
  if (recipe.kind !== "css") throw new Error("CRM history-row recipe changed kind unexpectedly");
  return page.locator(recipe.selector);
}

async function readHistoryTransitions(
  page: Page,
  record: ExactCrmOnboardingRecord,
): Promise<readonly HistoryTransition[]> {
  await page.goto(historyUrl(record.recordId), {
    waitUntil: "domcontentloaded",
    timeout: NAVIGATION_TIMEOUT_MS,
  });
  recordBrowserAction("opened", "crm.onboarding.history");
  assertExactCrmLocation(page.url(), CRM_HISTORY_PATH, record.recordId);
  const rows = historyRowsLocator(page);
  await rows.first().waitFor({ state: "visible", timeout: STATE_TIMEOUT_MS });
  const rowCount = await rows.count();
  let headerRows = 0;
  let auxiliaryRows = 0;
  const transitions: HistoryTransition[] = [];
  for (let index = 0; index < rowCount; index += 1) {
    const row = rows.nth(index);
    const headers = row.locator(":scope > th");
    const headerCount = await headers.count();
    if (headerCount === EXPECTED_HISTORY_DATA_CELLS) {
      headerRows += 1;
      const expected = ["Date", "Created By", "Field", "Old Value", "New Value"];
      for (let cellIndex = 0; cellIndex < expected.length; cellIndex += 1) {
        const text = await readRequiredText(headers.nth(cellIndex), `history header ${String(cellIndex)}`);
        if (text !== expected[cellIndex]) throw new Error(`CRM history header ${String(cellIndex)} was "${text}"`);
      }
      continue;
    }
    if (headerCount !== 0) {
      throw new Error(`CRM history row ${String(index)} had ${String(headerCount)} header cells; expected zero or five`);
    }
    const cells = row.locator(":scope > td");
    const cellCount = await cells.count();
    if (cellCount === 1) {
      auxiliaryRows += 1;
      if (auxiliaryRows > 1) throw new Error("CRM history rendered more than one auxiliary one-cell row");
      continue;
    }
    if (cellCount !== EXPECTED_HISTORY_DATA_CELLS) {
      throw new Error(
        `CRM history row ${String(index)} had ${String(cellCount)} direct cells; expected exactly ${String(EXPECTED_HISTORY_DATA_CELLS)}`,
      );
    }
    const fieldText = await cells.nth(2).textContent();
    const newValueText = await cells.nth(4).textContent();
    if (fieldText === null || newValueText === null) {
      throw new Error(`CRM history row ${String(index)} rendered without field/new-value text`);
    }
    transitions.push(HistoryTransitionSchema.parse({
      changedOn: parseCrmDateOnly(
        await readRequiredText(cells.nth(0), `history row ${String(index)} date`),
        "history transition",
      ),
      field: fieldText.trim(),
      newValue: newValueText.trim(),
    }));
  }
  if (headerRows !== 1) throw new Error(`CRM history expected exactly one five-cell header row but found ${String(headerRows)}`);
  return Object.freeze(transitions);
}

function transitionDate(
  transitions: readonly HistoryTransition[],
  newValue: typeof OFFER_LETTER_SENT | typeof COMPLETED,
) {
  const matches = transitions.filter((transition) =>
    transition.field === HISTORY_FIELD && transition.newValue === newValue);
  if (matches.length > 1) {
    throw new Error(`CRM history contained ${String(matches.length)} ${newValue} ProcessStageText transitions`);
  }
  return matches[0]?.changedOn;
}

function absentDate(reason: string) {
  return { state: "absent" as const, reason };
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
  page: Page,
  input: z.output<typeof CrmReadOnboardingRecord.input>,
): Promise<CrmOnboardingRecordRead> {
  const resolution = await resolveExactCrmOnboardingRecord(page, input);
  if (resolution.state === "absent") {
    return CrmOnboardingRecordReadSchema.parse({
      binding: bindingForAbsent(input.eid),
      output: ReadOnboardingRecordOutputSchema.parse({
        state: "absent",
        queriedEid: input.eid,
        reason: `CRM has no onboarding record with exact displayed EID ${directIdentifierDigestReference(input.eid)}`,
      }),
    });
  }
  const record = resolution.record;
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
  page: Page,
  input: z.output<typeof CrmReadOnboardingDates.input>,
): Promise<CrmOnboardingDatesRead> {
  const resolution = await resolveExactCrmOnboardingRecord(page, input);
  if (resolution.state === "absent") {
    const reason = `CRM has no onboarding record with exact displayed EID ${directIdentifierDigestReference(input.eid)}`;
    return CrmOnboardingDatesReadSchema.parse({
      binding: bindingForAbsent(input.eid),
      output: ReadOnboardingDatesOutputSchema.parse({
        emplId: input.eid,
        invitedOn: absentDate(reason),
        startsOn: absentDate(reason),
        completedOn: absentDate(reason),
      }),
    });
  }
  const record = resolution.record;
  const transitions = await readHistoryTransitions(page, record);
  const invitedOn = transitionDate(transitions, OFFER_LETTER_SENT);
  const completedOn = transitionDate(transitions, COMPLETED);
  return CrmOnboardingDatesReadSchema.parse({
    binding: bindingForFound(input.eid, record),
    output: ReadOnboardingDatesOutputSchema.parse({
      emplId: record.observedEid,
      invitedOn: invitedOn === undefined
        ? absentDate("CRM history has no Offer Letter Sent transition")
        : { state: "present", value: invitedOn },
      startsOn: record.firstDayOfService.length === 0
        ? absentDate("CRM onboarding record First Day of Service is blank")
        : { state: "present", value: parseCrmDateOnly(record.firstDayOfService, "First Day of Service") },
      completedOn: completedOn === undefined
        ? absentDate("CRM history has no Completed transition")
        : { state: "present", value: completedOn },
    }),
  });
}

/**
 * Actual selector-backed CRM driver. Legacy provenance:
 * - onboarding-records.ts blob 71e0195f358f7e27afbb5cb43f8e6e390c8918e8
 * - crm-search.ts blob 2ef1508b05c77a56ebd0b134e9fbcb6204ca3265
 * - extract.ts blob 46028e7ad1c40adc6d3d367c2fd727bc30a8f872
 * - history.ts blob 20b97bdfe25f01fc2569afdf4e9d2ecb33057ba7
 * at legacy commit 793abe1f8265f3213ffe8a80d6cfd9860a32a1dc.
 */
export function createCrmOnboardingDriver(page: Page): CrmOnboardingDriver {
  return Object.freeze(CrmOnboardingDriverSchema.parse({
    system: "crm",
    async readOnboardingRecord(input: z.output<typeof CrmReadOnboardingRecord.input>) {
      return readOnboardingRecord(page, input);
    },
    async readOnboardingDates(input: z.output<typeof CrmReadOnboardingDates.input>) {
      return readOnboardingDates(page, input);
    },
  }));
}
