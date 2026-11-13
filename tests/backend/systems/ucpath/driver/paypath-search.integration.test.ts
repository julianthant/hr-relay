import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chromium } from "playwright";
import { describe, it } from "vitest";
import { createUcpathPayPathOperations } from "../../../../../src/backend/systems/ucpath/driver/paypath-operation.js";
import { UcpathPayPathRefusedError } from "../../../../../src/models/ui/ucpath-paypath.js";
import { EidSchema } from "../../../../../src/rules/identity/ids.js";
import { manualClock } from "../../../../../src/rules/time/clock.js";

const template = readFileSync(new URL("../../../../support/fixtures/ui/ucpath/paypath-actions-search.html", import.meta.url), "utf8");
const EMPL_ID = EidSchema.parse("10000001");

async function probedPage(state: Readonly<{ droppedStepClicks?: number }> = {}) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const body = template.replace("__FIXTURE__", JSON.stringify(state));
  await page.route("**/*", route => route.fulfill({ contentType: "text/html", body }));
  const driver = createUcpathPayPathOperations(() => undefined, page, manualClock(new Date("2026-11-13T20:30:00.000Z")));
  return { browser, page, driver };
}

describe("UCPath PayPath search on the probed page states", () => {
  it("fills the begins-with Empl ID search field and runs the search", async () => {
    const h = await probedPage();
    try {
      const error = await h.driver.readPayPathPosition({ emplId: EMPL_ID }).then(() => undefined, (caught: unknown) => caught);
      assert.ok(error instanceof UcpathPayPathRefusedError, String(error));
      assert.equal(error.code, "employee-not-found");
      const frame = h.page.frameLocator("#main_target_win0");
      assert.equal(await frame.getByRole("textbox", { name: "Empl ID begins with", exact: true }).inputValue(), EMPL_ID);
    } finally {
      await h.browser.close();
    }
  }, 60_000);
});
