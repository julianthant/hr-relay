import { expect,test } from "@playwright/test";
import { gotoAppState } from "./helpers/app-driver.js";
import {
PARITY_THEMES,
installTheme
} from "./helpers/capture.js";
import { FIXTURE_DAY } from "./helpers/fixture-identity.js";
import { FIXTURE_IDS } from "./helpers/fixture-queue.js";
import { dismissWorkflowWindow,failOnPageErrors,registerReferenceServers } from "./helpers/reference-harness.js";

const servers = registerReferenceServers(["server"]);



/**
 * Browser-local queue triage is deliberately outside the reference corpus:
 * its proof is the state transition and reload reset, not a second baseline
 * image whose default has no check marks. The day fixture supplies this group
 * and its three loaded members through the normal projection.
 */
test.describe("queue local triage", () => {
  test("checked by you updates the group tally and resets on reload", async ({ page }) => {
    const errors = failOnPageErrors(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await installTheme(page, PARITY_THEMES[1]);
    await gotoAppState(page, servers.server.baseUrl, { day: FIXTURE_DAY });
    await dismissWorkflowWindow(page);

    const member = page.locator(`[data-demo-row-id='${FIXTURE_IDS.memberRun}']`).first();
    await member.getByRole("button", { name: /Mark .* checked by you/u }).click();
    await expect(page.getByLabel("1 of 3 checked by you")).toBeVisible();

    await gotoAppState(page, servers.server.baseUrl, { day: FIXTURE_DAY });
    await expect(page.getByLabel(/\d+ of \d+ checked by you/u)).toHaveCount(0);
    expect(errors, "page errors while toggling local queue triage").toEqual([]);
  });
});
