import { readTransactionFindingsOnPage, scanTerminationTransactionsOnPage, textOf } from "./transaction-findings-operation.js";
export { readTransactionFindingsOnPage, scanTerminationTransactionsOnPage } from "./transaction-findings-operation.js";

import type { Locator, Page } from "playwright";
import { recordBrowserAction } from "../../browser-shared/action-notes.js";
import type { Clock } from "../../../../rules/time/clock.js";
import { EidSchema, IsoInstantSchema } from "../../../../rules/identity/ids.js";
import type { Eid, ElementId } from "../../../../rules/identity/ids.js";
import { directIdentifierDisplay } from "../../../../rules/redaction/redaction.js";
import { assertMintedMutationCapability, clickWithMutationCapability } from "../../../../workflow-kit/mutation-capability.js";
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
  UcpathCommitRefusedError,
  UcpathEmplIdNotRecognizedError,
  UcpathEmploymentRecordMismatchError,
  UcpathInProgressRowSchema,
  UcpathPendingSweepStagingSchema,
  UcpathTerminationStagingSchema,
  isUcpathTerminationAction,
} from "../../../../models/ui/ucpath-smart-hr-termination.js";
import type {
  UcpathInProgressRow,
  UcpathPendingSweepStaging,
  UcpathPendingSweepTarget,
  UcpathTerminationStaging,
  UcpathTerminationTarget,
} from "../../../../models/ui/ucpath-smart-hr-termination.js";
import {
  resolveUcpathElement,
  waitForUcpathState,
} from "./registry-locators.js";
import { ucpathPendingSweepVerdict } from "../termination-verdict.js";

// Driver-internal controls without source selector keys cannot become provenance-backed registry elements.
const DRIVER_ANCHOR = Object.freeze({
  errorBanner: ".PSERROR, #ALERTMSG, .ps_alert-error",

  wizardPersonName: "#PERSON_NAME_NAME_DISPLAY",

  wizardEmplRecord: "#HR_TBH_WRK_EMPL_RCD_CHAR",
  // PeopleSoft derives the disabled job effective date from the transaction date; never fill it.
  wizardJobEffectiveDate: "#HR_TBH_WRK_JOB_EFFDT",
  // The staged transaction ID is NEW until Save; the same field changes from input to span on detail.
  wizardTransactionIdDisplay: "#UC_SS_TRANSACT_UC_TRANSACT_ID",
  pendingRow: 'tr[id^="trHR_TBH_EULST_VW$0_row"]',
  pendingSelect: 'input[type="checkbox"][id^="SELECT$"]',

});

const HRMS = "https://ucphrprdpub.universityofcalifornia.edu/psc/ucphrprd/EMPLOYEE/HRMS";
const WIZARD_URL = `${HRMS}/c/ADMINISTER_WORKFORCE_(GBL).HR_TBH_JOB.GBL`;


const STEP_BOUND_MS = 60_000;

const stagedPendingSweeps = new WeakMap<Page, {
  readonly target: UcpathPendingSweepTarget;
  readonly selected: readonly UcpathInProgressRow[];
}>();


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
  stagedPendingSweeps.delete(page);
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
  for (const row of await page.locator(DRIVER_ANCHOR.pendingRow).all()) {
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

const PendingSweepGridFactsSchema = UcpathInProgressRowSchema.omit({ transactionId: true });
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

function pendingSweepGridQuery(emplId: Eid) {
  return { row: DRIVER_ANCHOR.pendingRow, select: DRIVER_ANCHOR.pendingSelect, emplId };
}

type PendingSweepDispatch = "pending" | "accepted" | "refused";

function observePendingSweepGridOnPage(
  { row, select, emplId, button }: ReturnType<typeof pendingSweepGridQuery> & { button?: Element },
) {
  const checkedSelector = `${select}:checked`;
  const census = {
    readText(node: Element, selector: string): string {
      const matches = node.querySelectorAll<HTMLElement>(selector);
      return matches.length === 1 ? matches[0].innerText.trim() : "";
    },
    readGrid() {
      const checkedCount = document.querySelectorAll(checkedSelector).length;
      const rows = Array.from(document.querySelectorAll(row), (node, index) => {
        const rowEmplId = this.readText(node, 'span[id^="EMPLID$"]');
        const action = this.readText(node, 'span[id^="ACTION$"]');
        const controls = node.querySelectorAll<HTMLInputElement>(select);
        return {
          index,
          checked: controls.length === 1 && controls[0].checked,
          checkboxCount: controls.length,
          facts: {
            emplId: rowEmplId,
            action,
            ...(rowEmplId === emplId ? {
              transactionType: this.readText(node, 'span[id^="TBH_TMPL_TXN_TYP$"]'),
              effectiveDate: this.readText(node, 'span[id^="EFFDT$"]'),
              displayedName: this.readText(node, 'a[id^="NAME$"]'),
              country: this.readText(node, 'span[id^="COUNTRY$"]'),
            } : {}),
          },
        };
      });
      return { rows, checkedCount };
    },
  };
  const grid = census.readGrid();
  if (button === undefined) return { grid };

  const approvedSnapshot = JSON.stringify(grid);
  const approvedChecked = document.querySelectorAll(checkedSelector);
  const controller = new AbortController();
  const guard: {
    armed: boolean;
    dispatch: PendingSweepDispatch;
    stop(): void;
  } = {
    armed: false,
    dispatch: "pending",
    stop() { controller.abort(); },
  };
  window.addEventListener("click", (event) => {
    if (!event.composedPath().includes(button)) return;
    let accept = false;
    try {
      accept = guard.armed && guard.dispatch === "pending" && event.isTrusted
        && JSON.stringify(census.readGrid()) === approvedSnapshot
        && Array.from(document.querySelectorAll(checkedSelector))
          .every((control, index) => control === approvedChecked[index]);
    } finally {
      guard.dispatch = accept ? "accepted" : "refused";
      if (!accept) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }
  }, { capture: true, signal: controller.signal });
  return { grid, guard };
}

function authorizePendingSweepSelection(
  grid: ReturnType<typeof observePendingSweepGridOnPage>["grid"],
  target: UcpathPendingSweepTarget,
  requireAllChecked: boolean,
) {
  const candidates = grid.rows.flatMap((row) => {
    const emplId = EidSchema.parse(row.facts.emplId);
    if (row.facts.action.length === 0) {
      throw new Error("a Transactions in Progress row has no unique non-empty Action control");
    }
    return emplId === target.emplId && isUcpathTerminationAction(row.facts.action)
      ? [{ ...row, facts: PendingSweepGridFactsSchema.parse(row.facts) }]
      : [];
  });
  const joined = joinPendingSweepGridRows(target, candidates.map(({ facts }) => facts));
  const authorized = joined.map(({ candidateIndex, selected }) => ({
    ...candidates[candidateIndex], selected,
  }));
  if (authorized.some(({ checkboxCount }) => checkboxCount !== 1)) {
    throw new Error("an authorized Transactions in Progress row has no unique Select checkbox");
  }
  const authorizedChecked = authorized.filter(({ checked }) => checked).length;
  if (authorizedChecked !== grid.checkedCount) {
    throw new Error("a Transactions in Progress checkbox is checked outside the authorized pending sweep");
  }
  if (requireAllChecked && authorizedChecked !== authorized.length) {
    throw new Error("an authorized Transactions in Progress checkbox did not remain selected");
  }
  return authorized;
}

async function readPendingSweepSelection(
  assertCurrent: () => void,
  page: Page,
  target: UcpathPendingSweepTarget,
  requireAllChecked: boolean,
) {
  assertCurrent();
  const { grid } = await page.evaluate(observePendingSweepGridOnPage, pendingSweepGridQuery(target.emplId));
  assertCurrent();
  return authorizePendingSweepSelection(grid, target, requireAllChecked);
}

async function stagePendingTerminationSweepOnPage(
  assertCurrent: () => void,
  page: Page,
  input: UcpathPendingSweepTarget,
  observedAt: string,
): Promise<UcpathPendingSweepStaging> {
  stagedPendingSweeps.delete(page);
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
  const beforeSelection = await readPendingSweepSelection(assertCurrent, page, input, false);
  const gridRows = page.locator(DRIVER_ANCHOR.pendingRow);
  for (const { index } of beforeSelection) {
    assertCurrent();
    await gridRows.nth(index).locator(DRIVER_ANCHOR.pendingSelect).check();
    assertCurrent();
    recordBrowserAction("checked", "ucpath.smart-hr.pending-transaction");
  }
  const observedName = await readInProgressSubjectOnPage(assertCurrent, page, input.emplId);
  const checked = await readPendingSweepSelection(assertCurrent, page, input, true);
  const selected = checked.map((row) => row.selected);
  if (JSON.stringify(selected) !== JSON.stringify(beforeSelection.map((row) => row.selected))) {
    throw new Error("the authorized Transactions in Progress rows changed during selection");
  }
  const staging = UcpathPendingSweepStagingSchema.parse({
    stagedPageState: UCPATH_SMART_HR_TERMINATION_STAGED,
    emplId: input.emplId,
    observedName,
    selected,
    observedAt,
  });
  stagedPendingSweeps.set(page, { target: input, selected });
  return staging;
}

async function clickGuardedPendingSweepDelete(assertCurrent: () => void, page: Page, locator: Locator, capability: MutationCapability): Promise<void> {
  const staging = stagedPendingSweeps.get(page);
  stagedPendingSweeps.delete(page);
  if (staging === undefined) {
    throw new Error("Delete Selected has no authorized staged pending sweep on this page");
  }
  assertCurrent();
  const button = await locator.elementHandle({ timeout: STEP_BOUND_MS });
  try {
    assertCurrent();
    const observation = await page.evaluateHandle(
      observePendingSweepGridOnPage,
      { ...pendingSweepGridQuery(staging.target.emplId), button },
    );
    let dispatch: PendingSweepDispatch | undefined;
    try {
      assertCurrent();
      const grid = await observation.evaluate(({ grid }) => grid);
      const checked = authorizePendingSweepSelection(grid, staging.target, true);
      if (JSON.stringify(checked.map((row) => row.selected)) !== JSON.stringify(staging.selected)) {
        throw new Error("the authorized Transactions in Progress rows changed before Delete Selected");
      }
      assertCurrent();
      await observation.evaluate(({ guard }) => {
        if (guard?.dispatch !== "pending") throw new Error("Delete Selected dispatch guard could not be armed");
        guard.armed = true;
      });
      assertCurrent();
      await clickWithMutationCapability(capability, button);
    } finally {
      try {
        dispatch = await observation.evaluate(({ guard }) => {
          guard?.stop();
          return guard?.dispatch;
        });
      } finally {
        await observation.dispose();
      }
    }
    assertCurrent();
    if (dispatch === "refused") {
      throw new Error("the checked set changed at Delete Selected dispatch");
    }
    if (dispatch !== "accepted") {
      throw new Error("Delete Selected dispatch was not observed by the checked-set guard");
    }
  } finally {
    await button.dispose();
  }
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
  if (id === UCPATH_SMART_HR_DELETE_SELECTED_BUTTON) {
    await clickGuardedPendingSweepDelete(assertCurrent, page, locator, capability);
  } else {
    await clickWithMutationCapability(capability, locator);
  }
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
  readonly readTransactionFindings: typeof readTransactionFindingsOnPage;
  readonly scanTerminationTransactions: typeof scanTerminationTransactionsOnPage;
  readonly stageTermination: typeof stageTerminationOnPage;
  readonly stagePendingTerminationSweep: typeof stagePendingTerminationSweepOnPage;
  readonly commit: typeof commitOnPage;
}

export const ucpathSmartHrOperations: UcpathSmartHrOperations = Object.freeze({
  readTransactionFindings: readTransactionFindingsOnPage,
  scanTerminationTransactions: scanTerminationTransactionsOnPage,
  stageTermination: stageTerminationOnPage,
  stagePendingTerminationSweep: stagePendingTerminationSweepOnPage,
  commit: commitOnPage,
});

export function nowIso(clock: Clock): string {
  return IsoInstantSchema.parse(clock.now().toISOString());
}
