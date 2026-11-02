import type { Locator, Page } from "playwright";
import { systemClock } from "../../../../rules/time/clock.js";
import { recordBrowserAction } from "../../browser-shared/action-notes.js";
import { EidSchema } from "../../../../rules/identity/ids.js";
import type { Eid, ElementId } from "../../../../rules/identity/ids.js";
import { UCPATH_SS_SMART_HR_SEARCH_READY, UCPATH_SS_SMART_HR_SEARCH_EID_INPUT,
  UCPATH_SS_SMART_HR_SEARCH_BUTTON, UcpathSsSmartHrSettlementDiagnosticSchema,
  UcpathTransactionScanSchema } from "../../../../models/ui/ucpath-smart-hr-termination.js";
import type { UcpathSsSmartHrSettlementDiagnostic, UcpathTransactionScan } from "../../../../models/ui/ucpath-smart-hr-termination.js";
import { UCPATH_SS_SMART_HR_RECEIPT_DISPLAY, UCPATH_SS_SMART_HR_APPROVAL_STATUS_DISPLAY,
  UcpathApprovalStatusSchema } from "../../../../models/ui/ucpath-ss-smart-hr.js";
import { resolveUcpathFindingIndexedElement, resolveUcpathFindingElement, ucpathFindingElementById, waitForUcpathFindingState, resolveUcpathElement, ucpathElementById, waitForUcpathState } from "./registry-locators.js";
import {
  UCPATH_SS_SMART_HR_FINDINGS_LIST_READY, UCPATH_SS_SMART_HR_FINDINGS_DETAIL_READY,
  UCPATH_SS_SMART_HR_RESULT_TRANSACTION_ID, UCPATH_SS_SMART_HR_RESULT_EID,
  UCPATH_SS_SMART_HR_RESULT_NAME, UCPATH_SS_SMART_HR_RESULT_DRILL_IN,
  UCPATH_SS_SMART_HR_RESULT_COUNTER, UCPATH_SS_SMART_HR_RESULTS_VIEW_ALL,
  UCPATH_SS_SMART_HR_DETAIL_REQUESTED, UCPATH_SS_SMART_HR_DETAIL_NAME,
  UCPATH_SS_SMART_HR_DETAIL_ACTION, UCPATH_SS_SMART_HR_DETAIL_START_DATE,
  UCPATH_SS_SMART_HR_RETURN_TO_LIST, UcpathTransactionFindingsSchema,
} from "../../../../models/ui/ucpath-transaction-findings.js";
import type { UcpathTransactionFindings, UcpathTransactionFinding } from "../../../../models/ui/ucpath-transaction-findings.js";
const SEARCH_URL = "https://ucphrprdpub.universityofcalifornia.edu/psc/ucphrprd/EMPLOYEE/HRMS/c/UC_EXTENSIONS.UC_SS_TBH.GBL";
const DRIVER_ANCHOR = Object.freeze({
  searchEmplIdOperator: '[id="UC_SS_TBH_DVW_EMPLID$op"]',
  searchCriteriaBanner: "#PTS_CRITTEXT_DISP",
  searchResultRow: 'tr[id^="trPTS_CFG_CL_STD_RSL"]',
  errorBanner: ".PSERROR, #ALERTMSG, .ps_alert-error",
});

const EQUALS_OPERATOR = "2";
/** PeopleSoft's standard empty-result sentence; see the module note. */
const NO_RESULTS_TEXT = "no matching values were found";
const NO_RESULTS_MARKER = new RegExp(NO_RESULTS_TEXT, "iu");
const TRANSACTION_ID = /^T\d{6,}$/u;
const SCAN_BOUND_MS = 45_000;
// Bound synchronous diagnostic DOM reads to avoid extending a distressed-page scan indefinitely.
const SETTLEMENT_DIAGNOSTIC_BOUND_MS = 1_000;

const NOT_INDETERMINATE_SETTLEMENT = Object.freeze({
  state: "not-attempted" as const,
  cause: "not-indeterminate-settlement" as const,
});
const SETTLEMENT_CAPTURE_FAILED = Object.freeze({
  state: "capture-failed" as const,
  cause: "page-evaluation-failed" as const,
});

type SsSmartHrSettlementObservation = Readonly<{
  resultRowCount: number;
  resultRowVisible: boolean;
  noResultsCount: number;
  noResultsVisible: boolean;
  receiptCount: number;
  receiptVisible: boolean;
}>;

const hasVisibleSsSmartHrSettlementSignal = (selectors: Readonly<{
  resultRow: string;
  receipt: string;
  noResultsText: string;
}>): boolean => {
  // This callback crosses into the browser. A named inner function acquires
  // tsx's __name helper, which exists only in the Node realm.
  for (const node of [
    ...document.querySelectorAll(selectors.resultRow),
    ...document.querySelectorAll(selectors.receipt),
  ]) {
    const style = window.getComputedStyle(node);
    const bounds = node.getBoundingClientRect();
    if (style.visibility !== "hidden"
      && style.display !== "none"
      && bounds.width > 0
      && bounds.height > 0) return true;
  }
  const visibleBodyText = document.body?.innerText.toLowerCase() ?? "";
  return visibleBodyText.includes(selectors.noResultsText);
};

async function observeSsSmartHrSettlement(
  assertCurrent: () => void,
  resultRows: Locator,
  noResults: Locator,
  receipt: Locator,
): Promise<SsSmartHrSettlementObservation> {
  assertCurrent();
  const [
    resultRowCount,
    resultRowVisible,
    noResultsCount,
    noResultsVisible,
    receiptCount,
    receiptVisible,
  ] = await Promise.all([
    resultRows.count(),
    resultRows.first().isVisible(),
    noResults.count(),
    noResults.first().isVisible(),
    receipt.count(),
    receipt.first().isVisible(),
  ]);
  assertCurrent();
  return {
    resultRowCount,
    resultRowVisible,
    noResultsCount,
    noResultsVisible,
    receiptCount,
    receiptVisible,
  };
}



const captureSsSmartHrSettlementDiagnostic = (selectors: Readonly<{
  criteriaBanner: string;
  resultRow: string;
  errorRegion: string;
  searchButton: string;
}>): unknown => {
  const banner = document.querySelector(selectors.criteriaBanner);
  const bannerText = banner?.textContent?.trim();
  const bannerClassification = banner === null
    ? "absent"
    : bannerText !== undefined && /no matching values were found/iu.test(bannerText)
      ? "no-match"
      : bannerText !== undefined && /\b\d+\s+results?\b/iu.test(bannerText)
        ? "positive-count"
        : "other";
  const searchButton = document.querySelector(selectors.searchButton);
  const searchStyle = searchButton === null ? undefined : window.getComputedStyle(searchButton);
  const searchBounds = searchButton?.getBoundingClientRect();
  return {
    state: "captured",
    banner: bannerClassification,
    oldRowCount: document.querySelectorAll(selectors.resultRow).length,
    route: window.location.pathname.includes("/c/UC_EXTENSIONS.UC_SS_TBH.GBL")
      ? "ss-smart-hr-search"
      : "other",
    iframeCount: document.querySelectorAll("iframe").length,
    errorRegionCount: [...document.querySelectorAll(selectors.errorRegion)]
      .filter((node) => node.textContent?.trim().length !== 0).length,
    searchVisible: searchStyle !== undefined
      && searchStyle.visibility !== "hidden"
      && searchStyle.display !== "none"
      && searchBounds !== undefined
      && searchBounds.width > 0
      && searchBounds.height > 0,
    searchEnabled: searchButton instanceof HTMLButtonElement
      || searchButton instanceof HTMLInputElement
      ? !searchButton.disabled
      : searchButton !== null && searchButton.getAttribute("aria-disabled") !== "true",
  };
};

async function evaluateSsSmartHrSettlementDiagnostic(
  assertCurrent: () => void,
  page: Page,
  selectors: Readonly<{
    criteriaBanner: string;
    resultRow: string;
    errorRegion: string;
    searchButton: string;
  }>,
): Promise<unknown> {
  let cancelBound = (): void => undefined;
  const diagnosticTimedOut = new Promise<never>((_resolve, reject) => {
    const handle = setTimeout(() => {
      reject(new Error(
        `the SS Smart HR settlement diagnostic did not settle within `
        + `${String(SETTLEMENT_DIAGNOSTIC_BOUND_MS)}ms`,
      ));
    }, SETTLEMENT_DIAGNOSTIC_BOUND_MS);
    cancelBound = (): void => { clearTimeout(handle); };
  });
  try {
    assertCurrent();
    const result = await Promise.race([
      page.evaluate(captureSsSmartHrSettlementDiagnostic, selectors),
      diagnosticTimedOut,
    ]);
    assertCurrent();
    return result;
  } finally {
    cancelBound();
  }
}

// PeopleSoft renders editable values as inputs and read-only values as spans with the same record-field ID.
export async function textOf(assertCurrent: () => void, locator: Locator): Promise<string> {
  assertCurrent();
  const isFormControl = await locator.evaluate(
    (node) => node instanceof HTMLInputElement
      || node instanceof HTMLTextAreaElement
      || node instanceof HTMLSelectElement,
  );
  assertCurrent();
  const value = isFormControl ? await locator.inputValue() : await locator.innerText();
  assertCurrent();
  return value.trim();
}

type FindingBinding = Readonly<{ transactionId: string; emplId: Eid; displayedName: string; index: number }>;

async function visibleText(assertCurrent: () => void, locator: Locator): Promise<string> {
  assertCurrent();
  if (await locator.count() !== 1 || !await locator.isVisible()) {
    throw new Error("the SS Smart HR finding requires exactly one visible control");
  }
  return textOf(assertCurrent, locator);
}

async function readFindingList(assertCurrent: () => void, page: Page, emplId: Eid): Promise<{
  reported: number; bindings: readonly FindingBinding[];
}> {
  await waitForUcpathFindingState(assertCurrent, page, UCPATH_SS_SMART_HR_FINDINGS_LIST_READY);
  assertCurrent();
  if (await resolveUcpathElement(page, UCPATH_SS_SMART_HR_RECEIPT_DISPLAY).count() !== 0
    || await page.getByText(NO_RESULTS_MARKER).count() !== 0) {
    throw new Error("the SS Smart HR finding list has ambiguous detail or empty markers");
  }
  const readCounter = async () => {
    const counter = await visibleText(assertCurrent, resolveUcpathFindingElement(page, UCPATH_SS_SMART_HR_RESULT_COUNTER));
    const match = /^(\d+)-(\d+) of (\d+)$/u.exec(counter);
    if (match === null) throw new Error("the SS Smart HR result counter is malformed");
    const first = Number(match[1]);
    const last = Number(match[2]);
    const total = Number(match[3]);
    if (first !== 1 || last < 1 || total < last || total > 300) {
      throw new Error("the SS Smart HR result counter range is not authoritative");
    }
    assertCurrent();
    const count = await page.locator(DRIVER_ANCHOR.searchResultRow).count();
    if (count !== last) throw new Error("the SS Smart HR result counter disagrees with its rows");
    return { last, total };
  };
  let counter = await readCounter();
  const reported = counter.total;
  if (counter.last < reported) {
    const viewAll = resolveUcpathFindingElement(page, UCPATH_SS_SMART_HR_RESULTS_VIEW_ALL);
    await visibleText(assertCurrent, viewAll);
    assertCurrent();
    const expansionDeadline = systemClock.monotonicMs() + SCAN_BOUND_MS;
    await viewAll.click();
    assertCurrent();
    recordBrowserAction("clicked", UCPATH_SS_SMART_HR_RESULTS_VIEW_ALL);
    await page.getByText(new RegExp(`^1-${String(reported)} of ${String(reported)}$`, "u"), { exact: true })
      .waitFor({ state: "visible", timeout: Math.max(1, expansionDeadline - systemClock.monotonicMs()) });
    assertCurrent();
    await resolveUcpathFindingIndexedElement(page, UCPATH_SS_SMART_HR_RESULT_EID, reported - 1)
      .waitFor({ state: "visible", timeout: Math.max(1, expansionDeadline - systemClock.monotonicMs()) });
    assertCurrent();
    await waitForUcpathFindingState(assertCurrent, page, UCPATH_SS_SMART_HR_FINDINGS_LIST_READY);
    counter = await readCounter();
    if (counter.total !== reported || counter.last !== reported) {
      throw new Error("the SS Smart HR result expansion stalled or changed its count");
    }
  }
  const bindings: FindingBinding[] = [];
  const rows = await page.locator(DRIVER_ANCHOR.searchResultRow).all();
  for (const [index, row] of rows.entries()) {
    assertCurrent();
    if (!await row.isVisible()) throw new Error("the SS Smart HR result row was not visible");
    const readCell = async (id: ElementId) => {
      const element = ucpathFindingElementById(id);
      if (element.locator.kind !== "indexed-css") throw new Error("finding cells require indexed recipes");
      return visibleText(assertCurrent, row.locator(`${element.locator.selectorPrefix}${String(index)}${element.locator.selectorSuffix}`));
    };
    const transactionId = await readCell(UCPATH_SS_SMART_HR_RESULT_TRANSACTION_ID);
    const rowEid = EidSchema.parse(await readCell(UCPATH_SS_SMART_HR_RESULT_EID));
    const displayedName = await readCell(UCPATH_SS_SMART_HR_RESULT_NAME);
    if (!TRANSACTION_ID.test(transactionId) || rowEid !== emplId || displayedName.length === 0) {
      throw new Error("the SS Smart HR result identity does not match the requested subject");
    }
    await readCell(UCPATH_SS_SMART_HR_RESULT_DRILL_IN);
    bindings.push({ transactionId, emplId: rowEid, displayedName, index });
  }
  if (bindings.length !== reported || new Set(bindings.map(row => row.transactionId)).size !== reported) {
    throw new Error("the SS Smart HR result set is missing rows or repeats transaction IDs");
  }
  const finalCounter = await readCounter();
  if (finalCounter.total !== reported || finalCounter.last !== reported) throw new Error("the SS Smart HR result count changed");
  for (const binding of bindings) {
    const transactionId = await visibleText(assertCurrent, resolveUcpathFindingIndexedElement(page, UCPATH_SS_SMART_HR_RESULT_TRANSACTION_ID, binding.index));
    const emplId = await visibleText(assertCurrent, resolveUcpathFindingIndexedElement(page, UCPATH_SS_SMART_HR_RESULT_EID, binding.index));
    const displayedName = await visibleText(assertCurrent, resolveUcpathFindingIndexedElement(page, UCPATH_SS_SMART_HR_RESULT_NAME, binding.index));
    if (transactionId !== binding.transactionId || emplId !== binding.emplId || displayedName !== binding.displayedName) {
      throw new Error("the SS Smart HR finding row mutated while binding its identity");
    }
  }
  return { reported, bindings };
}

const findingSet = (rows: readonly FindingBinding[]): string => JSON.stringify(
  rows.map(({ transactionId, emplId, displayedName }) => [transactionId, emplId, displayedName]).sort(),
);
const normalizedName = (name: string): string => name.trim().replace(/\s+/gu, " ").toLocaleLowerCase("en-US");

async function returnToFindingList(assertCurrent: () => void, page: Page): Promise<void> {
  const back = resolveUcpathFindingElement(page, UCPATH_SS_SMART_HR_RETURN_TO_LIST);
  await visibleText(assertCurrent, back);
  assertCurrent();
  await back.click();
  assertCurrent();
  recordBrowserAction("clicked", UCPATH_SS_SMART_HR_RETURN_TO_LIST);
  await waitForUcpathFindingState(assertCurrent, page, UCPATH_SS_SMART_HR_FINDINGS_LIST_READY);
  await page.locator(DRIVER_ANCHOR.searchResultRow).first().waitFor({ state: "visible", timeout: SCAN_BOUND_MS });
  assertCurrent();
}

async function readFindingDetail(assertCurrent: () => void, page: Page, binding: FindingBinding): Promise<UcpathTransactionFinding> {
  const rowId = await visibleText(assertCurrent, resolveUcpathFindingIndexedElement(page, UCPATH_SS_SMART_HR_RESULT_TRANSACTION_ID, binding.index));
  const rowEid = await visibleText(assertCurrent, resolveUcpathFindingIndexedElement(page, UCPATH_SS_SMART_HR_RESULT_EID, binding.index));
  const rowName = await visibleText(assertCurrent, resolveUcpathFindingIndexedElement(page, UCPATH_SS_SMART_HR_RESULT_NAME, binding.index));
  if (rowId !== binding.transactionId || rowEid !== binding.emplId || rowName !== binding.displayedName) {
    throw new Error("the SS Smart HR bound identity changed before clicking its drill-in");
  }
  const link = resolveUcpathFindingIndexedElement(page, UCPATH_SS_SMART_HR_RESULT_DRILL_IN, binding.index);
  await visibleText(assertCurrent, link);
  assertCurrent();
  await link.click();
  assertCurrent();
  recordBrowserAction("clicked", UCPATH_SS_SMART_HR_RESULT_DRILL_IN);
  const receipt = resolveUcpathElement(page, UCPATH_SS_SMART_HR_RECEIPT_DISPLAY);
  await receipt.waitFor({ state: "visible", timeout: SCAN_BOUND_MS });
  await waitForUcpathFindingState(assertCurrent, page, UCPATH_SS_SMART_HR_FINDINGS_DETAIL_READY);
  const transactionId = await visibleText(assertCurrent, receipt);
  const displayedName = await visibleText(assertCurrent, resolveUcpathFindingElement(page, UCPATH_SS_SMART_HR_DETAIL_NAME));
  if (transactionId !== binding.transactionId || normalizedName(displayedName) !== normalizedName(binding.displayedName)) {
    throw new Error(
      "the SS Smart HR detail identity differs from its bound result row: "
      + `UCPath rendered transaction ${JSON.stringify(transactionId)} for bound transaction ${JSON.stringify(binding.transactionId)}; `
      + "refusing to read one transaction as another",
    );
  }
  recordBrowserAction("opened", "ucpath.smart-hr.transaction-detail");
  const approvalStatus = await visibleText(assertCurrent, resolveUcpathElement(page, UCPATH_SS_SMART_HR_APPROVAL_STATUS_DISPLAY));
  const submittedAt = await visibleText(assertCurrent, resolveUcpathFindingElement(page, UCPATH_SS_SMART_HR_DETAIL_REQUESTED));
  const action = await visibleText(assertCurrent, resolveUcpathFindingElement(page, UCPATH_SS_SMART_HR_DETAIL_ACTION));
  const startDate = await visibleText(assertCurrent, resolveUcpathFindingElement(page, UCPATH_SS_SMART_HR_DETAIL_START_DATE));
  if (await visibleText(assertCurrent, receipt) !== transactionId
    || normalizedName(await visibleText(assertCurrent, resolveUcpathFindingElement(page, UCPATH_SS_SMART_HR_DETAIL_NAME))) !== normalizedName(binding.displayedName)) {
    throw new Error("the SS Smart HR detail identity changed while reading");
  }
  // This read verified the bound detail; candidate selectors still await historical live certification.
  return { transactionId, emplId: binding.emplId, displayedName, approvalStatus: UcpathApprovalStatusSchema.parse(approvalStatus), submittedAt, action, startDate, detailVerified: true };
}

export async function readTransactionFindingsOnPage(
  assertCurrent: () => void,
  page: Page,
  input: Readonly<{ emplId: Eid }>,
  observedAt: string,
): Promise<UcpathTransactionFindings> {
  const unreadable = (
    reason: string,
    diagnostic: UcpathSsSmartHrSettlementDiagnostic,
  ): UcpathTransactionFindings =>
    UcpathTransactionFindingsSchema.parse({
      state: "unreadable",
      emplId: input.emplId,
      reason,
      diagnostic,
      observedAt,
    });
  const failureReason = (error: unknown): string =>
    "the SS Smart HR transaction scan failed: "
    + (error instanceof Error ? error.message : String(error));
  try {
    assertCurrent();
    await page.goto(SEARCH_URL, { waitUntil: "domcontentloaded", timeout: SCAN_BOUND_MS });
    assertCurrent();
    recordBrowserAction("opened", "ucpath.smart-hr.search");
    assertCurrent();
    await waitForUcpathState(assertCurrent, page, UCPATH_SS_SMART_HR_SEARCH_READY);
    assertCurrent();
    await resolveUcpathElement(page, UCPATH_SS_SMART_HR_SEARCH_EID_INPUT).fill(input.emplId);
    assertCurrent();
    recordBrowserAction("typed", UCPATH_SS_SMART_HR_SEARCH_EID_INPUT, input.emplId);
    assertCurrent();
    await page.locator(DRIVER_ANCHOR.searchEmplIdOperator).selectOption(EQUALS_OPERATOR);
    assertCurrent();
    recordBrowserAction("selected", "ucpath.smart-hr.search-operator", EQUALS_OPERATOR);
    const autoDrilledReceipt = resolveUcpathElement(
      page,
      UCPATH_SS_SMART_HR_RECEIPT_DISPLAY,
    );
    const resultRows = page.locator(DRIVER_ANCHOR.searchResultRow);
    const noResults = page.getByText(NO_RESULTS_MARKER);
    assertCurrent();
    const beforeSearch = await observeSsSmartHrSettlement(assertCurrent,
      resultRows,
      noResults,
      autoDrilledReceipt,
    );
    if (
      beforeSearch.resultRowCount !== 0
      || beforeSearch.noResultsCount !== 0
      || beforeSearch.receiptCount !== 0
    ) {
      throw new Error(
        "the SS Smart HR page exposed settlement markers before the current search was submitted "
        + `(result rows: ${String(beforeSearch.resultRowCount)}, no-results markers: `
        + `${String(beforeSearch.noResultsCount)}, transaction-id controls: `
        + `${String(beforeSearch.receiptCount)}); refusing stale response authority`,
      );
    }
    const receiptRecipe = ucpathElementById(UCPATH_SS_SMART_HR_RECEIPT_DISPLAY).locator;
    if (receiptRecipe.kind !== "css") {
      throw new Error("the SS Smart HR receipt settlement signal requires its proven CSS anchor");
    }
    assertCurrent();
    await resolveUcpathElement(page, UCPATH_SS_SMART_HR_SEARCH_BUTTON).click();
    assertCurrent();
    recordBrowserAction("clicked", UCPATH_SS_SMART_HR_SEARCH_BUTTON);
    try {
      assertCurrent();
      await page.waitForFunction(hasVisibleSsSmartHrSettlementSignal, {
        resultRow: DRIVER_ANCHOR.searchResultRow,
        receipt: receiptRecipe.selector,
        noResultsText: NO_RESULTS_TEXT,
      }, { timeout: SCAN_BOUND_MS, polling: 50 });
    } catch (error) {
      assertCurrent();
      if (!(error instanceof Error && error.name === "TimeoutError")) {
        throw error;
      }
      // Only an actual visible-signal timeout permits the diagnostic; page/context failures retain their unreadable outcome.
      const settlementError = new Error(
        "the SS Smart HR search rendered neither a result row, an auto-drilled transaction detail, "
        + `nor PeopleSoft's no-results marker within ${String(SCAN_BOUND_MS)}ms`,
        { cause: error },
      );
      let diagnostic: UcpathSsSmartHrSettlementDiagnostic;
      try {
        const searchButton = ucpathElementById(UCPATH_SS_SMART_HR_SEARCH_BUTTON).locator;
        if (searchButton.kind !== "css") {
          throw new Error(
            "the SS Smart HR Search button diagnostic requires its proven CSS anchor",
            { cause: error },
          );
        }
        assertCurrent();
        diagnostic = UcpathSsSmartHrSettlementDiagnosticSchema.parse(
          await evaluateSsSmartHrSettlementDiagnostic(assertCurrent, page, {
            criteriaBanner: DRIVER_ANCHOR.searchCriteriaBanner,
            resultRow: DRIVER_ANCHOR.searchResultRow,
            errorRegion: DRIVER_ANCHOR.errorBanner,
            searchButton: searchButton.selector,
          },
        ));
      } catch {
        assertCurrent();
        diagnostic = SETTLEMENT_CAPTURE_FAILED;
      }
      assertCurrent();
      return unreadable(failureReason(settlementError), diagnostic);
    }
    assertCurrent();
    const afterSearch = await observeSsSmartHrSettlement(assertCurrent,
      resultRows,
      noResults,
      autoDrilledReceipt,
    );
    if (afterSearch.resultRowCount > 0 && !afterSearch.resultRowVisible) {
      throw new Error("the SS Smart HR search exposed result rows but none were visible");
    }
    if (afterSearch.noResultsCount > 0) {
      if (afterSearch.noResultsCount !== 1 || !afterSearch.noResultsVisible) {
        throw new Error(
          `the SS Smart HR search exposed ${String(afterSearch.noResultsCount)} no-results markers; `
          + "exactly one visible marker is required",
        );
      }
    }
    if (afterSearch.receiptCount > 0) {
      if (afterSearch.receiptCount !== 1 || !afterSearch.receiptVisible) {
        throw new Error(
          `the SS Smart HR auto-drilled detail exposed ${String(afterSearch.receiptCount)} `
          + "transaction-id controls; exactly one visible control is required",
        );
      }
    }
    const settledStates = [
      ...(afterSearch.resultRowCount > 0 ? ["rows" as const] : []),
      ...(afterSearch.noResultsCount > 0 ? ["empty" as const] : []),
      ...(afterSearch.receiptCount > 0 ? ["single-detail" as const] : []),
    ];
    if (settledStates.length !== 1) {
      throw new Error(
        `the SS Smart HR search settled in ${String(settledStates.length)} states `
        + `(result rows: ${String(afterSearch.resultRowCount)}, no-results markers: `
        + `${String(afterSearch.noResultsCount)}, transaction-id controls: `
        + `${String(afterSearch.receiptCount)}); `
        + "exactly one is required",
      );
    }
    const [settled] = settledStates;
    if (settled === "empty") {
      assertCurrent();
      return UcpathTransactionFindingsSchema.parse({
        state: "read", emplId: input.emplId, rows: [], scannedRowCount: 0,
        completeness: { state: "complete", reportedRowCount: 0 },
        observedAt, source: "ss-smart-hr-list-and-detail",
      });
    }
    if (settled === "single-detail") await returnToFindingList(assertCurrent, page);
    const initial = await readFindingList(assertCurrent, page, input.emplId);
    const originalSet = findingSet(initial.bindings);
    const rows: UcpathTransactionFinding[] = [];
    for (const original of initial.bindings) {
      const current = await readFindingList(assertCurrent, page, input.emplId);
      if (current.reported !== initial.reported || findingSet(current.bindings) !== originalSet) {
        throw new Error("the SS Smart HR result set changed before drill-in");
      }
      const binding = current.bindings.find(row => row.transactionId === original.transactionId);
      if (binding === undefined) throw new Error("the SS Smart HR bound row disappeared");
      rows.push(await readFindingDetail(assertCurrent, page, binding));
      await returnToFindingList(assertCurrent, page);
      const returned = await readFindingList(assertCurrent, page, input.emplId);
      if (returned.reported !== initial.reported || findingSet(returned.bindings) !== originalSet) {
        throw new Error("the SS Smart HR result set changed after returning from detail");
      }
    }
    assertCurrent();
    return UcpathTransactionFindingsSchema.parse({
      state: "read", emplId: input.emplId, rows, scannedRowCount: rows.length,
      completeness: initial.reported === 300
        ? { state: "incomplete", reason: "search-cap", reportedRowCount: 300 }
        : { state: "complete", reportedRowCount: initial.reported },
      observedAt, source: "ss-smart-hr-list-and-detail",
    });
  } catch (error) {
    assertCurrent();
    return unreadable(failureReason(error), NOT_INDETERMINATE_SETTLEMENT);
  }
}


export async function scanTerminationTransactionsOnPage(
  assertCurrent: () => void,
  page: Page,
  input: Readonly<{ emplId: Eid; transactionId?: string }>,
  observedAt: string,
): Promise<UcpathTransactionScan> {
  const findings = await readTransactionFindingsOnPage(assertCurrent, page, { emplId: input.emplId }, observedAt);
  if (findings.state === "unreadable") return UcpathTransactionScanSchema.parse(findings);
  if (findings.completeness.state !== "complete") {
    return UcpathTransactionScanSchema.parse({ state: "unreadable", emplId: input.emplId,
      reason: "the SS Smart HR transaction search reached its 300-row cap",
      diagnostic: NOT_INDETERMINATE_SETTLEMENT, observedAt });
  }
  const rows = findings.rows.filter(row => input.transactionId === undefined || row.transactionId === input.transactionId)
    .map(({ transactionId, emplId, displayedName, action, approvalStatus, startDate }) => ({ transactionId, emplId, displayedName, action, approvalStatus, startDate }));
  return UcpathTransactionScanSchema.parse({ state: "read", emplId: input.emplId, rows, scannedRowCount: rows.length, observedAt });
}
