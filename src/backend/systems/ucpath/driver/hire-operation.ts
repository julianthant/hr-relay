import type { Locator, Page } from "playwright";
import type { Clock } from "../../../../rules/time/clock.js";
import { EidSchema } from "../../../../rules/identity/ids.js";
import { UcpathHireIdentitySchema, UcpathHireTargetSchema, UcpathHireFindingSchema, UcpathHireScanSchema,
  UcpathHireStagingSchema, UCPATH_HIRE_STAGED,
  ucpathHireSearchDigest, type UcpathHireTarget, type UcpathHireDriver, type UcpathHireScan } from "../../../../models/ui/ucpath-hire.js";
import { containsDryRunSample } from "../../../../models/workflow/dry-run.js";
import { assertMintedMutationCapability } from "../../../../workflow-kit/mutation-capability.js";
import { recordBrowserAction } from "../../browser-shared/action-notes.js";
import { textOf } from "./transaction-findings-operation.js";
import { UCPATH_HIRE_UI as ui } from "./hire-ui-registry.js";
import { hireProofForTarget, ucpathHireVerdict } from "../../../../rules/ucpath/hire-verdict.js";

const BOUND_MS = 30_000;
const normalize = (value: string) => value.trim().replace(/\s+/gu, " ").toLowerCase();
const usDate = (iso: string) => `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}`;
export function createUcpathHireOperations(assertCurrent: () => void, page: Page, clock: Clock): UcpathHireDriver {
  let staged: UcpathHireTarget | undefined;
  const requireApp = (surface: "wizard" | "search") => {
    assertCurrent();
    const url = new URL(page.url()), expected = new URL(surface === "wizard" ? ui.wizardUrl : ui.searchUrl);
    if (url.origin !== expected.origin || url.pathname !== expected.pathname) throw new Error("ucpath-hire-route-refused");
  };
  const visible = async (locator: Locator) => {
    assertCurrent();
    await locator.waitFor({ state: "visible", timeout: BOUND_MS });
    if (await locator.count() !== 1) throw new Error("ucpath-hire-control-ambiguous");
    const text = await textOf(assertCurrent, locator); assertCurrent(); return text;
  };
  const step = async (operation: () => Promise<unknown>, capture: () => Promise<void>) => {
    assertCurrent(); await operation(); assertCurrent(); await capture(); assertCurrent();
  };
  const fill = async (locator: () => Locator, value: string, capture: () => Promise<void>, compare = (actual: string) => actual.trim() === value) => {
    await step(() => locator().fill(value, { timeout: BOUND_MS }), capture);
    await step(() => locator().press("Tab", { timeout: BOUND_MS }), capture);
    if (!compare(await locator().inputValue({ timeout: BOUND_MS }))) throw new Error("ucpath-hire-field-readback-mismatch");
  };
  const personalIdentity = async (target: UcpathHireTarget) => {
    for (const key of ["firstName", "lastName", "middleName"] as const) {
      if (normalize(await ui.field(page, key).inputValue()) !== normalize(target.employee[key])) throw new Error("ucpath-hire-person-mismatch");
    }
    if (target.mode === "new-hire" && (await ui.field(page, "dob").inputValue() !== usDate(target.employee.dob)
      || await ui.email(page).inputValue() !== target.employee.email || await ui.field(page, "profileId").inputValue() !== target.profileId)) {
      throw new Error("ucpath-hire-personal-data-changed");
    }
    const observed = await visible(ui.resolvedName(page));
    if (normalize(observed) !== normalize(target.expectedName)) throw new Error("ucpath-hire-resolved-person-mismatch");
    return observed;
  };
  const readDetail = async (expectedId?: string) => {
    requireApp("search");
    const transactionId = await visible(ui.transactionId(page));
    if (expectedId !== undefined && transactionId !== expectedId) throw new Error("ucpath-hire-detail-transaction-mismatch");
    const routing = await visible(ui.routing(page));
    const parsed = /^Transaction:\s*(T\d{6,})\s*,\s*ID:\s*([^,]+)\s*,\s*Effdt:\s*(\d{4})-(\d{2})-(\d{2})\s*,/u.exec(routing);
    if (parsed === null || parsed[1] !== transactionId) throw new Error("ucpath-hire-routing-unverified");
    const rawEid = parsed[2]?.trim();
    const emplId = rawEid === "NEW" || rawEid === "PENDING" ? null : EidSchema.parse(rawEid);
    const effectiveDate = `${parsed[4]}/${parsed[5]}/${parsed[3]}`;
    const startDate = await visible(ui.detailStartDate(page));
    if (startDate !== effectiveDate) throw new Error("ucpath-hire-detail-date-mismatch");
    const row = UcpathHireFindingSchema.parse({ transactionId, approvalStatus: await visible(ui.status(page)), action: await visible(ui.detailAction(page)),
      displayedName: await visible(ui.detailName(page)), emplId, effectiveDate,
      profileId: (await ui.field(page, "profileId").inputValue()).trim() || null,
      positionNumber: await ui.field(page, "positionNumber").inputValue(), email: await ui.email(page).inputValue(),
      dob: (await ui.field(page, "dob").inputValue()).replace(/^(\d{2})\/(\d{2})\/(\d{4})$/u, "$3-$1-$2"), detailVerified: true });
    if (await visible(ui.transactionId(page)) !== transactionId) throw new Error("ucpath-hire-detail-changed");
    return row;
  };
  const operations: UcpathHireDriver = {
    async readHireSubject() {
      requireApp("wizard");
      if (staged === undefined) throw new Error("ucpath-hire-not-staged");
      return personalIdentity(staged);
    },
    async scanHireTransactions(raw) {
      const input = UcpathHireIdentitySchema.parse({ employee: raw.employee, expectedName: raw.expectedName }); staged = undefined;
      assertCurrent(); await page.goto(ui.searchUrl, { waitUntil: "domcontentloaded", timeout: BOUND_MS }); requireApp("search");
      for (const filter of [...ui.searchFilters(page), ui.searchName(page)]) if ((await filter.inputValue()).trim() !== "") throw new Error("ucpath-hire-search-filter-not-cleared");
      if (normalize(await ui.nameOperator(page).locator("option:checked").innerText()) !== "begins with" || await ui.caseSensitive(page).isChecked()) throw new Error("ucpath-hire-search-operator-refused");
      const searchName = `${input.employee.firstName} ${input.employee.lastName}`;
      const requireInKey = (name: string) => { if (!normalize(name).startsWith(normalize(searchName))) throw new Error("ucpath-hire-search-result-outside-key"); };
      await ui.searchName(page).fill(searchName, { timeout: BOUND_MS });
      if (await ui.searchName(page).inputValue() !== searchName) throw new Error("ucpath-hire-search-key-mismatch");
      if (await ui.rows(page).count() !== 0 || await ui.transactionId(page).count() !== 0 || await ui.empty(page).count() !== 0) throw new Error("ucpath-hire-stale-search-markers");
      await ui.search(page).click({ timeout: BOUND_MS });
      await Promise.race([ui.rows(page).first().waitFor({ state: "visible", timeout: BOUND_MS }),
        ui.transactionId(page).waitFor({ state: "visible", timeout: BOUND_MS }), ui.empty(page).waitFor({ state: "visible", timeout: BOUND_MS })]);
      requireApp("search");
      const states = [await ui.rows(page).count() > 0, await ui.transactionId(page).isVisible(), await ui.empty(page).isVisible()];
      if (states.filter(Boolean).length !== 1) throw new Error("ucpath-hire-search-settlement-ambiguous");
      const result = (rows: UcpathHireScan["rows"], state: UcpathHireScan["state"]) => UcpathHireScanSchema.parse({ state, rows, queryDigest: ucpathHireSearchDigest(input.employee),
        observedAt: clock.now().toISOString(), source: "ss-smart-hr-list-and-detail" });
      if (states[2]) return result([], "complete");
      if (states[1]) {
        const only = await readDetail(); requireInKey(only.displayedName);
        await ui.back(page).click({ timeout: BOUND_MS });
        const counter = await visible(ui.counter(page));
        if (counter !== "1-1 of 1" || await ui.rows(page).count() !== 1 || await visible(ui.rowId(page, 0)) !== only.transactionId) throw new Error("ucpath-hire-single-detail-membership-unverified");
        return result([only], "complete");
      }
      const counter = /^(\d+)-(\d+) of (\d+)$/u.exec(await visible(ui.counter(page)));
      if (counter === null || counter[1] !== "1") throw new Error("ucpath-hire-list-counter-unverified");
      const count = Number(counter[3]);
      if (count < 1 || count > 300) throw new Error("ucpath-hire-list-count-refused");
      const completeList = async () => {
        if (await visible(ui.counter(page)) !== `1-${String(count)} of ${String(count)}`) {
          await ui.viewAll(page).click({ timeout: BOUND_MS });
          await page.getByText(`1-${String(count)} of ${String(count)}`, { exact: true }).waitFor({ state: "visible", timeout: BOUND_MS });
        }
        if (await ui.rows(page).count() !== count) throw new Error("ucpath-hire-list-incomplete");
      };
      await completeList();
      for (let index = 0; index < count; index++) requireInKey(await visible(ui.rowName(page, index)));
      const ids: string[] = [];
      for (let index = 0; index < count; index++) ids.push(await visible(ui.rowId(page, index)));
      if (new Set(ids).size !== count) throw new Error("ucpath-hire-list-duplicate-id");
      const rows: UcpathHireScan["rows"] = [];
      for (const [index, id] of ids.entries()) {
        if (await visible(ui.rowId(page, index)) !== id) throw new Error("ucpath-hire-row-changed");
        await ui.rowDrill(page, index).click({ timeout: BOUND_MS });
        rows.push(await readDetail(id));
        await ui.back(page).click({ timeout: BOUND_MS }); await completeList();
        for (const [position, boundId] of ids.entries()) if (await visible(ui.rowId(page, position)) !== boundId) throw new Error("ucpath-hire-list-membership-changed");
      }
      return result(rows, count === 300 ? "incomplete" : "complete");
    },
    async stageHire(raw, capture) {
      const target = UcpathHireTargetSchema.parse(raw); staged = undefined;
      const template = target.mode === "new-hire" ? "UC_FULL_HIRE" : "UC_CONC_HIRE";
      const reason = target.mode === "new-hire" ? "Hire - No Prior UC Affiliation" : "Concurrent Hire - Non Dual Emp";
      await step(() => page.goto(ui.wizardUrl, { waitUntil: "domcontentloaded", timeout: BOUND_MS }), capture); requireApp("wizard");
      await fill(() => ui.field(page, "template"), template, capture);
      await fill(() => ui.field(page, "effectiveDate"), target.employee.effectiveDate, capture);
      await step(() => ui.createDraft(page).click({ timeout: BOUND_MS }), capture);
      await step(() => ui.reason(page).selectOption({ label: reason }, { timeout: BOUND_MS }), capture);
      if (await ui.reason(page).locator("option:checked").innerText() !== reason) throw new Error("ucpath-hire-reason-unverified");
      if (target.emplId !== null) {
        await fill(() => ui.field(page, "emplId"), target.emplId, capture);
        if (normalize(await visible(ui.resolvedName(page))) !== normalize(target.expectedName)) throw new Error("ucpath-hire-resolved-person-mismatch");
      }
      await step(() => ui.continue(page).click({ timeout: BOUND_MS }), capture);
      if (target.emplId !== null) {
        const message = await visible(ui.personConfirmation(page));
        if (/Person ID (\d{8}) already exists in the system/u.exec(message)?.[1] !== target.emplId || !message.includes("Select OK to continue the hire process with this Person ID")) throw new Error("ucpath-hire-confirmation-refused");
        await step(() => ui.confirmExistingPerson(page).click({ timeout: BOUND_MS }), capture);
      }
      const tab = async (name: Parameters<typeof ui.tab>[1]) => { await step(() => ui.tab(page, name).click({ timeout: BOUND_MS }), capture); requireApp("wizard"); };
      if (target.mode === "new-hire") {
        for (const key of ["firstName", "lastName", "middleName", "preferredFirstName", "preferredLastName", "preferredMiddleName", "address", "city", "state", "postalCode"] as const) {
          await fill(() => ui.field(page, key), target.employee[key], capture); recordBrowserAction("typed", `ucpath.hire.${key}`);
        }
        if (target.employee.addressLine2 !== "") await fill(() => ui.field(page, "addressLine2"), target.employee.addressLine2, capture);
        await fill(() => ui.field(page, "dob"), usDate(target.employee.dob), capture);
        await fill(() => ui.field(page, "ssn"), target.employee.ssn ?? "", capture,
          actual => actual.replace(/\D/gu, "") === (target.employee.ssn ?? ""));
        if (target.employee.phone !== "") {
          await step(() => ui.phoneType(page).selectOption({ label: "Mobile - Personal" }), capture);
          await fill(() => ui.phone(page), target.employee.phone, capture, actual => actual.replace(/\D/gu, "") === target.employee.phone.replace(/\D/gu, ""));
          await step(() => ui.phonePreferred(page).check({ timeout: BOUND_MS }), capture);
          if (!await ui.phonePreferred(page).isChecked()) throw new Error("ucpath-hire-phone-preference-unverified");
        }
        await step(() => ui.emailType(page).selectOption({ label: "Home" }), capture);
        await fill(() => ui.email(page), target.employee.email, capture);
        await fill(() => ui.field(page, "profileId"), target.profileId ?? "", capture);
        await tab("Job Data");
      }
      for (const key of ["positionNumber", "employeeClassification", "expectedJobEndDate"] as const) await fill(() => ui.field(page, key), target.employee[key], capture);
      await fill(() => ui.field(page, "compRateCode"), "UCHRLY", capture);
      const rate = `${String(Math.floor(target.employee.hourlyRateMinor / 100))}.${String(target.employee.hourlyRateMinor % 100).padStart(2, "0")}`;
      await fill(() => ui.field(page, "rate"), rate, capture, actual => /^\d+\.\d+$/u.test(actual) && actual.replace(/0+$/u, "") === rate.replace(/0+$/u, ""));
      await fill(() => ui.field(page, "frequency"), "H", capture);
      for (const key of ["positionNumber", "employeeClassification", "expectedJobEndDate"] as const) {
        if (await ui.field(page, key).inputValue() !== target.employee[key]) throw new Error("ucpath-hire-job-data-changed");
      }
      if ((await ui.field(page, "rate").inputValue()).replace(/0+$/u, "") !== rate.replace(/0+$/u, "")
        || await ui.field(page, "compRateCode").inputValue() !== "UCHRLY" || await ui.field(page, "frequency").inputValue() !== "H") throw new Error("ucpath-hire-pay-data-changed");
      await capture();
      await tab("Earns Dist");
      if (target.mode === "new-hire") await tab("Employee Experience");
      await tab("Personal Data");
      const observedName = await personalIdentity(target);
      await fill(() => ui.comments(page), target.comments, capture);
      await fill(() => ui.initiatorComments(page), target.comments, capture);
      if (await visible(ui.transactionId(page)) !== "NEW" || await ui.save(page).count() !== 1 || !await ui.save(page).isEnabled()) throw new Error("ucpath-hire-submit-not-ready");
      await capture(); staged = target;
      return UcpathHireStagingSchema.parse({ stagedPageState: UCPATH_HIRE_STAGED, observedName, transactionIdDisplay: "NEW", template, reason });
    },
    async submitHire(capability) {
      assertMintedMutationCapability(capability); requireApp("wizard");
      const target = staged; if (target === undefined) throw new Error("ucpath-hire-not-staged");
      if (containsDryRunSample(target)) throw new Error("ucpath-hire-preview-target-refused");
      await personalIdentity(target);
      if (await visible(ui.transactionId(page)) !== "NEW" || await ui.comments(page).inputValue() !== target.comments
        || await ui.initiatorComments(page).inputValue() !== target.comments || !await ui.save(page).isEnabled()) throw new Error("ucpath-hire-staged-form-changed");
      staged = undefined;
      await ui.save(page).click({ timeout: BOUND_MS }); recordBrowserAction("clicked", "ucpath.hire.save-and-submit");
      const confirmation = ui.confirmExistingPerson(page), error = ui.submitError(page);
      const personMatch = ui.personMatch(page), selectAction = ui.selectAction(page);
      const outcome = await Promise.race([
        page.waitForURL(url => url.origin === new URL(ui.searchUrl).origin && url.pathname === new URL(ui.searchUrl).pathname, { timeout: BOUND_MS }).then(() => "detail"),
        confirmation.waitFor({ state: "visible", timeout: BOUND_MS }).then(() => "confirmation"),
        error.waitFor({ state: "visible", timeout: BOUND_MS }).then(() => "error"),
        personMatch.waitFor({ state: "visible", timeout: BOUND_MS }).then(() => "person-match"),
        selectAction.waitFor({ state: "visible", timeout: BOUND_MS }).then(() => "select-action"),
      ]);
      if (await error.isVisible() || await personMatch.isVisible() || await selectAction.isVisible()) throw new Error("ucpath-hire-submit-requires-review");
      if (outcome === "confirmation") {
        if (await confirmation.count() !== 1) throw new Error("ucpath-hire-confirmation-ambiguous");
        await confirmation.click({ timeout: BOUND_MS });
        const scan = await operations.scanHireTransactions(target), verdict = ucpathHireVerdict(target, scan);
        if (verdict.state !== "present") throw new Error("ucpath-hire-submit-unverified");
        return verdict.proof;
      }
      if (outcome !== "detail") throw new Error("ucpath-hire-submit-unverified");
      const row = await readDetail();
      const proof = hireProofForTarget(target, row);
      if (proof === undefined) throw new Error("ucpath-hire-submit-unverified");
      return proof;
    },
  };
  return operations;
}
