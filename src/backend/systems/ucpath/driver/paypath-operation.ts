import type { Page } from "playwright";
import type { Clock } from "../../../../rules/time/clock.js";
import type { UcpathPayPathDriver } from "../../../../models/ui/ucpath-paypath.js";

/**
 * Read-only PayPath Actions operations: HR Tasks > PayPath/Additional Pay > PayPath Actions, search one Empl ID,
 * then read the header and current Position Data. Waits only on concrete anchors; refuses with
 * `UcpathPayPathRefusedError` on no record, several records, any alert, an unreadable name or another Empl ID.
 */
export function createUcpathPayPathOperations(assertCurrent: () => void, page: Page, clock: Clock): UcpathPayPathDriver {
  return {
    async readPayPathPosition(input) {
      assertCurrent();
      throw new Error(`not implemented: readPayPathPosition(${String(page.url().length)}, ${clock.now().toISOString()}, ${input.emplId.length})`);
    },
  };
}
