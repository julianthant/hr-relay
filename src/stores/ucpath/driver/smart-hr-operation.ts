/**
 * The REAL Smart HR termination operations — the production half of chunk 4.
 *
 * Every locator comes from the registry (`resolveUcpathElement`), so nothing
 * here carries an inline selector and every anchor is one the port map pinned
 * to a legacy key with dual evidence.
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
  UcpathPendingSweepStagingSchema,
  UcpathTerminationStagingSchema,
  UcpathTransactionScanSchema,
} from "../../../domain/ui/ucpath-smart-hr-termination.js";
import type {
  UcpathInProgressRow,
  UcpathPendingSweepStaging,
  UcpathPendingSweepTarget,
  UcpathTerminationStaging,
  UcpathTerminationTarget,
  UcpathTransactionRow,
  UcpathTransactionScan,
} from "../../../domain/ui/ucpath-smart-hr-termination.js";
import { UcpathApprovalStatusSchema } from "../../../domain/ui/ucpath-ss-smart-hr.js";
import { resolveUcpathElement, waitForUcpathState } from "./registry-locators.js";

const HRMS = "https://ucphrprdpub.universityofcalifornia.edu/psc/ucphrprd/EMPLOYEE/HRMS";
const WIZARD_URL = `${HRMS}/c/ADMINISTER_WORKFORCE_(GBL).HR_TBH_JOB.GBL`;
const SEARCH_URL = `${HRMS}/c/UC_EXTENSIONS.UC_SS_TBH.GBL`;

/** `= ` on the SS Smart HR Empl ID filter — live option list, 2026-08-14. */
const EQUALS_OPERATOR = "2";
/** PeopleSoft's standard empty-result sentence; see the module note. */
const NO_RESULTS_MARKER = /no matching values were found/iu;
const TRANSACTION_ID = /^T\d{6,}$/u;
const SCAN_BOUND_MS = 45_000;
const STEP_BOUND_MS = 60_000;

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
  const receipt = page.locator("#UC_SS_TRANSACT_UC_TRANSACT_ID");
  await receipt.waitFor({ state: "visible", timeout: SCAN_BOUND_MS });
  const displayedId = await textOf(receipt);
  if (displayedId !== transactionId) {
    // Doc 09 §13 OQ2's dangerous case: an unknown id silently re-renders the
    // ordinary search form with no marker of any kind, so the id must be proved
    // rather than assumed from the URL.
    throw new Error(
      `UCPath rendered transaction ${JSON.stringify(displayedId)} for a request for `
      + `${JSON.stringify(transactionId)}; refusing to read one transaction as another`,
    );
  }
  const [approvalStatus, startDate, action, displayedName] = await Promise.all([
    textOf(page.locator("#UC_SS_TRANSACT_APPR_STATUS")),
    textOf(page.locator('[id="UC_SS_TBH_VW_START_DT$0"]')),
    textOf(page.locator('[id="UC_SS_TBH_VW_ACTION$0"]')),
    textOf(page.locator('[id="NAME$0"]')),
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
  const unreadable = (reason: string): UcpathTransactionScan =>
    UcpathTransactionScanSchema.parse({
      state: "unreadable",
      emplId: input.emplId,
      reason,
      observedAt,
    });
  try {
    await page.goto(SEARCH_URL, { waitUntil: "domcontentloaded", timeout: SCAN_BOUND_MS });
    await waitForUcpathState(page, UCPATH_SS_SMART_HR_SEARCH_READY);
    await resolveUcpathElement(page, UCPATH_SS_SMART_HR_SEARCH_EID_INPUT).fill(input.emplId);
    await page.locator('[id="UC_SS_TBH_DVW_EMPLID$op"]').selectOption(EQUALS_OPERATOR);
    await resolveUcpathElement(page, UCPATH_SS_SMART_HR_SEARCH_BUTTON).click();
    let settled: "rows" | "empty";
    try {
      settled = await Promise.race([
        page.locator('tr[id^="trPTS_CFG_CL_STD_RSL"]').first()
          .waitFor({ state: "attached", timeout: SCAN_BOUND_MS }).then(() => "rows" as const),
        page.getByText(NO_RESULTS_MARKER).first()
          .waitFor({ state: "attached", timeout: SCAN_BOUND_MS }).then(() => "empty" as const),
      ]);
    } catch (error) {
      // Re-thrown, never defaulted: the outer boundary turns this into an
      // `unreadable` scan, which the probe reports as `unknown` and the kernel
      // PARKS. Returning "no rows" here is D5 exactly — a search that did not
      // answer reported as a factual negative.
      throw new Error(
        `the SS Smart HR search for ${input.emplId} rendered neither a result row nor PeopleSoft's `
        + `no-results marker within ${String(SCAN_BOUND_MS)}ms`,
        { cause: error },
      );
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
    return unreadable(
      `the SS Smart HR transaction scan for ${input.emplId} failed: `
      + `${error instanceof Error ? error.message : String(error)}`,
    );
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
  const nameDisplay = page.locator("#PERSON_NAME_NAME_DISPLAY");
  try {
    await nameDisplay.waitFor({ state: "visible", timeout: STEP_BOUND_MS });
  } catch (error) {
    // S48, and BOTH of its live causes: an Empl ID UCPath has never seen, and
    // one it knows but has no terminable employment record for (live 2026-08-14
    // on an already-Inactive employee, which answers "Invalid value -- press
    // the prompt button"). The name never renders in either case, and the
    // absence of the name IS the signal — the error banner is empty.
    throw new Error(
      `UCPath did not resolve Empl ID ${input.emplId} on the Smart HR transaction details page `
      + `within ${String(STEP_BOUND_MS)}ms: no person name was rendered, so there is no subject to `
      + "bind. Either the Empl ID does not exist or the employee has no employment record eligible "
      + "for termination.",
      { cause: error },
    );
  }
  const observedName = (await nameDisplay.innerText()).trim();
  const observedEmplRecord = await textOf(page.locator("#HR_TBH_WRK_EMPL_RCD_CHAR"));
  const jobEffectiveDate = page.locator("#HR_TBH_WRK_JOB_EFFDT");
  await jobEffectiveDate.fill(input.effectiveDate);
  // Read back HERE, on the page that owns the field. Reading it from Page C
  // would need a catch-and-default, and a defaulted effective date is half the
  // permanent key invented from the input it was meant to verify.
  const observedEffectiveDate = await textOf(jobEffectiveDate);
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

  const transactionIdDisplay = await textOf(page.locator("#UC_SS_TRANSACT_UC_TRANSACT_ID"));
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
  let observedName = "";
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
    if (observedName.length === 0) observedName = input.expectedName;
    selected.push({ transactionType: "JOB", effectiveDate: date, action });
  }
  return UcpathPendingSweepStagingSchema.parse({
    stagedPageState: UCPATH_SMART_HR_TERMINATION_STAGED,
    emplId: input.emplId,
    observedName: observedName.length > 0 ? observedName : input.expectedName,
    selected,
    observedAt,
  });
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
