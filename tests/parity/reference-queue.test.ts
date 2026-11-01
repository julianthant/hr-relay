import { expect } from "@playwright/test";
import { test } from "./helpers/fixtures.js";
import { gotoAppState } from "./helpers/app-driver.js";
import {
PARITY_THEMES,
installTheme
} from "./helpers/capture.js";
import { FIXTURE_DAY } from "./helpers/fixture-identity.js";
import { FIXTURE_IDS } from "./helpers/fixture-queue.js";
import { dismissWorkflowWindow,failOnPageErrors,registerReferenceServers } from "./helpers/reference-harness.js";

const servers = registerReferenceServers(["server"]);



test.describe("queue member presentation", () => {
  test("member outcomes and exact selection remain without local checked controls", async ({ page }) => {
    const errors = failOnPageErrors(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await installTheme(page, PARITY_THEMES[0]);
    await gotoAppState(page, servers.server.baseUrl, { day: FIXTURE_DAY });
    await dismissWorkflowWindow(page);

    const member = page.locator(`[data-demo-row-id='${FIXTURE_IDS.memberRun}']`).first();
    await expect(member.getByRole("button", { name: /Mark .* checked/u })).toHaveCount(0);
    await expect(member.getByRole("cell").last()).toContainText("Done");
    await member.getByRole("button").first().click();
    await expect(page).toHaveURL(new RegExp(`run=${FIXTURE_IDS.memberRun}`, "u"));

    await gotoAppState(page, servers.server.baseUrl, { day: FIXTURE_DAY });
    await expect(page.getByLabel(/\d+ of \d+ checked by you/u)).toHaveCount(0);
    expect(errors, "page errors while selecting a queue member").toEqual([]);
  });
});
