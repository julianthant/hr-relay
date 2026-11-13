import type { Page } from "playwright";
import { I9LookupError, I9LookupInputSchema, I9RecordIdsSchema, I9SignerOutputSchema } from "../../../../models/systems/i9/read-section2-signer.js";
import { I9SearchCriteriaSchema, I9SearchOutputSchema, I9SearchRowSchema, type I9Driver, type I9SearchRow } from "../../../../models/ui/i9.js";
import { recordBrowserAction } from "../../browser-shared/action-notes.js";
import { I9_APP_ORIGIN, I9_UI_REGISTRY as ui } from "./ui-registry.js";
import { createI9CreationOperations } from "./creation-operation.js";
import { systemClock } from "../../../../rules/time/clock.js";
import type { Clock } from "../../../../rules/time/clock.js";

const CONTROL_MS = 10_000;
const NAVIGATION_MS = 20_000;
const normalize = (value: string): string => value.trim().replace(/\s+/gu, " ").toLocaleLowerCase("en-US");

export function createI9Driver(assertCurrent: () => void, page: Page, clock: Clock = systemClock): I9Driver {
  const current = async <T>(operation: () => Promise<T>): Promise<T> => {
    assertCurrent();
    try {
      return await operation();
    } finally {
      assertCurrent();
    }
  };
  const requireApp = (): URL => {
    assertCurrent();
    const url = new URL(page.url());
    if (url.origin !== I9_APP_ORIGIN || /login|training/iu.test(url.pathname)) throw new I9LookupError();
    return url;
  };

  const driver: I9Driver = {
    ...createI9CreationOperations(assertCurrent, page, clock, {
      searchEmployees: input => driver.searchEmployees(input), readRecordSummary: input => driver.readRecordSummary(input),
    }),
    system: "i9",
    async searchEmployees(input) {
      const criteria = I9SearchCriteriaSchema.parse(input);
      requireApp();
      await current(() => page.goto(I9_APP_ORIGIN, { waitUntil: "domcontentloaded", timeout: NAVIGATION_MS }));
      requireApp();
      await current(() => ui.searchOptions(page).click({ timeout: CONTROL_MS }));
      recordBrowserAction("clicked", "i9.search.options");
      const dialog = ui.dialog(page);
      await current(() => dialog.waitFor({ state: "visible", timeout: CONTROL_MS }));
      await current(() => ui.clear(page).click({ timeout: CONTROL_MS }));
      const rows = ui.resultRows(dialog);
      const empty = ui.noResults(dialog);
      await current(() => rows.first().waitFor({ state: "hidden", timeout: CONTROL_MS }));
      await current(() => empty.waitFor({ state: "hidden", timeout: CONTROL_MS }));
      for (const key of ["lastName", "firstName", "ssn", "profileId", "employeeId"] as const) {
        const value = criteria[key];
        if (value === undefined) continue;
        const formatted = key === "ssn" ? `${value.slice(0, 3)}-${value.slice(3, 5)}-${value.slice(5)}` : value;
        await current(() => ui[key](dialog).fill(formatted, { timeout: CONTROL_MS }));
        recordBrowserAction("typed", `i9.search.${key}`);
      }
      await current(() => ui.submitSearch(page).click({ timeout: CONTROL_MS }));
      recordBrowserAction("clicked", "i9.search.submit");
      await current(() => rows.first().or(empty).first().waitFor({ state: "visible", timeout: CONTROL_MS }));
      requireApp();
      const restricted = await current(() => ui.restricted(dialog).count()) > 0;
      const count = await current(() => rows.count());
      if (count === 0 && !await current(() => empty.isVisible())) throw new I9LookupError();
      const parsed: I9SearchRow[] = [];
      for (let index = 0; index < count; index++) {
        const cells = (await current(() => ui.rowCells(rows.nth(index)).allTextContents())).map(value => value.trim());
        if (cells.length !== 9) throw new I9LookupError();
        parsed.push(I9SearchRowSchema.parse({
          lastName: cells[0], firstName: cells[1], employer: cells[2], worksite: cells[3],
          profileId: cells[4], i9Id: cells[5], nextAction: cells[6], startDate: cells[7], createdOn: cells[8],
        }));
      }
      recordBrowserAction("read", "i9.search.results");
      return I9SearchOutputSchema.parse({ rows: parsed, restricted });
    },
    async readRecordSummary(input) {
      const record = I9RecordIdsSchema.parse(input);
      requireApp();
      await current(() => page.goto(`${I9_APP_ORIGIN}/form-I9/summary/${record.profileId}/${record.i9Id}`, {
        waitUntil: "domcontentloaded", timeout: NAVIGATION_MS,
      }));
      const url = requireApp();
      const historical = url.pathname === `/form-I9-historical/${record.profileId}/${record.i9Id}/0`;
      if (!historical && url.pathname !== `/form-I9/summary/${record.profileId}/${record.i9Id}`) throw new I9LookupError();
      const assertRecordRoute = (): void => {
        if (requireApp().pathname !== url.pathname) throw new I9LookupError();
      };
      await current(() => ui.summaryHeading(page).waitFor({ state: "visible", timeout: CONTROL_MS }));
      assertRecordRoute();
      recordBrowserAction("opened", "i9.record.summary");
      if (historical) return { i9Status: "historical", signerName: "", ...record };
      await current(() => ui.auditHeader(page).waitFor({ state: "visible", timeout: CONTROL_MS }));
      const row = ui.signedRow(page);
      const signedCount = await current(() => row.count());
      assertRecordRoute();
      if (signedCount === 0) return { i9Status: "unsigned", signerName: "", ...record };
      const cells = await current(() => ui.auditCells(row).allTextContents());
      assertRecordRoute();
      const event = cells.at(-2);
      if (cells.length < 4 || event === undefined || normalize(event) !== "signed section 2") throw new I9LookupError();
      const signerName = cells.at(-1)?.trim();
      recordBrowserAction("read", "i9.record.section2-signer");
      return I9SignerOutputSchema.parse({ i9Status: "signed", signerName, ...record });
    },
    async readSection2Signer(input) {
      const criteria = I9LookupInputSchema.parse(input);
      const search = await driver.searchEmployees(criteria);
      if (search.rows.length === 0) return { i9Status: search.restricted ? "unable-to-access" : "not-found", signerName: "" };
      const matches = search.rows.filter(row => normalize(row.lastName) === normalize(criteria.lastName) && normalize(row.firstName) === normalize(criteria.firstName));
      if (matches.length !== search.rows.length || new Set(matches.map(row => row.profileId)).size !== 1) throw new I9LookupError("I9_LOOKUP_AMBIGUOUS");
      const hit = matches.find(row => !/^complete\s+section\s+[12]$/iu.test(row.nextAction.trim()));
      if (hit === undefined) return { i9Status: "unsigned", signerName: "" };
      if (hit.i9Id === "") throw new I9LookupError();
      return driver.readRecordSummary({ profileId: hit.profileId, i9Id: hit.i9Id });
    },
  };
  return Object.freeze(driver);
}
