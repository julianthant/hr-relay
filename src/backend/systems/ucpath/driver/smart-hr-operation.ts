
import type { Locator, Page } from "playwright";
import { recordBrowserAction } from "../../browser-shared/action-notes.js";
import type { Clock } from "../../../../rules/time/clock.js";
import { EidSchema, IsoInstantSchema } from "../../../../rules/identity/ids.js";
import type { Eid, ElementId } from "../../../../rules/identity/ids.js";
import { directIdentifierDisplay } from "../../../../rules/redaction/redaction.js";
import { assertMintedMutationCapability } from "../../../../workflow-kit/mutation-capability.js";
import { UiActionProofSchema } from "../../../../models/ui/driver.js";
import type { MutationCapability, UiActionProof } from "../../../../models/ui/driver.js";
import {
  UCPATH_SMART_HR_CONTINUE_BUTTON,
  UCPATH_SMART_HR_CREATE_TRANSACTION_BUTTON,
  UCPATH_SMART_HR_DELETE_SELECTED_BUTTON,
  UCPATH_SMART_HR_DETAILS_EID_INPUT,
  UCPATH_SMART_HR_DETAILS_READY,
  UCPATH_SMART_HR_INFORMATION_READY,
  UCPATH_SMART_HR_INITIATOR_COMMENTS_FIELD,
  UCPATH_SMART_HR_LAST_DATE_WORKED_INPUT,
  UCPATH_SMART_HR_OVERRIDE_LDW_CHECKBOX,
  UCPATH_SMART_HR_REASON_CODE_SELECT,
  UCPATH_SMART_HR_SAVE_AND_SUBMIT_BUTTON,
  UCPATH_SMART_HR_SETUP_READY,
  UCPATH_SMART_HR_TEMPLATE_INPUT,
  UCPATH_SMART_HR_TERMINATION_STAGED,
  UCPATH_SMART_HR_TRANSACTION_COMMENTS_FIELD,
  UCPATH_SMART_HR_TRANSACTION_DATE_INPUT,
  UCPATH_SS_SMART_HR_SEARCH_BUTTON,
  UCPATH_SS_SMART_HR_SEARCH_EID_INPUT,
  UCPATH_SS_SMART_HR_SEARCH_READY,
  UcpathCommitRefusedError,
  UcpathEmplIdNotRecognizedError,
  UcpathEmploymentRecordMismatchError,
  UcpathPendingSweepStagingSchema,
  UcpathSsSmartHrSettlementDiagnosticSchema,
  UcpathTerminationStagingSchema,
  UcpathTransactionScanSchema,
  isUcpathTerminationAction,
} from "../../../../models/ui/ucpath-smart-hr-termination.js";
import type {
  UcpathInProgressRow,
  UcpathPendingSweepStaging,
  UcpathPendingSweepTarget,
  UcpathSsSmartHrSettlementDiagnostic,
  UcpathTerminationStaging,
  UcpathTerminationTarget,
  UcpathTransactionRow,
  UcpathTransactionScan,
} from "../../../../models/ui/ucpath-smart-hr-termination.js";
import {
  UCPATH_SS_SMART_HR_APPROVAL_STATUS_DISPLAY,
  UCPATH_SS_SMART_HR_RECEIPT_DISPLAY,
  UcpathApprovalStatusSchema,
} from "../../../../models/ui/ucpath-ss-smart-hr.js";
import {
  resolveUcpathElement,
  ucpathElementById,
  waitForUcpathState,
} from "./registry-locators.js";
import { ucpathPendingSweepVerdict } from "../termination-verdict.js";

// Driver-internal controls without source selector keys cannot become provenance-backed registry elements.
const DRIVER_ANCHOR = Object.freeze({

  wizardPersonName: "#PERSON_NAME_NAME_DISPLAY",

  wizardEmplRecord: "#HR_TBH_WRK_EMPL_RCD_CHAR",
  // PeopleSoft derives the disabled job effective date from the transaction date; never fill it.
  wizardJobEffectiveDate: "#HR_TBH_WRK_JOB_EFFDT",
  // The staged transaction ID is NEW until Save; the same field changes from input to span on detail.
  wizardTransactionIdDisplay: "#UC_SS_TRANSACT_UC_TRANSACT_ID",
  // Set the SS Smart HR search operator to exact equality before reading its EID filter.
  searchEmplIdOperator: '[id="UC_SS_TBH_DVW_EMPLID$op"]',
  // The criteria banner carries result count; diagnostic summaries must not return its private text.
  searchCriteriaBanner: "#PTS_CRITTEXT_DISP",
  /** PeopleSoft's standard result-row id prefix. A WAIT target, never a read. */
  searchResultRow: 'tr[id^="trPTS_CFG_CL_STD_RSL"]',

  detailStartDate: '[id="UC_SS_TBH_VW_START_DT$0"]',

  detailAction: '[id="UC_SS_TBH_VW_ACTION$0"]',
  // Read the displayed subject directly; receipt number and status alone do not prove the person.
  detailName: '[id="NAME$0"]',
  // PeopleSoft error regions include aria-live, errorMsg and alert; Smart HR scopes them to the top-level page.
  errorBanner: ".PSERROR, #ALERTMSG, .ps_alert-error",
});

const HRMS = "https://ucphrprdpub.universityofcalifornia.edu/psc/ucphrprd/EMPLOYEE/HRMS";
const WIZARD_URL = `${HRMS}/c/ADMINISTER_WORKFORCE_(GBL).HR_TBH_JOB.GBL`;
const SEARCH_URL = `${HRMS}/c/UC_EXTENSIONS.UC_SS_TBH.GBL`;


const EQUALS_OPERATOR = "2";
/** PeopleSoft's standard empty-result sentence; see the module note. */
const NO_RESULTS_TEXT = "no matching values were found";
const NO_RESULTS_MARKER = new RegExp(NO_RESULTS_TEXT, "iu");
const TRANSACTION_ID = /^T\d{6,}$/u;
const SCAN_BOUND_MS = 45_000;
// Bound synchronous diagnostic DOM reads to avoid extending a distressed-page scan indefinitely.
const SETTLEMENT_DIAGNOSTIC_BOUND_MS = 1_000;
const STEP_BOUND_MS = 60_000;

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

function detailUrl(transactionId: string): string {
  return `${SEARCH_URL}?Action=U&UC_TRANSACT_ID=${transactionId}`;
}

// PeopleSoft renders editable values as inputs and read-only values as spans with the same record-field ID.
async function textOf(assertCurrent: () => void, locator: Locator): Promise<string> {
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

// Read each entire result row because PeopleSoft can change column order.
async function scanTransactionIds(
  assertCurrent: () => void,
  resultRows: Locator,
  expectedRowCount: number,
): Promise<readonly string[]> {
  assertCurrent();
  const rows = await resultRows.all();
  if (rows.length !== expectedRowCount) {
    throw new Error(
      `the SS Smart HR result grid changed from ${String(expectedRowCount)} to `
      + `${String(rows.length)} rows before transaction ids could be read`,
    );
  }
  const ids: string[] = [];
  for (const [index, row] of rows.entries()) {
    assertCurrent();
    if (!(await row.isVisible())) {
      throw new Error(
        `the SS Smart HR result row ${String(index + 1)} was not visible; `
        + "hidden rows cannot contribute current settlement authority",
      );
    }
    assertCurrent();
    const text = await row.innerText();
    const matches = [...new Set(text.match(/T\d{6,}/gu) ?? [])]
      .filter((id) => TRANSACTION_ID.test(id));
    if (matches.length !== 1) {
      throw new Error(
        `the SS Smart HR result row ${String(index + 1)} exposed ${String(matches.length)} `
        + "distinct stable transaction ids; exactly one is required",
      );
    }
    const [transactionId] = matches;
    if (transactionId === undefined) {
      throw new Error("the SS Smart HR result-row transaction id disappeared after validation");
    }
    ids.push(transactionId);
  }
  if (new Set(ids).size !== ids.length) {
    throw new Error(
      "the SS Smart HR result rows repeated one stable transaction id; each row must be distinct",
    );
  }
  assertCurrent();
  return ids;
}

async function readTransactionDetail(
  assertCurrent: () => void,
  page: Page,
  transactionId: string,
  emplId: Eid,
): Promise<UcpathTransactionRow> {
  assertCurrent();
  await page.goto(detailUrl(transactionId), { waitUntil: "domcontentloaded", timeout: SCAN_BOUND_MS });
  assertCurrent();
  recordBrowserAction("opened", "ucpath.smart-hr.transaction-detail");
  const receipt = resolveUcpathElement(page, UCPATH_SS_SMART_HR_RECEIPT_DISPLAY);
  assertCurrent();
  await receipt.waitFor({ state: "visible", timeout: SCAN_BOUND_MS });
  assertCurrent();
  const displayedId = await textOf(assertCurrent, receipt);
  if (displayedId !== transactionId) {
    // An unknown transaction ID silently renders the search form; require both detail markers.
    throw new Error(
      `UCPath rendered transaction ${JSON.stringify(displayedId)} for a request for `
      + `${JSON.stringify(transactionId)}; refusing to read one transaction as another`,
    );
  }
  assertCurrent();
  const [approvalStatus, startDate, action, displayedName] = await Promise.all([
    textOf(assertCurrent, resolveUcpathElement(page, UCPATH_SS_SMART_HR_APPROVAL_STATUS_DISPLAY)),
    textOf(assertCurrent, page.locator(DRIVER_ANCHOR.detailStartDate)),
    textOf(assertCurrent, page.locator(DRIVER_ANCHOR.detailAction)),
    textOf(assertCurrent, page.locator(DRIVER_ANCHOR.detailName)),
  ]);
  assertCurrent();
  return {
    transactionId,
    // The search filter echoes the supplied EID; use the displayed name for subject proof.
    emplId,
    action,
    approvalStatus: UcpathApprovalStatusSchema.parse(approvalStatus),
    startDate,
    displayedName,
  };
}

export async function scanTerminationTransactionsOnPage(
  assertCurrent: () => void,
  page: Page,
  input: Readonly<{ emplId: Eid; transactionId?: string }>,
  observedAt: string,
): Promise<UcpathTransactionScan> {
  const unreadable = (
    reason: string,
    diagnostic: UcpathSsSmartHrSettlementDiagnostic,
  ): UcpathTransactionScan =>
    UcpathTransactionScanSchema.parse({
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
      return UcpathTransactionScanSchema.parse({
        state: "read",
        emplId: input.emplId,
        rows: [],
        scannedRowCount: 0,
        observedAt,
      });
    }
    let ids: readonly string[];
    if (settled === "single-detail") {
      assertCurrent();
      const transactionId = await textOf(assertCurrent, autoDrilledReceipt);
      if (!TRANSACTION_ID.test(transactionId)) {
        throw new Error(
          "the SS Smart HR auto-drilled detail rendered no stable T transaction id",
        );
      }
      ids = [transactionId];
    } else {
      assertCurrent();
      ids = await scanTransactionIds(assertCurrent, resultRows, afterSearch.resultRowCount);
    }
    if (input.transactionId !== undefined) ids = ids.filter(id => id === input.transactionId);
    const rows: UcpathTransactionRow[] = [];
    for (const id of ids) {
      assertCurrent();
      rows.push(await readTransactionDetail(assertCurrent, page, id, input.emplId));
    }
    assertCurrent();
    return UcpathTransactionScanSchema.parse({
      state: "read",
      emplId: input.emplId,
      rows,
      scannedRowCount: ids.length,
      observedAt,
    });
  } catch (error) {
    assertCurrent();
    return unreadable(failureReason(error), NOT_INDETERMINATE_SETTLEMENT);
  }
}


function resolveReasonOption(
  options: readonly { readonly value: string; readonly label: string }[],
  reasonCode: string,
): { readonly value: string; readonly label: string } {
  const matches = options.filter(
    (option) => option.value === reasonCode || option.label === reasonCode,
  );
  const [only] = matches;
  if (matches.length !== 1 || only === undefined) {
    throw new Error(
      `UCPath's Action Reason control offers ${String(matches.length)} options matching `
      + `${JSON.stringify(reasonCode)} by value or label; exactly one is required. Observed: `
      + `${options.map((option) => `${option.value}|${option.label}`).join(" · ")}`,
    );
  }
  return only;
}

async function readReasonOptions(
  assertCurrent: () => void,
  page: Page,
): Promise<readonly { readonly value: string; readonly label: string }[]> {
  assertCurrent();
  const raw = await resolveUcpathElement(page, UCPATH_SMART_HR_REASON_CODE_SELECT)
    .evaluate((node) => [...(node as HTMLSelectElement).options].map(
      (option) => ({ value: option.value, label: option.text.trim() }),
    ));
  assertCurrent();
  return raw.filter((option) => option.value.length > 0);
}

async function stageTerminationOnPage(
  assertCurrent: () => void,
  page: Page,
  input: UcpathTerminationTarget,
  observedAt: string,
): Promise<UcpathTerminationStaging> {
  assertCurrent();
  await page.goto(WIZARD_URL, { waitUntil: "domcontentloaded", timeout: STEP_BOUND_MS });
  assertCurrent();
  recordBrowserAction("opened", "ucpath.smart-hr.wizard");
  assertCurrent();
  await waitForUcpathState(assertCurrent, page, UCPATH_SMART_HR_SETUP_READY);
  assertCurrent();
  await resolveUcpathElement(page, UCPATH_SMART_HR_TEMPLATE_INPUT).fill(input.template);
  assertCurrent();
  recordBrowserAction("typed", UCPATH_SMART_HR_TEMPLATE_INPUT, input.template);
  assertCurrent();
  await resolveUcpathElement(page, UCPATH_SMART_HR_TRANSACTION_DATE_INPUT).fill(input.effectiveDate);
  assertCurrent();
  recordBrowserAction("typed", UCPATH_SMART_HR_TRANSACTION_DATE_INPUT, input.effectiveDate);
  assertCurrent();
  await resolveUcpathElement(page, UCPATH_SMART_HR_CREATE_TRANSACTION_BUTTON).click();
  assertCurrent();
  recordBrowserAction("clicked", UCPATH_SMART_HR_CREATE_TRANSACTION_BUTTON);
  assertCurrent();
  await waitForUcpathState(assertCurrent, page, UCPATH_SMART_HR_DETAILS_READY);

  assertCurrent();
  await resolveUcpathElement(page, UCPATH_SMART_HR_DETAILS_EID_INPUT).fill(input.emplId);
  assertCurrent();
  recordBrowserAction("typed", UCPATH_SMART_HR_DETAILS_EID_INPUT, input.emplId);
  assertCurrent();
  await page.keyboard.press("Tab");
  assertCurrent();
  recordBrowserAction("pressed", "ucpath.smart-hr.details-eid-tab");
  const nameDisplay = page.locator(DRIVER_ANCHOR.wizardPersonName);
  try {
    assertCurrent();
    await nameDisplay.waitFor({ state: "visible", timeout: STEP_BOUND_MS });
  } catch (error) {
    assertCurrent();

    throw new UcpathEmplIdNotRecognizedError({
      emplId: input.emplId,
      detail: `the name anchor rendered no visible node within ${String(STEP_BOUND_MS)}ms`,
      cause: error,
    });
  }
  assertCurrent();
  const observedName = (await nameDisplay.innerText()).trim();
  assertCurrent();
  const observedEmplRecord = await textOf(assertCurrent, page.locator(DRIVER_ANCHOR.wizardEmplRecord));
  if (observedEmplRecord.length === 0 || observedEmplRecord !== input.emplRecord) {
    throw new UcpathEmploymentRecordMismatchError(input.emplRecord, observedEmplRecord);
  }
  // The job effective date is disabled and derived by UCPath; inspect it without filling.
  const jobEffectiveDate = page.locator(DRIVER_ANCHOR.wizardJobEffectiveDate);
  assertCurrent();
  const observedEffectiveDate = await textOf(assertCurrent, jobEffectiveDate);
  if (observedEffectiveDate !== input.effectiveDate) {
    throw new Error(
      `UCPath derived job effective date ${JSON.stringify(observedEffectiveDate)} from the `
      + `transaction date this run entered (${input.effectiveDate}); the effective date is half the `
      + "permanent key, so a derived value that disagrees with the requested one refuses here rather "
      + "than filing a termination the idempotency probe never asked about",
    );
  }
  assertCurrent();
  const options = await readReasonOptions(assertCurrent, page);
  const reason = resolveReasonOption(options, input.reasonCode);
  assertCurrent();
  await resolveUcpathElement(page, UCPATH_SMART_HR_REASON_CODE_SELECT)
    .selectOption({ value: reason.value });
  assertCurrent();
  recordBrowserAction("selected", UCPATH_SMART_HR_REASON_CODE_SELECT, reason.value);
  assertCurrent();
  await resolveUcpathElement(page, UCPATH_SMART_HR_CONTINUE_BUTTON).click();
  assertCurrent();
  recordBrowserAction("clicked", UCPATH_SMART_HR_CONTINUE_BUTTON);
  assertCurrent();
  await waitForUcpathState(assertCurrent, page, UCPATH_SMART_HR_INFORMATION_READY);

  const override = resolveUcpathElement(page, UCPATH_SMART_HR_OVERRIDE_LDW_CHECKBOX);
  // UCPath can pre-check the override and prefill transaction date minus one day; verify before changing either.
  assertCurrent();
  if (!await override.isChecked()) {
    assertCurrent();
    await override.check();
    assertCurrent();
    recordBrowserAction("checked", UCPATH_SMART_HR_OVERRIDE_LDW_CHECKBOX);
  }
  const ldw = resolveUcpathElement(page, UCPATH_SMART_HR_LAST_DATE_WORKED_INPUT);
  assertCurrent();
  await ldw.fill(input.lastDateWorked);
  assertCurrent();
  recordBrowserAction("typed", UCPATH_SMART_HR_LAST_DATE_WORKED_INPUT, input.lastDateWorked);
  assertCurrent();
  await ldw.blur();
  assertCurrent();
  await resolveUcpathElement(page, UCPATH_SMART_HR_INITIATOR_COMMENTS_FIELD)
    .fill(input.initiatorComments);
  assertCurrent();
  recordBrowserAction("typed", UCPATH_SMART_HR_INITIATOR_COMMENTS_FIELD, input.initiatorComments);
  assertCurrent();
  await resolveUcpathElement(page, UCPATH_SMART_HR_TRANSACTION_COMMENTS_FIELD)
    .fill(input.initiatorComments);
  assertCurrent();
  recordBrowserAction("typed", UCPATH_SMART_HR_TRANSACTION_COMMENTS_FIELD, input.initiatorComments);
  assertCurrent();
  await waitForUcpathState(assertCurrent, page, UCPATH_SMART_HR_TERMINATION_STAGED);

  assertCurrent();
  const transactionIdDisplay = await textOf(assertCurrent, page.locator(DRIVER_ANCHOR.wizardTransactionIdDisplay));
  if (transactionIdDisplay !== "NEW") {
    throw new Error(
      `the staged Smart HR wizard displays Transaction ID ${JSON.stringify(transactionIdDisplay)} `
      + 'rather than "NEW"; a staged wizard that already carries a number is not a staged wizard',
    );
  }
  assertCurrent();
  const lastDateWorked = await ldw.inputValue();
  assertCurrent();
  const lastDateWorkedOverridden = await override.isChecked();
  assertCurrent();
  return UcpathTerminationStagingSchema.parse({
    stagedPageState: UCPATH_SMART_HR_TERMINATION_STAGED,
    emplId: input.emplId,
    observedName,
    observedEmplRecord,
    template: input.template,
    transactionDate: input.effectiveDate,
    effectiveDate: observedEffectiveDate,
    resolvedReasonOption: reason.label,
    observedReasonOptions: options.map((option) => option.label),
    lastDateWorked,
    lastDateWorkedOverridden,
    transactionIdDisplay: "NEW",
    observedAt,
  });
}



// The staged subject belongs to Page C; Page-B anchors cannot prove the page held at the fence.
export async function readStagedWizardSubjectOnPage(assertCurrent: () => void, page: Page): Promise<string> {
  assertCurrent();
  const name = await page.evaluate(() => {
    const cells = [...document.querySelectorAll("td")];
    const labels = cells.filter((cell) => (cell.textContent ?? "").trim() === "Name:");
    if (labels.length !== 1) return { state: "ambiguous" as const, labels: labels.length };
    let cursor = labels[0]?.nextElementSibling ?? null;
    while (cursor !== null) {
      const text = (cursor.textContent ?? "").trim();
      if (text.length > 0) return { state: "read" as const, name: text };
      cursor = cursor.nextElementSibling;
    }
    return { state: "empty" as const };
  });
  if (name.state === "ambiguous") {
    throw new Error(
      `the staged Smart HR page carries ${String(name.labels)} "Name:" labels; exactly one is `
      + "required to bind the subject, and a page that lost or duplicated it is not the page this "
      + "run staged",
    );
  }
  if (name.state === "empty") {
    throw new Error(
      'the staged Smart HR page renders a "Name:" label with no value beside it; there is no '
      + "subject on this page to bind the write to",
    );
  }
  assertCurrent();
  return name.name;
}

// Bind the name within the verified EID row; column-count drift must not rebind the person.
export async function readInProgressSubjectOnPage(assertCurrent: () => void, page: Page, emplId: Eid): Promise<string> {
  const names: string[] = [];
  assertCurrent();
  for (const row of await page.locator('tr[id^="trHR_TBH_EULST_VW$0_row"]').all()) {
    const eid = row.locator('span[id^="EMPLID$"]');
    assertCurrent();
    if (await eid.count() !== 1) {
      throw new Error("a Transactions in Progress row has no unique Person ID control");
    }
    assertCurrent();
    if ((await eid.innerText()).trim() !== emplId) continue;
    const name = row.locator('a[id^="NAME$"]');
    assertCurrent();
    if (await name.count() !== 1) {
      throw new Error(
        `a Transactions in Progress row for ${directIdentifierDisplay(emplId)} has no unique Name control`,
      );
    }
    assertCurrent();
    const text = (await name.innerText()).trim();
    if (text.length === 0) {
      throw new Error(
        `a Transactions in Progress row for ${directIdentifierDisplay(emplId)} rendered an empty Name`,
      );
    }
    names.push(text);
  }
  const normalized = new Set(names.map((name) => name.toLowerCase().split(/[\s,]+/u)
    .filter((token) => token.length > 0).sort().join(" ")));
  if (names.length === 0 || normalized.size !== 1) {
    throw new Error(
      `the Transactions in Progress grid renders ${String(names.length)} rows and ${String(normalized.size)} distinct names for Empl ID ${directIdentifierDisplay(emplId)}; exactly one subject is required to bind a sweep`,
    );
  }
  assertCurrent();
  return names[0];
}

type PendingSweepGridFacts = Omit<UcpathInProgressRow, "transactionId">;

export type PendingSweepGridJoin = Readonly<{
  candidateIndex: number;
  selected: UcpathInProgressRow;
}>;

// The in-progress grid has no T ID; join by a unique verified identity tuple, never DOM position.
export function joinPendingSweepGridRows(
  input: UcpathPendingSweepTarget,
  candidates: readonly PendingSweepGridFacts[],
): readonly PendingSweepGridJoin[] {
  if (candidates.length !== input.observedSet.eligible.length) {
    throw new Error(
      `Transactions in Progress exposed ${String(candidates.length)} eligible rows for ${directIdentifierDisplay(input.emplId)}, but the stable-id set authorizes `
      + `${String(input.observedSet.eligible.length)}; refusing before selection`,
    );
  }
  const tokenName = (name: string): string => name.toLowerCase().split(/[\s,]+/u)
    .filter((token) => token.length > 0).sort().join(" ");
  const joined = input.observedSet.eligible.map((authorized) => {
    const matches = candidates.flatMap((candidate, candidateIndex) =>
      candidate.emplId === authorized.emplId
      && candidate.effectiveDate === authorized.startDate
      && isUcpathTerminationAction(candidate.action)
      && isUcpathTerminationAction(authorized.action)
      && tokenName(candidate.displayedName) === tokenName(authorized.displayedName)
        ? [{ candidate, candidateIndex }]
        : []);
    if (matches.length !== 1) {
      throw new Error(
        `one stable transaction joined ${String(matches.length)} Transactions in Progress rows by EID, name, date and termination action; exactly one is required`,
      );
    }
    const match = matches[0];
    return {
      candidateIndex: match.candidateIndex,
      selected: {
        ...match.candidate,
        transactionId: authorized.transactionId,
      },
    };
  });
  if (new Set(joined.map(({ candidateIndex }) => candidateIndex)).size !== joined.length) {
    throw new Error(
      "two stable UCPath transaction ids joined the same Transactions in Progress row; refusing an ambiguous delete",
    );
  }
  return joined;
}

async function stagePendingTerminationSweepOnPage(
  assertCurrent: () => void,
  page: Page,
  input: UcpathPendingSweepTarget,
  observedAt: string,
): Promise<UcpathPendingSweepStaging> {

  assertCurrent();
  const current = await scanTerminationTransactionsOnPage(assertCurrent,
    page,
    { emplId: input.emplId },
    observedAt,
  );
  const verdict = ucpathPendingSweepVerdict(input, current);
  if (verdict.state !== "absent") {
    throw new Error(
      `the pre-selection UCPath transaction set for ${directIdentifierDisplay(input.emplId)} answered ${verdict.state}; `
      + "the exact machine-observed pending set changed or is already gone, so no checkbox may be selected",
    );
  }
  assertCurrent();
  await page.goto(WIZARD_URL, { waitUntil: "domcontentloaded", timeout: STEP_BOUND_MS });
  assertCurrent();
  recordBrowserAction("opened", "ucpath.smart-hr.wizard");
  assertCurrent();
  await waitForUcpathState(assertCurrent, page, UCPATH_SMART_HR_SETUP_READY);
  const text = async (row: Locator, selector: string, field: string): Promise<string> => {
    const matches = row.locator(selector);
    assertCurrent();
    const count = await matches.count();
    if (count !== 1) {
      throw new Error(
        `a Transactions in Progress row exposed ${String(count)} ${field} controls; exactly one is required for an exact-set join`,
      );
    }
    assertCurrent();
    const value = (await matches.innerText()).trim();
    if (value.length === 0) throw new Error(`a Transactions in Progress row rendered an empty ${field}`);
    assertCurrent();
    return value;
  };
  const gridRows = page.locator('tr[id^="trHR_TBH_EULST_VW$0_row"]');
  const candidates: Array<Readonly<{
    facts: Omit<UcpathInProgressRow, "transactionId">;
    checkbox: Locator;
  }>> = [];
  assertCurrent();
  for (const row of await gridRows.all()) {
    assertCurrent();
    const emplId = EidSchema.parse(await text(row, 'span[id^="EMPLID$"]', "Person ID"));
    assertCurrent();
    const action = await text(row, 'span[id^="ACTION$"]', "Action");
    if (emplId !== input.emplId || !isUcpathTerminationAction(action)) continue;
    const checkbox = row.locator('input[type="checkbox"][id^="SELECT$"]');
    assertCurrent();
    if (await checkbox.count() !== 1) {
      throw new Error(
        `a Transactions in Progress row for ${directIdentifierDisplay(input.emplId)} has no unique Select checkbox; refusing before selection`,
      );
    }
    assertCurrent();
    candidates.push({
      facts: {
        transactionType: await text(row, 'span[id^="TBH_TMPL_TXN_TYP$"]', "Transaction Type"),
        effectiveDate: await text(row, 'span[id^="EFFDT$"]', "Effective Date"),
        displayedName: await text(row, 'a[id^="NAME$"]', "Name"),
        emplId,
        action,
        country: await text(row, 'span[id^="COUNTRY$"]', "Country"),
      },
      checkbox,
    });
  }
  const joined = joinPendingSweepGridRows(input, candidates.map(({ facts }) => facts));
  const selected = joined.map(({ selected: row }) => row);
  for (const { candidateIndex } of joined) {
    assertCurrent();
    await candidates[candidateIndex].checkbox.check();
    assertCurrent();
    recordBrowserAction("checked", "ucpath.smart-hr.pending-transaction");
  }
  for (const { candidateIndex } of joined) {
    const candidate = candidates[candidateIndex];
    assertCurrent();
    if (!(await candidate.checkbox.isChecked())) {
      throw new Error("a uniquely joined Transactions in Progress checkbox did not remain selected; refusing before the fence");
    }
  }

  assertCurrent();
  const observedName = await readInProgressSubjectOnPage(assertCurrent, page, input.emplId);
  assertCurrent();
  return UcpathPendingSweepStagingSchema.parse({
    stagedPageState: UCPATH_SMART_HR_TERMINATION_STAGED,
    emplId: input.emplId,
    observedName,
    selected,
    observedAt,
  });
}

// Watch for explicit refusal; an absent refusal is not proof that the write landed.
const COMMIT_REFUSAL_OBSERVE_MS = 10_000;


type CommitRefusalObservation =
  | Readonly<{ state: "refused"; message: string }>
  | Readonly<{ state: "no-refusal-rendered" }>;

async function observeCommitRefusal(assertCurrent: () => void, page: Page): Promise<CommitRefusalObservation> {
  const banner = page.locator(DRIVER_ANCHOR.errorBanner).filter({ hasText: /\S/u }).first();
  try {
    assertCurrent();
    await banner.waitFor({ state: "visible", timeout: COMMIT_REFUSAL_OBSERVE_MS });
  } catch (error) {
    assertCurrent();
    if (error instanceof Error && error.name === "TimeoutError") {
      assertCurrent();
      return { state: "no-refusal-rendered" };
    }
    throw error;
  }
  assertCurrent();
  const message = (await banner.innerText()).trim();
  if (message.length === 0) {

    throw new Error(
      "UCPath rendered a non-empty error region after the commit click and then emptied it before "
      + "it could be read; the submit's outcome is unobserved",
    );
  }
  assertCurrent();
  return { state: "refused", message };
}

/** The two commit controls, and nothing else, behind an unforgeable token. */
async function commitOnPage(
  assertCurrent: () => void,
  page: Page,
  id: ElementId,
  capability: MutationCapability,
): Promise<UiActionProof> {
  assertMintedMutationCapability(capability);
  if (id !== UCPATH_SMART_HR_SAVE_AND_SUBMIT_BUTTON && id !== UCPATH_SMART_HR_DELETE_SELECTED_BUTTON) {
    throw new Error(`the UCPath driver refuses to commit through ${String(id)}`);
  }
  const locator = resolveUcpathElement(page, id);
  assertCurrent();
  await locator.waitFor({ state: "visible", timeout: STEP_BOUND_MS });
  assertCurrent();
  await locator.click();
  assertCurrent();
  recordBrowserAction("clicked", id);

  assertCurrent();
  const refusal = await observeCommitRefusal(assertCurrent, page);
  if (refusal.state === "refused") {
    throw new UcpathCommitRefusedError({ elementId: id, refusal: refusal.message });
  }
  assertCurrent();
  return UiActionProofSchema.parse({ elementId: id, effect: "external-commit", performed: true });
}

export interface UcpathSmartHrOperations {
  readonly scanTerminationTransactions: typeof scanTerminationTransactionsOnPage;
  readonly stageTermination: typeof stageTerminationOnPage;
  readonly stagePendingTerminationSweep: typeof stagePendingTerminationSweepOnPage;
  readonly commit: typeof commitOnPage;
}

export const ucpathSmartHrOperations: UcpathSmartHrOperations = Object.freeze({
  scanTerminationTransactions: scanTerminationTransactionsOnPage,
  stageTermination: stageTerminationOnPage,
  stagePendingTerminationSweep: stagePendingTerminationSweepOnPage,
  commit: commitOnPage,
});

export function nowIso(clock: Clock): string {
  return IsoInstantSchema.parse(clock.now().toISOString());
}
