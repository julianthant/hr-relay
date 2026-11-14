import type { Locator, Page } from "playwright";
import { z } from "zod";
import { DateOnlySchema } from "../../../../rules/identity/ids.js";
import { CrmHireDataSchema, type CrmHireData, type CrmHireFields } from "../../../../models/systems/crm/read-hire-data.js";
import { CRM_UI_REGISTRY } from "./ui-registry.js";

const HOST = "act-crm.my.site.com";
const RECORD_PATH = "/hr/ONB_ViewOnboarding";
const SHEET_PATH = "/hr/ONB_PPSEntrySheet";
const BOUND_MS = 30_000;
const DEAD_STAGE = /rescinded|cancelled|canceled|withdrawn/iu;
const FIELD_LABELS = Object.freeze({
  positionNumber: "Position Number", firstName: "First Name", lastName: "Last Name", middleName: "Middle Name",
  ssn: "SSN (National ID)", address: "Address Line 1", addressLine2: "Address Line 2", city: "City", state: "State",
  postalCode: "Postal Code", wage: "Compensation rate", dob: "Date of Birth", phone: "Cell Phone Number",
  email: "Personal Email Address", appointment: "Type of Appointment (Employee Classification)", effectiveDate: "First Day of Service (Effective Date)",
  expectedJobEndDate: "Expected Job End Date (if applicable)",
} satisfies Record<keyof CrmHireFields, string>);
const FIELD_ANCHOR = Object.freeze({ label: "th, td", value: "xpath=following-sibling::*[1][self::td]" });

export const CrmHireSearchRowSchema = z.strictObject({
  recordId: z.string().min(1), recordUrl: z.url(), offerSentOn: z.string(), processStage: z.string().min(1),
});
type HireSearchRow = z.infer<typeof CrmHireSearchRowSchema>;
type RecordIdentity = Readonly<{
  firstName: string; lastName: string; personalEmail: string; workEmail: string; department: string; recruitmentNumber: string;
}>;

function assertLocation(page: Page, path: string, recordId?: string): void {
  const url = new URL(page.url());
  if (url.origin !== `https://${HOST}` || url.username !== "" || url.password !== "" || url.pathname !== path
    || recordId !== undefined && url.searchParams.get("id") !== recordId) {
    throw new Error("CRM hire extraction left the expected page or record");
  }
}

function recipe(id: string) {
  const element = CRM_UI_REGISTRY.elements.find(candidate => candidate.id === id);
  if (element === undefined) throw new Error(`Missing CRM selector recipe ${id}`);
  return element.locator;
}

async function text(assertCurrent: () => void, locator: Locator): Promise<string> {
  assertCurrent();
  if (await locator.count() !== 1) throw new Error("CRM hire extraction expected exactly one value");
  assertCurrent();
  const value = await locator.textContent({ timeout: BOUND_MS });
  assertCurrent();
  if (value === null) throw new Error("CRM hire field rendered without text");
  return value.trim();
}

async function field(assertCurrent: () => void, page: Page, label: string): Promise<string> {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const locator = page.locator(FIELD_ANCHOR.label).filter({ hasText: new RegExp(`^\\s*${escaped}\\s*:?\\s*$`, "iu") }).locator(FIELD_ANCHOR.value);
  assertCurrent();
  await locator.first().waitFor({ state: "visible", timeout: BOUND_MS });
  return text(assertCurrent, locator);
}

async function open(assertCurrent: () => void, page: Page, path: string, id: string): Promise<void> {
  const url = new URL(path, `https://${HOST}`);
  url.searchParams.set("id", id);
  assertCurrent();
  await page.goto(url.href, { waitUntil: "domcontentloaded", timeout: BOUND_MS });
  assertCurrent();
  assertLocation(page, path, id);
}

async function readIdentity(assertCurrent: () => void, page: Page, recordId: string): Promise<RecordIdentity> {
  await open(assertCurrent, page, RECORD_PATH, recordId);
  const firstName = await field(assertCurrent, page, "Employee First Name");
  const lastName = await field(assertCurrent, page, "Employee Last Name");
  if (firstName === "" || lastName === "") throw new Error("CRM hire record has no displayed name");
  return {
    firstName, lastName,
    personalEmail: await field(assertCurrent, page, "Personal Email Address"),
    workEmail: await field(assertCurrent, page, "UCSD Email Address"),
    department: await field(assertCurrent, page, "Department"),
    recruitmentNumber: await field(assertCurrent, page, "Recruitment Number"),
  };
}

function offerDate(raw: string): string {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})\s+(AM|PM))?$/iu.exec(raw);
  if (match === null) throw new Error("CRM offer date is not a supported calendar date");
  const date = DateOnlySchema.parse(`${String(match[3])}-${String(match[1]).padStart(2, "0")}-${String(match[2]).padStart(2, "0")}`);
  if (match[4] === undefined) return `${date}T00:00`;
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  if (hour < 1 || hour > 12 || minute > 59) throw new Error("CRM offer timestamp has an invalid time");
  const clockHour = hour % 12 + (match[6]?.toUpperCase() === "PM" ? 12 : 0);
  return `${date}T${String(clockHour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function chooseLatestHireRecord(rows: readonly HireSearchRow[]): HireSearchRow {
  const eligible = rows.map(row => CrmHireSearchRowSchema.parse(row)).filter(row => !DEAD_STAGE.test(row.processStage));
  const only = eligible[0];
  if (only === undefined) throw new Error("CRM has no active exact-email onboarding record");
  if (eligible.length === 1) return only;
  const dated = eligible.map(row => ({ row, date: offerDate(row.offerSentOn) }));
  dated.sort((a, b) => b.date.localeCompare(a.date));
  const latest = dated[0];
  if (latest === undefined || dated[1]?.date === latest.date) throw new Error("CRM latest offer is ambiguous");
  return latest.row;
}

async function search(assertCurrent: () => void, page: Page, email: string): Promise<HireSearchRow[]> {
  const url = new URL(`https://${HOST}/hr/ONB_SearchOnboardings`);
  url.searchParams.set("q", email);
  assertCurrent();
  await page.goto(url.href, { waitUntil: "domcontentloaded", timeout: BOUND_MS });
  assertCurrent();
  assertLocation(page, url.pathname);
  if (new URL(page.url()).searchParams.get("q") !== email) throw new Error("CRM rendered different search criteria");
  await page.getByRole("heading", { name: "Search Results", exact: true }).waitFor({ state: "visible", timeout: BOUND_MS });
  const rowsRecipe = recipe("crm.onboarding.search-result-rows");
  const cellsRecipe = recipe("crm.onboarding.search-result-row-cells");
  const linkRecipe = recipe("crm.onboarding.search-result-name-link");
  if (rowsRecipe.kind !== "css" || cellsRecipe.kind !== "row-cells" || linkRecipe.kind !== "row-name-link") {
    throw new Error("CRM search recipes changed shape");
  }
  const rows = page.locator(rowsRecipe.selector);
  const result: HireSearchRow[] = [];
  assertCurrent();
  const count = await rows.count();
  let auxiliaryCount = 0;
  for (let index = 0; index < count; index += 1) {
    const row = rows.nth(index);
    const cells = row.locator(cellsRecipe.selector);
    assertCurrent();
    const cellCount = await cells.count();
    if (cellCount === 2) {
      auxiliaryCount += 1;
      if (auxiliaryCount > 1) throw new Error("CRM search has more than one auxiliary row");
      continue;
    }
    if (cellCount !== 5) throw new Error("CRM search row has an unverified shape");
    const link = row.locator(linkRecipe.selector);
    if (await link.count() !== 1) throw new Error("CRM hire result has no unique record link");
    const href = await link.getAttribute("href");
    if (href === null) throw new Error("CRM hire result link has no target");
    const target = new URL(href, url.origin);
    const recordId = target.searchParams.get("id");
    if (target.origin !== `https://${HOST}` || target.username !== "" || target.password !== "" || target.pathname !== RECORD_PATH || !recordId) {
      throw new Error("CRM hire result link is not an onboarding record");
    }
    result.push(CrmHireSearchRowSchema.parse({
      recordId, recordUrl: target.href, offerSentOn: await text(assertCurrent, cells.nth(1)),
      processStage: await text(assertCurrent, cells.nth(4)),
    }));
  }
  const empty = page.getByRole("heading", { name: "No search results were found.", exact: true });
  if (result.length === 0) await empty.waitFor({ state: "visible", timeout: BOUND_MS });
  else if (await empty.count() !== 0) throw new Error("CRM rendered results and the empty state together");
  assertCurrent();
  return result;
}

export async function readCrmHireDataOnPage(assertCurrent: () => void, page: Page, email: string): Promise<CrmHireData> {
  const requestedEmail = z.email().parse(email);
  const exact: { row: HireSearchRow; identity: RecordIdentity }[] = [];
  for (const row of await search(assertCurrent, page, requestedEmail)) {
    if (DEAD_STAGE.test(row.processStage)) continue;
    const identity = await readIdentity(assertCurrent, page, row.recordId);
    if ([identity.personalEmail, identity.workEmail].some(value => value.toLowerCase() === requestedEmail.toLowerCase())) {
      exact.push({ row, identity });
    }
  }
  const selected = chooseLatestHireRecord(exact.map(value => value.row));
  const prior = exact.find(value => value.row.recordId === selected.recordId);
  if (prior === undefined) throw new Error("CRM selected hire record lost its identity evidence");
  const identity = await readIdentity(assertCurrent, page, selected.recordId);
  if (JSON.stringify(identity) !== JSON.stringify(prior.identity)) throw new Error("CRM hire record changed during selection");
  await open(assertCurrent, page, SHEET_PATH, selected.recordId);
  const entries: [string, string][] = [];
  for (const [key, label] of Object.entries(FIELD_LABELS)) entries.push([key, await field(assertCurrent, page, label)]);
  const result = CrmHireDataSchema.parse({
    recordId: selected.recordId, recordUrl: selected.recordUrl, requestedEmail,
    personalEmail: identity.personalEmail, workEmail: identity.workEmail,
    recordFirstName: identity.firstName, recordLastName: identity.lastName,
    department: identity.department, recruitmentNumber: identity.recruitmentNumber, fields: Object.fromEntries(entries),
  });
  assertCurrent();
  assertLocation(page, SHEET_PATH, selected.recordId);
  return result;
}

export { search as searchCrmOnboardingOfferRows };
