import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { CommandResultSchema, SettingsCommandRequestSchema } from "../../src/rules/commands/commands.js";
import { syntheticSettingsAuthority } from "../support/helpers/dashboard/settings-harness.js";
import { expect, test } from "../support/helpers/dashboard/smoke/smoke-fixtures.js";

test("General settings show edits immediately, persist on reload, and recover from a refused save", async ({ dashboard, page }) => {
  const authority = await syntheticSettingsAuthority();
  const rejected = Promise.withResolvers<void>();
  let refuseNextSave = false;
  const pickedPath = join(authority.root, "smoke-downloads");
  try {
    await mkdir(pickedPath);
    await page.route("**/api/v1/settings/path-picker", route => route.fulfill({
      json: { state: "selected", field: "paths.downloadsDir", path: pickedPath },
    }));
    await page.route("**/api/v1/settings/editable", route => route.fulfill({ json: authority.read() }));
    await page.route("**/api/v1/commands", async route => {
      const request = SettingsCommandRequestSchema.parse(route.request().postDataJSON());
      if (refuseNextSave) {
        refuseNextSave = false;
        await rejected.promise;
        await route.fulfill({ json: CommandResultSchema.parse({
          state: "rejected", commandId: request.commandId, code: "lock-unavailable", message: "Fixture refused this settings save.",
        }) });
      } else {
        await route.fulfill({ json: await authority.execute(request) });
      }
    });

    await dashboard.open();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(dashboard.pageHeading("General")).toBeVisible();
    const switchControl = page.locator('[data-settings-path="preferences.preventSleepWhileRunning"]').getByRole("switch");
    const browser = page.getByRole("combobox", { name: "Browser window" });
    const theme = page.getByRole("radio", { name: "Light" });
    const downloads = page.getByRole("button", { name: "Change Downloads" });
    const path = page.locator('[data-settings-path="paths.downloadsDir"] .ds-path-value');
    const day = page.locator('[data-settings-path$=".jobEndDate"] [role="spinbutton"][data-type="day"]');
    const saved = page.locator('[data-slot="toast-title"]').filter({ hasText: /^Saved /u });
    const failure = page.locator('[data-slot="toast-title"]').filter({ hasText: "Settings weren't saved. The previous value is back." });

    await expect(switchControl).toBeChecked();
    refuseNextSave = true;
    await switchControl.click();
    await expect(switchControl).not.toBeChecked();
    await expect(switchControl).toBeDisabled();
    rejected.resolve();
    await expect(failure).toBeVisible();
    await expect(failure).toHaveCount(1);
    await expect(switchControl).toBeChecked();
    await expect(switchControl).toBeEnabled();
    await switchControl.click();
    await expect(switchControl).not.toBeChecked();
    await expect(saved).toContainText("Prevent sleep");

    await browser.click();
    await page.getByRole("option", { name: "Small", exact: true }).click();
    await expect(browser).toContainText("Small");
    await expect(saved).toContainText("Saved settings");
    await expect(browser).toBeEnabled();

    await page.getByRole("group", { name: "Theme" }).getByText("Light", { exact: true }).click();
    await expect(theme).toBeChecked();
    await expect.poll(() => authority.read().sections.flatMap(section => section.leaves)
      .find(leaf => leaf.path === "preferences.theme")?.effectiveValue).toBe("light");

    await downloads.click();
    await expect(path).toHaveAttribute("aria-label", pickedPath);
    await expect(saved).toContainText("Saved Downloads");

    const date = page.locator('[data-settings-path$=".jobEndDate"]');
    await date.locator('[data-type="month"]').press("0");
    await date.locator('[data-type="month"]').press("6");
    await day.press("1");
    await day.press("5");
    const year = date.locator('[data-type="year"]');
    for (const digit of "2027") await year.press(digit);
    await expect(day).toHaveText("15");
    await expect(saved).toContainText("Saved Job end date");

    await dashboard.settleReads();
    await page.reload();
    await expect(dashboard.pageHeading("General")).toBeVisible();
    await expect(switchControl).not.toBeChecked();
    await expect(browser).toContainText("Small");
    await expect(theme).toBeChecked();
    await expect(path).toHaveAttribute("aria-label", pickedPath);
    await expect(date.locator('[data-type="month"]')).toHaveText("06");
    await expect(day).toHaveText("15");
    await expect(year).toHaveText("2027");
  } finally {
    rejected.resolve();
    await authority.close();
  }
});
