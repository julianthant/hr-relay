/**
 * The REAL Smart HR termination operations — the production half of chunk 4.
 *
 * ## Where the anchors come from — registry FIRST, and a declared exception
 *
 * Every anchor a registry element covers is resolved through the registry
 * (`resolveUcpathElement`), so it carries a legacy port-map row and dual
 * evidence. The rest are declared ONCE in `DRIVER_ANCHOR` below, each with the
 * reason it cannot be a registry element — because `ElementDefinitionSchema`
 * REQUIRES `provenance: LegacySelectorProvenanceSchema`, and legacy has no key
 * for these controls at all. Publishing a registry row for one of them would be
 * a fabricated provenance, which is exactly what the `semantic-ui-registry`
 * guard exists to prevent (the same rule `new-kronos` applied to its grid, and
 * the reason `#PERSON_NAME_NAME_DISPLAY` is driver-internal).
 *
 * This module previously CLAIMED every anchor was registry-pinned while binding
 * eight of them inline; the claim is now the table, so it can be read and
 * checked. The `inline-selectors` ratchet does not reach a store's `driver`
 * directory — see its scope note in `tests/unit/architecture/helpers/ratchet-arms.ts` and
 * ref guards-and-tests §3 for why widening it would fire on the registry interpreters
 * themselves.
 *
 * ## The one deliberate asymmetry: the grid is read for IDS ONLY
 *
 * `scanTerminationTransactions` takes the SS Smart HR results grid for exactly
 * one thing — the set of `T…` transaction ids — and then reads every other fact
 * off each transaction's DETAIL page, which carries a stable id per field.
 *
 * That is D205's lesson applied before it could bite. The results grid renders
 * seven unlabelled columns whose header row this repository could not read
 * live, so binding `action`/`status`/`name` by cell POSITION would be a
 * hardcoded offset wearing a different hat — internally consistent and
 * externally wrong the first time PeopleSoft reorders a column. A `T…` id is
 * unambiguous by shape and needs no column at all; everything else is read from
 * `#UC_SS_TRANSACT_*` / `#UC_SS_TBH_VW_*`, each live-verified at exactly one
 * node (2026-08-14).
 *
 * ## Refusals are `unreadable`, never an empty list
 *
 * The scan returns `{state:"unreadable", reason}` rather than throwing or
 * returning `[]` when it cannot establish what the page holds. That is what
 * makes the probe's `unknown` arm reachable, and `unknown` parks — dangerous
 * patterns D5/D6, which are how legacy turns "the search timed out" into "this
 * person has no termination" and files a duplicate.
 *
 * The empty case is only ever reported after PeopleSoft's own no-results marker
 * is observed. If neither rows nor that marker appear within the bound the
 * answer is `unreadable`, so a wrong guess about the marker's exact wording can
 * only ever over-refuse — it can never manufacture a false absence.
 */
import type { Locator, Page } from "playwright";
import type { Clock } from "../../../domain/clock.js";
import { IsoInstantSchema } from "../../../domain/ids.js";
import type { Eid, ElementId } from "../../../domain/ids.js";
import { assertMintedMutationCapability } from "../../../base/mutation-capability.js";
import { UiActionProofSchema } from "../../../domain/ui/driver.js";
import type { MutationCapability, UiActionProof } from "../../../domain/ui/driver.js";
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
  UcpathPendingSweepStagingSchema,
  UcpathSsSmartHrSettlementDiagnosticSchema,
  UcpathTerminationStagingSchema,
  UcpathTransactionScanSchema,
} from "../../../domain/ui/ucpath-smart-hr-termination.js";
import type {
  UcpathInProgressRow,
  UcpathPendingSweepStaging,
  UcpathPendingSweepTarget,
  UcpathSsSmartHrSettlementDiagnostic,
  UcpathTerminationStaging,
  UcpathTerminationTarget,
  UcpathTransactionRow,
  UcpathTransactionScan,
} from "../../../domain/ui/ucpath-smart-hr-termination.js";
import {
  UCPATH_SS_SMART_HR_APPROVAL_STATUS_DISPLAY,
  UCPATH_SS_SMART_HR_RECEIPT_DISPLAY,
  UcpathApprovalStatusSchema,
} from "../../../domain/ui/ucpath-ss-smart-hr.js";
import {
  resolveUcpathElement,
  ucpathElementById,
  waitForUcpathState,
} from "./registry-locators.js";

/**
 * The anchors this driver binds DIRECTLY, and the reason each one is not a
 * registry element.
 *
 * Every entry here is a control **legacy has no selector key for**, so the
 * registry — whose `ElementDefinitionSchema` requires a ported legacy
 * provenance — cannot hold it without inventing one. The alternative to this
 * table is not a registry row; it is a bare string at the call site, which is
 * what this module used to have while its header claimed otherwise.
 *
 * The one exception with a legacy key is `errorBanner`, whose port-map row is
 * still `candidate`: its recipe is ported verbatim WITH provenance below, but it
 * cannot be published as a registry element because the manifest's contract is
 * exactly-one-visible and this region matched **zero** nodes on a clean Page B
 * and Page C (live 2026-08-14). An element nobody can prove resolves is not
 * evidence, so it stays here, where its absence is a legal reading.
 */
const DRIVER_ANCHOR = Object.freeze({
  /**
   * Page B's rendering of who UCPath resolved the typed Empl ID to — the
   * beat-③ subject anchor and the S48 signal, both being the same check.
   * `UCPATH_SMART_HR_DISPLAYED_PERSON_NAME` documents why it is driver-internal:
   * `PERSON_NAME_NAME_DISPLAY` appears only in legacy's Person Profile and
   * PayPath groups, never in the termination flow it never reads a name in.
   */
  wizardPersonName: "#PERSON_NAME_NAME_DISPLAY",
  /** Page B's Empl Record display. No legacy key; live 2026-08-14. */
  wizardEmplRecord: "#HR_TBH_WRK_EMPL_RCD_CHAR",
  /**
   * Page B's JOB effective date, which UCPath DERIVES from the Page-A
   * transaction date and renders `disabled` (`PSEDITBOX_DISABLED`). No legacy
   * key; it is read and checked rather than filled — see the call site.
   */
  wizardJobEffectiveDate: "#HR_TBH_WRK_JOB_EFFDT",
  /**
   * Page C's Transaction ID display, which reads the literal `"NEW"` until a
   * save. PeopleSoft renders the SAME record-field id here as on the SS Smart
   * HR transaction DETAIL page, but that is a different screen with a different
   * page state, so binding `UCPATH_SS_SMART_HR_RECEIPT_DISPLAY` here would make
   * a registry element claim a screen this page is not.
   */
  wizardTransactionIdDisplay: "#UC_SS_TRANSACT_UC_TRANSACT_ID",
  /**
   * The SS Smart HR search filter's OPERATOR dropdown (`2` = `=`). Legacy's
   * `ssSmartHRTransactions.emplIdInput()` binds the VALUE field beside it and
   * has no key for the operator at all — legacy never sets it, which is why its
   * search runs on PeopleSoft's `begins with` default.
   */
  searchEmplIdOperator: '[id="UC_SS_TBH_DVW_EMPLID$op"]',
  /**
   * PeopleSoft's standard search-criteria banner. The SS Smart HR list showed
   * it with a positive count in both read-only probes on 2026-08-28; the
   * diagnostic classifies its text and never returns the text itself.
   */
  searchCriteriaBanner: "#PTS_CRITTEXT_DISP",
  /** PeopleSoft's standard result-row id prefix. A WAIT target, never a read. */
  searchResultRow: 'tr[id^="trPTS_CFG_CL_STD_RSL"]',
  /** Transaction detail: start date. No legacy key (legacy reads neither). */
  detailStartDate: '[id="UC_SS_TBH_VW_START_DT$0"]',
  /** Transaction detail: action code. No legacy key. */
  detailAction: '[id="UC_SS_TBH_VW_ACTION$0"]',
  /**
   * Transaction detail: the subject's name. No legacy key — legacy scrapes this
   * page for a number and a status and never reads who it belongs to, which is
   * the absence `UCPATH_SS_SMART_HR_DISPLAYED_NAME` records.
   */
  detailName: '[id="NAME$0"]',
  /**
   * PeopleSoft's error region, ported VERBATIM from legacy
   * `793abe1f8265f3213ffe8a80d6cfd9860a32a1dc`
   * `src/systems/ucpath/selectors.ts:135` (`smartHR.errorBanner()`), with the
   * frame scope dropped because every page in this family renders zero iframes.
   * Live 2026-08-14: `.PSERROR` is PRESENT and EMPTY on a clean page, so the
   * observation below requires non-empty TEXT — presence alone is not a signal.
   */
  errorBanner: ".PSERROR, #ALERTMSG, .ps_alert-error",
});

const HRMS = "https://ucphrprdpub.universityofcalifornia.edu/psc/ucphrprd/EMPLOYEE/HRMS";
const WIZARD_URL = `${HRMS}/c/ADMINISTER_WORKFORCE_(GBL).HR_TBH_JOB.GBL`;
const SEARCH_URL = `${HRMS}/c/UC_EXTENSIONS.UC_SS_TBH.GBL`;

/** `= ` on the SS Smart HR Empl ID filter — live option list, 2026-08-14. */
const EQUALS_OPERATOR = "2";
/** PeopleSoft's standard empty-result sentence; see the module note. */
const NO_RESULTS_MARKER = /no matching values were found/iu;
const TRANSACTION_ID = /^T\d{6,}$/u;
const SCAN_BOUND_MS = 45_000;
// The diagnostic callback performs only synchronous DOM reads. One second is
// the smallest practical allowance for scheduling it on an already-loaded,
// potentially distressed PeopleSoft page without extending the scan forever.
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
    return await Promise.race([
      page.evaluate(captureSsSmartHrSettlementDiagnostic, selectors),
      diagnosticTimedOut,
    ]);
  } finally {
    cancelBound();
  }
}

function detailUrl(transactionId: string): string {
  return `${SEARCH_URL}?Action=U&UC_TRANSACT_ID=${transactionId}`;
}

/**
 * Read one control's displayed value.
 *
 * PeopleSoft renders the same fact as an `<input>` on an editable page and a
 * `<span>` on a read-only one, so the read BRANCHES on what the node is rather
 * than trying `inputValue()` and catching. A catch here would make "this
 * element is a span" indistinguishable from "the read failed", which is the
 * exact substitution the fail-loud rule forbids.
 */
async function textOf(locator: Locator): Promise<string> {
  const isFormControl = await locator.evaluate(
    (node) => node instanceof HTMLInputElement
      || node instanceof HTMLTextAreaElement
      || node instanceof HTMLSelectElement,
  );
  const value = isFormControl ? await locator.inputValue() : await locator.innerText();
  return value.trim();
}

/**
 * Every distinct `T…` on the results page.
 *
 * Reading them off the whole results region rather than a column index is
 * deliberate: the id's SHAPE identifies it, so no column binding is needed and
 * a reordered grid cannot silently shift the read.
 */
async function scanTransactionIds(page: Page): Promise<readonly string[]> {
  const text = await page.locator("body").innerText();
  return [...new Set(text.match(/T\d{6,}/gu) ?? [])].filter((id) => TRANSACTION_ID.test(id));
}

async function readTransactionDetail(
  page: Page,
  transactionId: string,
  emplId: Eid,
): Promise<UcpathTransactionRow> {
  await page.goto(detailUrl(transactionId), { waitUntil: "domcontentloaded", timeout: SCAN_BOUND_MS });
  const receipt = resolveUcpathElement(page, UCPATH_SS_SMART_HR_RECEIPT_DISPLAY);
  await receipt.waitFor({ state: "visible", timeout: SCAN_BOUND_MS });
  const displayedId = await textOf(receipt);
  if (displayedId !== transactionId) {
    // Ref write-safety §13 OQ2's dangerous case: an unknown id silently re-renders the
    // ordinary search form with no marker of any kind, so the id must be proved
    // rather than assumed from the URL.
    throw new Error(
      `UCPath rendered transaction ${JSON.stringify(displayedId)} for a request for `
      + `${JSON.stringify(transactionId)}; refusing to read one transaction as another`,
    );
  }
  const [approvalStatus, startDate, action, displayedName] = await Promise.all([
    textOf(resolveUcpathElement(page, UCPATH_SS_SMART_HR_APPROVAL_STATUS_DISPLAY)),
    textOf(page.locator(DRIVER_ANCHOR.detailStartDate)),
    textOf(page.locator(DRIVER_ANCHOR.detailAction)),
    textOf(page.locator(DRIVER_ANCHOR.detailName)),
  ]);
  return {
    transactionId,
    // The EID is supplied by the CALLER's own filter rather than scraped: this
    // page is reached from an `Empl ID = <eid>` search, so the filter is the
    // stronger fact, and the identity check that matters is the displayed NAME
    // — which the probe compares against the approved subject. Reading an EID
    // cell here and falling back when it is missing would be a second, quieter
    // source of truth for the same fact.
    emplId,
    action,
    approvalStatus: UcpathApprovalStatusSchema.parse(approvalStatus),
    startDate,
    displayedName,
  };
}

export async function scanTerminationTransactionsOnPage(
  page: Page,
  input: Readonly<{ emplId: Eid }>,
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
    `the SS Smart HR transaction scan for ${input.emplId} failed: `
    + `${error instanceof Error ? error.message : String(error)}`;
  try {
    await page.goto(SEARCH_URL, { waitUntil: "domcontentloaded", timeout: SCAN_BOUND_MS });
    await waitForUcpathState(page, UCPATH_SS_SMART_HR_SEARCH_READY);
    await resolveUcpathElement(page, UCPATH_SS_SMART_HR_SEARCH_EID_INPUT).fill(input.emplId);
    await page.locator(DRIVER_ANCHOR.searchEmplIdOperator).selectOption(EQUALS_OPERATOR);
    await resolveUcpathElement(page, UCPATH_SS_SMART_HR_SEARCH_BUTTON).click();
    let settled: "rows" | "empty";
    try {
      settled = await Promise.race([
        page.locator(DRIVER_ANCHOR.searchResultRow).first()
          .waitFor({ state: "attached", timeout: SCAN_BOUND_MS }).then(() => "rows" as const),
        page.getByText(NO_RESULTS_MARKER).first()
          .waitFor({ state: "attached", timeout: SCAN_BOUND_MS }).then(() => "empty" as const),
      ]);
    } catch (error) {
      if (!(error instanceof Error && error.name === "TimeoutError")) {
        throw error;
      }
      // Only the settlement race rejecting with its actual Playwright timeout
      // authorizes this diagnostic. A page/context failure re-throws above so
      // the outer boundary preserves that failure as unreadable/not-attempted.
      // Returning "no rows" here is D5 exactly — a search that did not answer
      // reported as a factual negative.
      const settlementError = new Error(
        `the SS Smart HR search for ${input.emplId} rendered neither a result row nor PeopleSoft's `
        + `no-results marker within ${String(SCAN_BOUND_MS)}ms`,
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
        diagnostic = UcpathSsSmartHrSettlementDiagnosticSchema.parse(
          await evaluateSsSmartHrSettlementDiagnostic(page, {
            criteriaBanner: DRIVER_ANCHOR.searchCriteriaBanner,
            resultRow: DRIVER_ANCHOR.searchResultRow,
            errorRegion: DRIVER_ANCHOR.errorBanner,
            searchButton: searchButton.selector,
          },
        ));
      } catch {
        diagnostic = SETTLEMENT_CAPTURE_FAILED;
      }
      return unreadable(failureReason(settlementError), diagnostic);
    }
    if (settled === "empty") {
      return UcpathTransactionScanSchema.parse({
        state: "read",
        emplId: input.emplId,
        rows: [],
        scannedRowCount: 0,
        observedAt,
      });
    }
    const ids = await scanTransactionIds(page);
    const rows: UcpathTransactionRow[] = [];
    for (const id of ids) rows.push(await readTransactionDetail(page, id, input.emplId));
    return UcpathTransactionScanSchema.parse({
      state: "read",
      emplId: input.emplId,
      rows,
      scannedRowCount: ids.length,
      observedAt,
    });
  } catch (error) {
    return unreadable(failureReason(error), NOT_INDETERMINATE_SETTLEMENT);
  }
}

/**
 * Resolve one authored reason against the control's OWN options, by option
 * VALUE or option LABEL, requiring exactly one match.
 *
 * Both forms are live-verified to name the same option (`NSE` /
 * `Never Started Employment`), and the map holds fifteen labels plus one value
 * because that is how each was captured. This is a lookup that must resolve
 * uniquely — never a fuzzy tier: zero or many matches refuse with the whole
 * observed list.
 */
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
  page: Page,
): Promise<readonly { readonly value: string; readonly label: string }[]> {
  const raw = await resolveUcpathElement(page, UCPATH_SMART_HR_REASON_CODE_SELECT)
    .evaluate((node) => [...(node as HTMLSelectElement).options].map(
      (option) => ({ value: option.value, label: option.text.trim() }),
    ));
  return raw.filter((option) => option.value.length > 0);
}

export async function stageTerminationOnPage(
  page: Page,
  input: UcpathTerminationTarget,
  observedAt: string,
): Promise<UcpathTerminationStaging> {
  await page.goto(WIZARD_URL, { waitUntil: "domcontentloaded", timeout: STEP_BOUND_MS });
  await waitForUcpathState(page, UCPATH_SMART_HR_SETUP_READY);
  await resolveUcpathElement(page, UCPATH_SMART_HR_TEMPLATE_INPUT).fill(input.template);
  await resolveUcpathElement(page, UCPATH_SMART_HR_TRANSACTION_DATE_INPUT).fill(input.effectiveDate);
  await resolveUcpathElement(page, UCPATH_SMART_HR_CREATE_TRANSACTION_BUTTON).click();
  await waitForUcpathState(page, UCPATH_SMART_HR_DETAILS_READY);

  await resolveUcpathElement(page, UCPATH_SMART_HR_DETAILS_EID_INPUT).fill(input.emplId);
  await page.keyboard.press("Tab");
  const nameDisplay = page.locator(DRIVER_ANCHOR.wizardPersonName);
  try {
    await nameDisplay.waitFor({ state: "visible", timeout: STEP_BOUND_MS });
  } catch (error) {
    // S48, and BOTH of its live causes: an Empl ID UCPath has never seen, and
    // one it knows but has no terminable employment record for (live 2026-08-14
    // on an already-Inactive employee, which answers "Invalid value -- press
    // the prompt button"). The name never renders in either case, and the
    // absence of the name IS the signal — the error banner is empty.
    //
    // The TYPE is what makes the contract's `emplid-not-recognized` reachable:
    // a bare `Error` here is indistinguishable from a page crash, so the task
    // could only report it as an untyped failure.
    throw new UcpathEmplIdNotRecognizedError({
      emplId: input.emplId,
      detail: `the name anchor rendered no visible node within ${String(STEP_BOUND_MS)}ms`,
      cause: error,
    });
  }
  const observedName = (await nameDisplay.innerText()).trim();
  const observedEmplRecord = await textOf(page.locator(DRIVER_ANCHOR.wizardEmplRecord));
  // The JOB effective date is DISPLAY-ONLY on Page B: UCPath derives it from
  // the transaction date entered on Page A and renders it `disabled`
  // (live 2026-08-14 — filling it times out against `PSEDITBOX_DISABLED`). So
  // it is READ and CHECKED, which is strictly stronger than writing it: it
  // proves UCPath derived the very date this run asked for, and half the
  // permanent key is therefore verified rather than asserted.
  const jobEffectiveDate = page.locator(DRIVER_ANCHOR.wizardJobEffectiveDate);
  const observedEffectiveDate = await textOf(jobEffectiveDate);
  if (observedEffectiveDate !== input.effectiveDate) {
    throw new Error(
      `UCPath derived job effective date ${JSON.stringify(observedEffectiveDate)} from the `
      + `transaction date this run entered (${input.effectiveDate}); the effective date is half the `
      + "permanent key, so a derived value that disagrees with the requested one refuses here rather "
      + "than filing a termination the idempotency probe never asked about",
    );
  }
  const options = await readReasonOptions(page);
  const reason = resolveReasonOption(options, input.reasonCode);
  await resolveUcpathElement(page, UCPATH_SMART_HR_REASON_CODE_SELECT)
    .selectOption({ value: reason.value });
  await resolveUcpathElement(page, UCPATH_SMART_HR_CONTINUE_BUTTON).click();
  await waitForUcpathState(page, UCPATH_SMART_HR_INFORMATION_READY);

  const override = resolveUcpathElement(page, UCPATH_SMART_HR_OVERRIDE_LDW_CHECKBOX);
  // Live 2026-08-14: UCPath renders this template with the override ALREADY
  // checked and the date pre-filled to (transaction date − 1 day). That is a
  // default, not the operator's answer, so the value is written and read back
  // either way — but the box is only clicked when it is genuinely unchecked.
  if (!await override.isChecked()) await override.check();
  const ldw = resolveUcpathElement(page, UCPATH_SMART_HR_LAST_DATE_WORKED_INPUT);
  await ldw.fill(input.lastDateWorked);
  await ldw.blur();
  await resolveUcpathElement(page, UCPATH_SMART_HR_INITIATOR_COMMENTS_FIELD)
    .fill(input.initiatorComments);
  await resolveUcpathElement(page, UCPATH_SMART_HR_TRANSACTION_COMMENTS_FIELD)
    .fill(input.initiatorComments);
  await waitForUcpathState(page, UCPATH_SMART_HR_TERMINATION_STAGED);

  const transactionIdDisplay = await textOf(page.locator(DRIVER_ANCHOR.wizardTransactionIdDisplay));
  if (transactionIdDisplay !== "NEW") {
    throw new Error(
      `the staged Smart HR wizard displays Transaction ID ${JSON.stringify(transactionIdDisplay)} `
      + 'rather than "NEW"; a staged wizard that already carries a number is not a staged wizard',
    );
  }
  return UcpathTerminationStagingSchema.parse({
    stagedPageState: UCPATH_SMART_HR_TERMINATION_STAGED,
    emplId: input.emplId,
    observedName,
    observedEmplRecord: observedEmplRecord.length > 0 ? observedEmplRecord : input.emplRecord,
    template: input.template,
    transactionDate: input.effectiveDate,
    effectiveDate: observedEffectiveDate,
    resolvedReasonOption: reason.label,
    observedReasonOptions: options.map((option) => option.label),
    lastDateWorked: await ldw.inputValue(),
    lastDateWorkedOverridden: await override.isChecked(),
    transactionIdDisplay: "NEW",
    observedAt,
  });
}

/**
 * Read the *Transactions in Progress* grid rows for one person, and tick the
 * Select checkbox of every `Terminat*` row.
 *
 * The grid's columns are `Select · Transaction Type · Effective Date · Name ·
 * Person ID · Action · Country` (live 2026-08-14) and it has NO transaction id
 * column, which is why a selected row is named by its effective date and
 * action. Row identity is established by the EID appearing in the row's own
 * text — the same test legacy uses (`rowMatchesTerminationEid`).
 */
/**
 * The name the *Transactions in Progress* grid shows for one person.
 *
 * The bind is RELATIVE to a value this read already knows exactly — the cell
 * whose text IS the Empl ID — and takes that cell's immediate predecessor,
 * which is the `Name` column in the live column order
 * (`Select · Transaction Type · Effective Date · Name · Person ID · Action ·
 * Country`, observed 2026-08-14). That is an anchored relative bind rather than
 * a fixed offset: it moves with the grid instead of assuming a column count,
 * and it refuses loudly when the anchor cell is absent.
 */
/**
 * The name the STAGED wizard page renders for the person being terminated.
 *
 * Beat ③ observes the page prepare LEFT BEHIND, and that is Page C — where
 * `#PERSON_NAME_NAME_DISPLAY` does not exist. The first live dry run refused
 * exactly there (zero fence, zero click), which is the check working: the
 * declaration named an anchor the staged page cannot render.
 *
 * Page C's identity block has no ids at all, but it IS labelled: the row reads
 * `Template: · UC_INVOL_TERM · Name: · Dreitho Cramia`, with the `Name:` label
 * and the value each appearing exactly once (live 2026-08-14). So the bind is
 * anchored on the LABEL and takes the next non-empty cell — the same shape this
 * tree already prefers over a positional offset, and it refuses loudly when the
 * label is absent or ambiguous rather than reading a neighbouring cell.
 */
export async function readStagedWizardSubjectOnPage(page: Page): Promise<string> {
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
  return name.name;
}

export async function readInProgressSubjectOnPage(page: Page, emplId: Eid): Promise<string> {
  const name = await page.evaluate((eid) => {
    for (const cell of document.querySelectorAll("td")) {
      if ((cell.textContent ?? "").trim() !== eid) continue;
      const previous = cell.previousElementSibling;
      const text = (previous?.textContent ?? "").trim();
      if (text.length > 0) return text;
    }
    return "";
  }, emplId);
  if (name.length === 0) {
    throw new Error(
      `the Transactions in Progress grid renders no name beside Empl ID ${emplId}; there is no `
      + "subject on this page to bind a sweep to",
    );
  }
  return name;
}

export async function stagePendingTerminationSweepOnPage(
  page: Page,
  input: UcpathPendingSweepTarget,
  observedAt: string,
): Promise<UcpathPendingSweepStaging> {
  await page.goto(WIZARD_URL, { waitUntil: "domcontentloaded", timeout: STEP_BOUND_MS });
  await waitForUcpathState(page, UCPATH_SMART_HR_SETUP_READY);
  const rows = page.locator("tr").filter({ hasText: input.emplId });
  const count = await rows.count();
  const selected: UcpathInProgressRow[] = [];
  for (let index = 0; index < count; index += 1) {
    const row = rows.nth(index);
    const text = (await row.innerText()).replace(/\s+/gu, " ").trim();
    if (!/terminat/iu.test(text)) continue;
    const date = /\b(\d{2}\/\d{2}\/\d{4})\b/u.exec(text)?.[1];
    const action = /\b(Terminat\w*)\b/u.exec(text)?.[1];
    if (date === undefined || action === undefined) {
      throw new Error(
        `a Transactions in Progress row for ${input.emplId} matched "Terminat" but rendered no `
        + `effective date and action this read could name: ${JSON.stringify(text)}`,
      );
    }
    const checkbox = row.locator('input[type="checkbox"]').first();
    if (await checkbox.count() === 0) {
      throw new Error(
        `a Transactions in Progress row for ${input.emplId} has no Select checkbox; refusing to `
        + "report a selection that was never made",
      );
    }
    await checkbox.check();
    selected.push({ transactionType: "JOB", effectiveDate: date, action });
  }
  // The OBSERVED name, read off the grid — never the expected one echoed back.
  // Prepare only runs when the probe answered `absent`, i.e. when rows exist,
  // so a grid with no name for this person is a contradiction and refuses.
  const observedName = await readInProgressSubjectOnPage(page, input.emplId);
  return UcpathPendingSweepStagingSchema.parse({
    stagedPageState: UCPATH_SMART_HR_TERMINATION_STAGED,
    emplId: input.emplId,
    observedName,
    selected,
    observedAt,
  });
}

/**
 * Watch for UCPath REFUSING the click, and never for it accepting one.
 *
 * D128's lesson, applied before it could bite a second time: a positive save
 * signal is worth nothing, so this deliberately has no success detector. The
 * only thing it can conclude is `refused`, and it concludes that only from a
 * POSITIVE observation — an error region carrying non-empty text. `.PSERROR` is
 * present and EMPTY on a clean page (live 2026-08-14), so presence alone would
 * report every successful submit as a refusal.
 *
 * The bound is a bound on OBSERVING, not a proof: PeopleSoft's save is a full
 * postback, so a banner that has not rendered yet must not read as "no banner"
 * forever. Under-detecting is the only failure mode this direction has, and it
 * costs nothing — an unobserved refusal leaves `performed: true`, which the
 * commit contract already labels a CLAIM that beat ⑥'s independent read-back is
 * what settles. Over-detecting is impossible: nothing here invents a banner.
 *
 * A NON-timeout error re-throws. "The page went away" and "the page rendered no
 * error" are two different facts and this must never collapse them.
 */
const COMMIT_REFUSAL_OBSERVE_MS = 10_000;

/**
 * What the driver SAW, which is not the same question as whether the write
 * landed. `refused` is a POSITIVE observation; `no-refusal-rendered` is
 * deliberately not a success signal and nothing promotes it. It is local to
 * this module on purpose — it crosses no boundary, so it is not a schema.
 */
type CommitRefusalObservation =
  | Readonly<{ state: "refused"; message: string }>
  | Readonly<{ state: "no-refusal-rendered" }>;

async function observeCommitRefusal(page: Page): Promise<CommitRefusalObservation> {
  const banner = page.locator(DRIVER_ANCHOR.errorBanner).filter({ hasText: /\S/u }).first();
  try {
    await banner.waitFor({ state: "visible", timeout: COMMIT_REFUSAL_OBSERVE_MS });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      return { state: "no-refusal-rendered" };
    }
    throw error;
  }
  const message = (await banner.innerText()).trim();
  if (message.length === 0) {
    // The filter matched non-whitespace and the read came back empty, so the
    // region changed under the read. That is not "no refusal" — it is a page
    // this driver could not observe, and post-fence it must park.
    throw new Error(
      "UCPath rendered a non-empty error region after the commit click and then emptied it before "
      + "it could be read; the submit's outcome is unobserved",
    );
  }
  return { state: "refused", message };
}

/** The two commit controls, and nothing else, behind an unforgeable token. */
export async function commitOnPage(
  page: Page,
  id: ElementId,
  capability: MutationCapability,
): Promise<UiActionProof> {
  assertMintedMutationCapability(capability);
  if (id !== UCPATH_SMART_HR_SAVE_AND_SUBMIT_BUTTON && id !== UCPATH_SMART_HR_DELETE_SELECTED_BUTTON) {
    throw new Error(`the UCPath driver refuses to commit through ${String(id)}`);
  }
  const locator = resolveUcpathElement(page, id);
  await locator.waitFor({ state: "visible", timeout: STEP_BOUND_MS });
  await locator.click();
  // The click is not the answer. Returning a proof unconditionally made both
  // commit contracts' refusal codes unreachable on a real page: a refusal
  // UCPath rendered in full was reported as a performed commit and left for the
  // verifier to discover as an absence.
  const refusal = await observeCommitRefusal(page);
  if (refusal.state === "refused") {
    throw new UcpathCommitRefusedError({ elementId: id, refusal: refusal.message });
  }
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
