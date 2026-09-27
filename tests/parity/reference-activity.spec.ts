import { expect, test } from "@playwright/test";
import { gotoAppState } from "./helpers/app-driver.js";
import { FIXTURE_ACTIVITY_RANGE } from "./helpers/fixture-archive.js";
import { FIXTURE_DAY } from "./helpers/fixture-identity.js";
import { ANCHORS,SCENES } from "./helpers/reference-activity-scenes.js";
import { registerReferenceServers } from "./helpers/reference-harness.js";
import { registerReferenceScenes } from "./helpers/reference-scenes.js";
const servers = registerReferenceServers(["server"]);
registerReferenceScenes(SCENES, () => servers.server, ANCHORS);

test("Custom range opens the calendar from a preset and Escape restores the preset", async ({ page }) => {
  await gotoAppState(page, servers.server.baseUrl, {
    day: FIXTURE_DAY,
    activity: `${FIXTURE_ACTIVITY_RANGE.from}..${FIXTURE_ACTIVITY_RANGE.to}`,
  });
  const period = page.getByRole("combobox", { name: "Report period" });
  await period.selectOption("month");
  await expect(period).toHaveValue("month");
  await period.selectOption("custom");
  await expect(page.getByRole("button", { name: "Previous month" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Previous month" })).toHaveCount(0);
  await expect(period).toHaveValue("month");
  const dates = page.getByRole("button", { name: /Select report dates/u });
  await dates.focus();
  await dates.press("Enter");
  await expect(page.getByRole("button", { name: "Previous month" })).toBeVisible();
});
