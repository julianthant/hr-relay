import type { Locator, Page } from "playwright";
import type { Clock } from "../../../../rules/time/clock.js";
import { EidSchema } from "../../../../rules/identity/ids.js";
import {
  UCPATH_PAYPATH_POSITION_READY, UcpathPayPathReadSchema, UcpathPayPathRefusedError, type UcpathPayPathDriver,
} from "../../../../models/ui/ucpath-paypath.js";
import { recordBrowserAction } from "../../browser-shared/action-notes.js";
import { UCPATH_PAYPATH_UI as ui } from "./paypath-ui-registry.js";
import { waitForUcpathContentFrameDocument } from "./registry-locators.js";

const BOUND_MS = 30_000;

/**
 * Read-only PayPath Actions operations: HR Tasks > PayPath/Additional Pay > PayPath Actions, search one Empl ID,
 * then read the header and current Position Data. Waits only on concrete anchors; refuses with
 * `UcpathPayPathRefusedError` on no record, several records, any alert, an unreadable name or another Empl ID.
 */
export function createUcpathPayPathOperations(assertCurrent: () => void, page: Page, clock: Clock): UcpathPayPathDriver {
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

  return {
    async readPayPathPosition(input) {
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
      await emplIdInput.fill(input.emplId, { timeout: BOUND_MS });
      assertCurrent();
      recordBrowserAction("typed", "ucpath.paypath.empl-id", input.emplId);
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
      if (!header.success || header.data !== input.emplId) throw new UcpathPayPathRefusedError("subject-mismatch");
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
  };
}
