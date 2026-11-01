import type { Page } from "playwright";
import type { z } from "zod";
import { SearchPersonMatch, SearchPersonMatchOutputSchema, UcpathMatchHitSchema } from "../../../../models/systems/ucpath/search-person-match.js";
import type { SearchPersonOrgOutput } from "../../../../models/systems/ucpath/search-person-org.js";
import { recordBrowserAction } from "../../browser-shared/action-notes.js";
import { UCPATH_PENDING_READ_RECIPES as recipes } from "./ui-registry.js";
import { searchPersonOrgOnPage } from "./person-org-operation.js";

type MatchInput = z.output<typeof SearchPersonMatch.input>;
type MatchHit = z.output<typeof UcpathMatchHitSchema>;
export interface PersonMatchPort {
  search(input: MatchInput): Promise<readonly MatchHit[]>;
  confirm(emplId: MatchHit["emplId"]): Promise<SearchPersonOrgOutput>;
}
const normalizedName = (name: string): string => name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
export async function searchPersonMatchWithPort(assertCurrent: () => void, port: PersonMatchPort, input: MatchInput) {
  assertCurrent();
  const hits = (await port.search(input)).map((hit) => UcpathMatchHitSchema.parse(hit));
  const dropped: z.output<typeof SearchPersonMatchOutputSchema>["dropped"] = [];
  const confirmed = new Map<string, MatchHit>();
  const sameSurname = hits.filter((hit) => {
    if (normalizedName(hit.name.split(",")[0] ?? "") === normalizedName(input.lastName)) return true;
    dropped.push({ ...hit, reason: "Last name does not match" });
    return false;
  });
  assertCurrent();
  recordBrowserAction("read", "ucpath.match.last-name-check", JSON.stringify(dropped));
  for (const hit of sameSurname) {
    assertCurrent();
    const org = await port.confirm(hit.emplId);
    const person = org.selection.selected;
    if (person === null || person.emplId !== hit.emplId || normalizedName(person.name) !== normalizedName(hit.name)) {
      dropped.push({ ...hit, reason: person === null ? "No Person Org record" : "Person Org name does not match" }); continue;
    }
    confirmed.set(hit.emplId, hit);
  }
  if (sameSurname.length > 0) {
    assertCurrent();
    const restored = await port.search(input);
    const identities = (values: readonly MatchHit[]) => [...new Set(values.map((hit) => JSON.stringify([hit.emplId, normalizedName(hit.name)])))].sort();
    if (JSON.stringify(identities(restored)) !== JSON.stringify(identities(hits))) throw new Error("UCPath Match results changed during Person Org confirmation");
  }
  const output = SearchPersonMatchOutputSchema.parse({ hits, confirmed: [...confirmed.values()], dropped });
  assertCurrent();
  recordBrowserAction("read", "ucpath.match.result", JSON.stringify(output));
  assertCurrent();
  return output;
}

export function parsePersonMatchRows(rows: readonly Readonly<{ emplId: string; firstName: string; lastName: string; rowIndex: string }>[]): readonly MatchHit[] {
  if (rows.length === 0) throw new Error("UCPath Match results rendered without a readable person");
  const indexes = rows.map((row) => Number(row.rowIndex)).sort((left, right) => left - right);
  if (indexes.some((index, position) => index !== position)) throw new Error("UCPath Match result set is incomplete or duplicated");
  return rows.map((row) => {
    if (!row.firstName.trim() || !row.lastName.trim()) throw new Error("UCPath Match result has missing identity controls");
    return UcpathMatchHitSchema.parse({ emplId: row.emplId, name: `${row.lastName.trim()}, ${row.firstName.trim()}` });
  });
}

export function assertPersonMatchNoResultsDialog(message: string): void {
  if (!/no matching person/iu.test(message)) throw new Error("UCPath Match returned an unrecognized search dialog");
}

const SMART_HR_URL = "https://ucphrprdpub.universityofcalifornia.edu/psc/ucphrprd/EMPLOYEE/HRMS/c/NUI_FRAMEWORK.PT_AGSTARTPAGE_NUI.GBL?CONTEXTIDPARAMS=TEMPLATE_ID%3aPTPPNAVCOL&scname=ADMN_UC_ADMIN_LOC_HIRE_NAVCOLL&PanelCollapsible=Y&PTPPB_GROUPLET_ID=UC_HIRE_TASKS_TILE_FL&CRefName=UC_HIRE_TASKS_TILE_FL&AJAXTRANSFER=Y";
export async function searchPersonMatchOnPage(assertCurrent: () => void, page: Page, input: MatchInput) {
  const port: PersonMatchPort = {
    confirm: async (emplId) => {
      assertCurrent();
      recordBrowserAction("opened", "ucpath.match.person-org-confirmation", emplId);
      assertCurrent();
      const person = await searchPersonOrgOnPage(assertCurrent, page, { kind: "by-eid", emplId });
      assertCurrent();
      recordBrowserAction("read", "ucpath.match.confirmed-name", person.selection.selected?.name ?? "No Person Org record");
      assertCurrent();
      return person;
    },
    search: async (criteria) => {
      assertCurrent();
      await page.goto(SMART_HR_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
      assertCurrent();
      recordBrowserAction("opened", "ucpath.match.search");
      const frame = page.frameLocator(recipes.frame);
      assertCurrent();
      await frame.locator(recipes.searchType).selectOption("P");
      assertCurrent();
      await frame.locator(recipes.parameter).fill("PERSON_SEARCH");
      assertCurrent();
      await frame.locator(recipes.load).click();
      assertCurrent();
      await frame.locator(recipes.resultCode).fill("PERSON_RESULTS");
      assertCurrent();
      await frame.locator(recipes.firstName).fill(criteria.firstName);
      assertCurrent();
      await frame.locator(recipes.lastName).fill(criteria.lastName);
      assertCurrent();
      await frame.locator(recipes.dob).fill(criteria.dob ?? "");
      assertCurrent();
      await frame.locator(recipes.ssn).fill(criteria.ssn ?? "");
      assertCurrent();
      recordBrowserAction("typed", "ucpath.match.criteria", `${criteria.lastName}, ${criteria.firstName}; DOB ${criteria.dob ?? "not supplied"}; SSN ${criteria.ssn === undefined ? "not supplied" : "masked"}`);
      assertCurrent();
      await frame.locator(recipes.prompt).click();
      const prompt = page.locator(recipes.dialog);
      assertCurrent();
      await prompt.waitFor({ state: "visible", timeout: 15000 });
      assertCurrent();
      await prompt.click();
      assertCurrent();
      await page.locator(recipes.mask).waitFor({ state: "hidden", timeout: 15000 });
      assertCurrent();
      await frame.locator(recipes.search).click();
      assertCurrent();
      recordBrowserAction("clicked", "ucpath.match.search");
      const results = frame.locator(recipes.results);
      const miss = page.locator(recipes.dialog);
      assertCurrent();
      await Promise.any([results.first().waitFor({ state: "visible", timeout: 15000 }), miss.waitFor({ state: "visible", timeout: 15000 })]);
      assertCurrent();
      if (await miss.isVisible()) {
        assertCurrent();
        if (await results.first().isVisible()) throw new Error("UCPath Match has both results and no-person dialog");
        assertCurrent();
        const message = await miss.evaluate((button, selector) => {
          const containers = button.ownerDocument.querySelectorAll(selector);
          return Array.from(containers).map((container) => (container as HTMLElement).innerText).filter(Boolean).join(" ");
        }, recipes.dialogMessage);
        assertPersonMatchNoResultsDialog(message);
        assertCurrent();
        await miss.click();
        assertCurrent();
        recordBrowserAction("read", "ucpath.match.results", "No matches");
        assertCurrent();
        return [];
      }
      assertCurrent();
      const hits = await results.evaluateAll((elements) => elements.map((element) => ({
        rowIndex: element.id.split("$")[1] ?? "",
        emplId: element.textContent?.trim() ?? "",
        firstName: element.ownerDocument.getElementById(`HTML2$${element.id.split("$")[1]}`)?.textContent?.trim() ?? "",
        lastName: element.ownerDocument.getElementById(`HTML4$${element.id.split("$")[1]}`)?.textContent?.trim() ?? "",
      })));
      assertCurrent();
      const pagination = await results.first().evaluate((element, selector) => {
        const table = element.closest("table");
        if (table === null) throw new Error("UCPath Match result has no owning table");
        return { text: table.textContent ?? "", next: table.querySelectorAll(selector).length };
      }, recipes.nextResult);
      const displayedTotal = pagination.text.match(/\bof\s+(\d+)\b/iu)?.[1];
      if (pagination.next > 0 || displayedTotal !== undefined && Number(displayedTotal) !== hits.length) throw new Error("UCPath Match result grid is partial or paginated");
      const parsed = parsePersonMatchRows(hits);
      assertCurrent();
      recordBrowserAction("read", "ucpath.match.results", JSON.stringify(parsed));
      assertCurrent();
      return parsed;
    },
  };
  assertCurrent();
  const output = await searchPersonMatchWithPort(assertCurrent, port, input);

  assertCurrent();
  return output;
}
