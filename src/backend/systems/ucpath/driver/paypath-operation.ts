import type { FrameLocator, Locator, Page } from "playwright";
import type { Clock } from "../../../../rules/time/clock.js";
import { EidSchema } from "../../../../rules/identity/ids.js";
import {
  UCPATH_PAYPATH_POSITION_READY, UCPATH_PAYPATH_WORK_STUDY_STAGED, UcpathPayPathReadSchema, UcpathPayPathRefusedError, UcpathPayPathStagedSchema,
  UcpathPayPathStagedValuesSchema, UcpathPayPathSubmitRefusedError, type UcpathPayPathDriver, type UcpathPayPathRefusalCode, type UcpathPayPathStagedValues, type UcpathPayPathWorkStudyTarget,
} from "../../../../models/ui/ucpath-paypath.js";
import { assertMintedMutationCapability } from "../../../../workflow-kit/mutation-capability.js";
import { recordBrowserAction } from "../../browser-shared/action-notes.js";
import { UCPATH_PAYPATH_UI as ui } from "./paypath-ui-registry.js";
import { waitForUcpathContentFrameDocument } from "./registry-locators.js";

const BOUND_MS = 30_000;
const SETTLE_MS = 10_000;

/**
 * PayPath Actions operations: HR Tasks > PayPath/Additional Pay > PayPath Actions, search one Empl ID, then read the header and
 * current Position Data, or stage the work-study values and click Save and Submit. Waits only on concrete anchors; refuses with
 * `UcpathPayPathRefusedError` on no record, several records, any alert, an unreadable name or another Empl ID.
 */
export function createUcpathPayPathOperations(assertCurrent: () => void, page: Page, clock: Clock): UcpathPayPathDriver {
  let staged: string | undefined;
  const shown = async (locator: Locator) => {
    assertCurrent();
    await locator.waitFor({ state: "visible", timeout: BOUND_MS });
    assertCurrent();
  };
  const shownWithin = async (locator: Locator, timeout: number) => {
    assertCurrent();
    const visible = await locator.waitFor({ state: "visible", timeout }).then(() => true, () => false);
    assertCurrent();
    return visible;
  };
  const click = async (locator: Locator, targetId: string) => {
    await shown(locator);
    await locator.click({ timeout: BOUND_MS });
    assertCurrent();
    recordBrowserAction("clicked", targetId);
  };
  const textOf = async (locator: Locator) => {
    await shown(locator);
    const text = await locator.innerText({ timeout: BOUND_MS });
    assertCurrent();
    return text.trim();
  };
  const valueOf = async (locator: Locator) => {
    await shown(locator);
    if (await locator.count() !== 1) throw new UcpathPayPathRefusedError("unexpected-page-state");
    const value = await locator.inputValue({ timeout: BOUND_MS });
    assertCurrent();
    return value;
  };
  /** Any failure in one stage refuses with the code that names that stage; a revoked owner's error and an already-typed refusal pass through. */
  const reached = async <T>(code: UcpathPayPathRefusalCode, stage: () => Promise<T>): Promise<T> => {
    try {
      return await stage();
    } catch (cause) {
      assertCurrent();
      if (cause instanceof UcpathPayPathRefusedError) throw cause;
      throw new UcpathPayPathRefusedError(code, undefined, { cause });
    }
  };
  /** An alert whose text cannot be read still refuses as an alert, without text. */
  const alertShown = async () => new UcpathPayPathRefusedError("paypath-alert-shown",
    await reached("paypath-alert-shown", () => textOf(ui.alertText(page).first())));
  /** PeopleSoft settles after a field change or click once its processing indicator hides and the network is idle; an alert then refuses with its text. */
  const settle = async (frame: FrameLocator) => {
    try {
      await ui.busy(frame).waitFor({ state: "hidden", timeout: BOUND_MS });
      assertCurrent();
      await page.waitForLoadState("networkidle", { timeout: SETTLE_MS });
    } catch (cause) {
      assertCurrent();
      throw new UcpathPayPathRefusedError("unexpected-page-state", undefined, { cause });
    }
    assertCurrent();
    if (await ui.alertOk(page).isVisible()) throw await alertShown();
  };
  const fillField = async (frame: FrameLocator, locator: Locator, value: string, targetId: string) => {
    await shown(locator);
    if (await locator.count() !== 1) throw new UcpathPayPathRefusedError("unexpected-page-state");
    await locator.fill(value, { timeout: BOUND_MS });
    assertCurrent();
    recordBrowserAction("typed", targetId, value);
    await locator.press("Tab", { timeout: BOUND_MS });
    assertCurrent();
    await settle(frame);
  };
  const openTab = async (frame: FrameLocator, tab: Locator, targetId: string) => {
    await click(tab, targetId);
    await settle(frame);
  };
  /** One pass over all five staged values as the page now shows them, ending on Additional Pay Data where Save and Submit sits. */
  const readStagedValues = async (frame: FrameLocator) => {
    await openTab(frame, ui.positionDataTab(frame), "ucpath.paypath.position-data-tab");
    const effectiveDate = await valueOf(ui.effectiveDate(frame));
    const positionChangeReason = await valueOf(ui.positionChangeReason(frame));
    const positionPool = await valueOf(ui.positionPool(frame));
    await openTab(frame, ui.jobDataTab(frame), "ucpath.paypath.job-data-tab");
    const jobDataComments = await valueOf(ui.jobDataComments(frame));
    await openTab(frame, ui.additionalPayDataTab(frame), "ucpath.paypath.additional-pay-data-tab");
    const initiatorComments = await valueOf(ui.initiatorComments(frame));
    recordBrowserAction("read", "ucpath.paypath.staged-values");
    return UcpathPayPathStagedValuesSchema.parse({ effectiveDate, positionChangeReason, positionPool, jobDataComments, initiatorComments });
  };
  const keepsTarget = (values: UcpathPayPathStagedValues, input: UcpathPayPathWorkStudyTarget) =>
    values.effectiveDate === input.effectiveDate && values.positionChangeReason === input.positionChangeReason && values.positionPool === input.positionPool
    && values.jobDataComments === input.comments && values.initiatorComments === input.comments;
  /** The one header name the record shows; none, several or blank refuses as unreadable. */
  const headerName = async (frame: FrameLocator) => {
    const name = ui.nameDisplay(frame);
    assertCurrent();
    const count = await name.count();
    assertCurrent();
    if (count !== 1) throw new UcpathPayPathRefusedError("paypath-identity-unreadable");
    const text = await reached("paypath-identity-unreadable", () => textOf(name));
    if (text === "") throw new UcpathPayPathRefusedError("paypath-identity-unreadable");
    return text;
  };
  /** What a Position Data label points at through its `for`: an input box, display text, or nothing readable. */
  const labelledField = async (label: Locator) => {
    await shown(label);
    const kind = await label.evaluate((node): "input" | "text" | "none" => {
      const id = node.getAttribute("for");
      const field = id === null ? null : node.ownerDocument.getElementById(id);
      if (field === null) return "none";
      if (["INPUT", "SELECT", "TEXTAREA"].includes(field.tagName)) return "input";
      return field.textContent.trim() === "" ? "none" : "text";
    }, undefined, { timeout: BOUND_MS });
    assertCurrent();
    return kind;
  };
  const stagedKey = (input: UcpathPayPathWorkStudyTarget) =>
    JSON.stringify([input.emplId, input.expectedName, input.effectiveDate, input.positionChangeReason, input.positionPool, input.comments]);

  /**
   * Opens exactly one PayPath record for the Empl ID and returns its frame and displayed name once the header proves the Empl ID
   * and Position Data is not the already-dated record: Effective Date and Position Change Reason both shown as display text, which refuses by name.
   */
  async function openRecord(emplId: UcpathPayPathWorkStudyTarget["emplId"]) {
    const frame = ui.frame(page);
    await reached("paypath-hr-tasks-not-shown", async () => {
      assertCurrent();
      await page.goto(ui.hrTasksUrl, { waitUntil: "domcontentloaded", timeout: BOUND_MS });
      assertCurrent();
      recordBrowserAction("opened", "ucpath.paypath.hr-tasks");
      await click(ui.payPathCategory(page), "ucpath.paypath.category");
      await shown(ui.payPathActions(page));
      await waitForUcpathContentFrameDocument(assertCurrent, page, BOUND_MS);
    });
    await reached("paypath-search-not-shown", async () => {
      const emplIdInput = ui.emplIdInput(frame);
      await click(ui.payPathActions(page), "ucpath.paypath.actions");
      // Live probe (work-study-workflow-06): a step click that lands before the content frame's first document has loaded is lost; one re-click, never a loop.
      if (!await shownWithin(emplIdInput, SETTLE_MS)) await click(ui.payPathActions(page), "ucpath.paypath.actions");
      await shown(emplIdInput);
      await emplIdInput.fill(emplId, { timeout: BOUND_MS });
      assertCurrent();
      recordBrowserAction("typed", "ucpath.paypath.empl-id", emplId);
      await click(ui.searchButton(frame), "ucpath.paypath.search");
    });

    return reached("unexpected-page-state", async () => {
      // The record's tab strip marks the record page; the search form it replaces has none.
      const alertOk = ui.alertOk(page), noResults = ui.noResults(frame), rows = ui.resultRows(frame), record = ui.jobDataTab(frame);
      assertCurrent();
      await Promise.any([alertOk, noResults, rows.first(), record].map(locator => locator.waitFor({ state: "visible", timeout: BOUND_MS })));
      assertCurrent();
      if (await alertOk.isVisible()) throw await alertShown();
      if (await noResults.isVisible()) throw new UcpathPayPathRefusedError("employee-not-found");
      if (await rows.count() > 0) throw new UcpathPayPathRefusedError("paypath-multiple-records");
      assertCurrent();
      if (!await record.isVisible()) throw new UcpathPayPathRefusedError("unexpected-page-state");

      const displayedName = await headerName(frame);
      const header = EidSchema.safeParse(await textOf(ui.emplIdDisplay(frame)));
      if (!header.success || header.data !== emplId) throw new UcpathPayPathRefusedError("subject-mismatch");
      const effectiveDate = await labelledField(ui.effectiveDateLabel(frame));
      const positionChangeReason = await labelledField(ui.positionChangeReasonLabel(frame));
      if (effectiveDate === "text" && positionChangeReason === "text") throw new UcpathPayPathRefusedError("paypath-position-already-dated");
      return { frame, displayedName, emplId: header.data };
    });
  }

  /** The one visible, enabled Save and Submit control; anything else refuses. */
  async function saveControl(frame: FrameLocator) {
    const save = ui.saveAndSubmit(frame);
    await shown(save);
    if (await save.count() !== 1 || !await save.isEnabled()) throw new UcpathPayPathRefusedError("unexpected-page-state");
    return save;
  }

  return {
    async readPayPathPosition(input) {
      staged = undefined;
      const { frame, displayedName } = await openRecord(input.emplId);
      const position = await reached("unexpected-page-state", async () => ({
        effectiveDate: await valueOf(ui.effectiveDate(frame)),
        positionChangeReason: await valueOf(ui.positionChangeReason(frame)),
        positionPool: await valueOf(ui.positionPool(frame)),
        positionNumber: await valueOf(ui.positionNumber(frame)),
      }));
      recordBrowserAction("read", "ucpath.paypath.position-data");
      return UcpathPayPathReadSchema.parse({
        pageStateId: UCPATH_PAYPATH_POSITION_READY, emplId: input.emplId, displayedName, position, observedAt: clock.now().toISOString(),
      });
    },

    async stagePayPathWorkStudy(input) {
      staged = undefined;
      const { frame, displayedName, emplId } = await openRecord(input.emplId);
      await fillField(frame, ui.effectiveDate(frame), input.effectiveDate, "ucpath.paypath.effective-date");
      await fillField(frame, ui.positionChangeReason(frame), input.positionChangeReason, "ucpath.paypath.position-change-reason");
      await fillField(frame, ui.positionPool(frame), input.positionPool, "ucpath.paypath.position-pool");
      await openTab(frame, ui.jobDataTab(frame), "ucpath.paypath.job-data-tab");
      await fillField(frame, ui.jobDataComments(frame), input.comments, "ucpath.paypath.job-data-comments");
      await openTab(frame, ui.additionalPayDataTab(frame), "ucpath.paypath.additional-pay-data-tab");
      await fillField(frame, ui.initiatorComments(frame), input.comments, "ucpath.paypath.initiator-comments");
      const values = await readStagedValues(frame);
      await saveControl(frame);
      const result = UcpathPayPathStagedSchema.parse({
        pageStateId: UCPATH_PAYPATH_WORK_STUDY_STAGED, emplId, displayedName, values, observedAt: clock.now().toISOString(),
      });
      staged = stagedKey(input);
      return result;
    },

    async readPayPathSubject() {
      return headerName(ui.frame(page));
    },

    async submitPayPathWorkStudy(input, capability) {
      assertMintedMutationCapability(capability);
      assertCurrent();
      if (staged === undefined || staged !== stagedKey(input)) throw new UcpathPayPathRefusedError("unexpected-page-state");
      staged = undefined;
      const frame = ui.frame(page);
      const header = EidSchema.safeParse(await textOf(ui.emplIdDisplay(frame)));
      if (!header.success || header.data !== input.emplId) throw new UcpathPayPathRefusedError("subject-mismatch");
      if (!keepsTarget(await readStagedValues(frame), input)) throw new UcpathPayPathRefusedError("staged-value-mismatch");
      const save = await saveControl(frame);
      await click(save, "ucpath.paypath.save-and-submit");
      // PeopleSoft answers with an alert or replaces the staged page; seeing neither leaves the outcome unknown, and the caller parks.
      const outcome = await Promise.any([
        ui.alertOk(page).waitFor({ state: "visible", timeout: BOUND_MS }).then(() => "alert" as const),
        save.waitFor({ state: "detached", timeout: BOUND_MS }).then(() => "left-staged-page" as const),
      ]).catch(() => "unseen" as const);
      assertCurrent();
      if (outcome === "alert") throw new UcpathPayPathSubmitRefusedError(await textOf(ui.alertText(page).first()));
      if (outcome === "unseen") throw new Error("paypath-submit-outcome-unseen");
      await ui.busy(frame).waitFor({ state: "hidden", timeout: BOUND_MS });
      assertCurrent();
    },
  };
}
