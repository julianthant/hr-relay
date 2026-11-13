import type { FrameLocator, Locator, Page } from "playwright";
import type { Clock } from "../../../../rules/time/clock.js";
import { EidSchema } from "../../../../rules/identity/ids.js";
import {
  UCPATH_PAYPATH_POSITION_READY, UCPATH_PAYPATH_WORK_STUDY_STAGED, UcpathPayPathReadSchema, UcpathPayPathRefusedError, UcpathPayPathStagedSchema,
  UcpathPayPathSubmitRefusedError, type UcpathPayPathDriver, type UcpathPayPathWorkStudyTarget,
} from "../../../../models/ui/ucpath-paypath.js";
import { assertMintedMutationCapability } from "../../../../workflow-kit/mutation-capability.js";
import { recordBrowserAction } from "../../browser-shared/action-notes.js";
import { UCPATH_PAYPATH_UI as ui } from "./paypath-ui-registry.js";
import { waitForUcpathContentFrameDocument } from "./registry-locators.js";

const BOUND_MS = 30_000;

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
  /** PeopleSoft settles after a field change or click once its processing indicator hides; an alert then refuses with its text. */
  const settle = async (frame: FrameLocator) => {
    await ui.busy(frame).waitFor({ state: "hidden", timeout: BOUND_MS });
    assertCurrent();
    if (await ui.alertOk(page).isVisible()) throw new UcpathPayPathRefusedError("paypath-alert-shown", await textOf(ui.alertText(page).first()));
  };
  const fillField = async (frame: FrameLocator, locator: Locator, value: string, targetId: string) => {
    await shown(locator);
    if (await locator.count() !== 1) throw new UcpathPayPathRefusedError("unexpected-page-state");
    await locator.fill(value, { timeout: BOUND_MS });
    assertCurrent();
    recordBrowserAction("typed", targetId, value);
    await settle(frame);
    return valueOf(locator);
  };
  const stagedKey = (input: UcpathPayPathWorkStudyTarget) =>
    JSON.stringify([input.emplId, input.expectedName, input.effectiveDate, input.positionChangeReason, input.positionPool, input.comments]);

  /** Opens exactly one PayPath record for the Empl ID and returns its frame and displayed name once the header proves the Empl ID. */
  async function openRecord(emplId: UcpathPayPathWorkStudyTarget["emplId"]) {
    assertCurrent();
    await page.goto(ui.hrTasksUrl, { waitUntil: "domcontentloaded", timeout: BOUND_MS });
    assertCurrent();
    recordBrowserAction("opened", "ucpath.paypath.hr-tasks");
    await click(ui.payPathCategory(page), "ucpath.paypath.category");
    await shown(ui.payPathActions(page));
    await waitForUcpathContentFrameDocument(assertCurrent, page, BOUND_MS);
    await click(ui.payPathActions(page), "ucpath.paypath.actions");

    const frame = ui.frame(page);
    const emplIdInput = ui.emplIdInput(frame);
    await shown(emplIdInput);
    await emplIdInput.fill(emplId, { timeout: BOUND_MS });
    assertCurrent();
    recordBrowserAction("typed", "ucpath.paypath.empl-id", emplId);
    await click(ui.searchButton(frame), "ucpath.paypath.search");

    const alertOk = ui.alertOk(page), noResults = ui.noResults(frame), rows = ui.resultRows(frame), name = ui.nameDisplay(frame);
    assertCurrent();
    try {
      await Promise.any([alertOk, noResults, rows.first(), name].map(locator => locator.waitFor({ state: "visible", timeout: BOUND_MS })));
    } catch {
      assertCurrent();
      throw new UcpathPayPathRefusedError("unexpected-page-state");
    }
    assertCurrent();
    if (await alertOk.isVisible()) {
      throw new UcpathPayPathRefusedError("paypath-alert-shown", await textOf(ui.alertText(page).first()));
    }
    if (await noResults.isVisible()) throw new UcpathPayPathRefusedError("employee-not-found");
    if (await rows.count() > 0) throw new UcpathPayPathRefusedError("paypath-multiple-records");
    assertCurrent();
    if (!await name.isVisible()) throw new UcpathPayPathRefusedError("unexpected-page-state");

    const displayedName = await textOf(name);
    if (displayedName === "") throw new UcpathPayPathRefusedError("paypath-identity-unreadable");
    const header = EidSchema.safeParse(await textOf(ui.emplIdDisplay(frame)));
    if (!header.success || header.data !== emplId) throw new UcpathPayPathRefusedError("subject-mismatch");
    return { frame, displayedName };
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
      const position = {
        effectiveDate: await valueOf(ui.effectiveDate(frame)),
        positionChangeReason: await valueOf(ui.positionChangeReason(frame)),
        positionPool: await valueOf(ui.positionPool(frame)),
        positionNumber: await valueOf(ui.positionNumber(frame)),
      };
      recordBrowserAction("read", "ucpath.paypath.position-data");
      return UcpathPayPathReadSchema.parse({
        pageStateId: UCPATH_PAYPATH_POSITION_READY, emplId: input.emplId, displayedName, position, observedAt: clock.now().toISOString(),
      });
    },

    async stagePayPathWorkStudy(input) {
      staged = undefined;
      const { frame, displayedName } = await openRecord(input.emplId);
      const effectiveDate = await fillField(frame, ui.effectiveDate(frame), input.effectiveDate, "ucpath.paypath.effective-date");
      const positionChangeReason = await fillField(frame, ui.positionChangeReason(frame), input.positionChangeReason, "ucpath.paypath.position-change-reason");
      const positionPool = await fillField(frame, ui.positionPool(frame), input.positionPool, "ucpath.paypath.position-pool");
      await click(ui.jobDataTab(frame), "ucpath.paypath.job-data-tab");
      await settle(frame);
      const jobDataComments = await fillField(frame, ui.jobDataComments(frame), input.comments, "ucpath.paypath.job-data-comments");
      await click(ui.additionalPayDataTab(frame), "ucpath.paypath.additional-pay-data-tab");
      await settle(frame);
      const initiatorComments = await fillField(frame, ui.initiatorComments(frame), input.comments, "ucpath.paypath.initiator-comments");
      await saveControl(frame);
      recordBrowserAction("read", "ucpath.paypath.staged-values");
      const result = UcpathPayPathStagedSchema.parse({
        pageStateId: UCPATH_PAYPATH_WORK_STUDY_STAGED, emplId: input.emplId, displayedName,
        values: { effectiveDate, positionChangeReason, positionPool, jobDataComments, initiatorComments }, observedAt: clock.now().toISOString(),
      });
      staged = stagedKey(input);
      return result;
    },

    async readPayPathSubject() {
      const name = await textOf(ui.nameDisplay(ui.frame(page)));
      if (name === "") throw new UcpathPayPathRefusedError("paypath-identity-unreadable");
      return name;
    },

    async submitPayPathWorkStudy(input, capability) {
      assertMintedMutationCapability(capability);
      assertCurrent();
      if (staged === undefined || staged !== stagedKey(input)) throw new UcpathPayPathRefusedError("unexpected-page-state");
      staged = undefined;
      const frame = ui.frame(page);
      await click(await saveControl(frame), "ucpath.paypath.save-and-submit");
      await ui.busy(frame).waitFor({ state: "hidden", timeout: BOUND_MS });
      assertCurrent();
      if (await ui.alertOk(page).isVisible()) throw new UcpathPayPathSubmitRefusedError(await textOf(ui.alertText(page).first()));
    },
  };
}
