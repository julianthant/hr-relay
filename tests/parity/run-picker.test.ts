
import { expect, test } from "@playwright/test";
import { FIXTURE_START_PICKER_BOOTSTRAP, FIXTURE_START_PICKER_DAY_WIRE, FIXTURE_START_PICKER_DESCRIPTOR_HASH } from "./helpers/fixture-start.js";
import { FIXTURE_DAY } from "./helpers/fixture-identity.js";
import { ensureParityBundle, PARITY_DIST_DIR } from "./helpers/bundle.js";
import { startFixtureServer } from "../support/helpers/dashboard/fixture-bff.js";
import { installTheme, PARITY_THEMES } from "./helpers/capture.js";

for (const theme of PARITY_THEMES) for (const width of [1024, 1440]) test(`grouped run picker stays mounted @ ${theme.attribute}-${width}`, async ({ page }, _info) => {
  ensureParityBundle();
  const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" }, profile: { bootstrap: FIXTURE_START_PICKER_BOOTSTRAP, day: FIXTURE_START_PICKER_DAY_WIRE, descriptorHash: FIXTURE_START_PICKER_DESCRIPTOR_HASH } });
  try {
    await page.setViewportSize({ width, height: width === 1024 ? 720 : 900 }); await installTheme(page, theme);
    const errors: string[] = [], writes: string[] = []; page.on("pageerror", error => errors.push(error.message));
    page.on("request", request => { if (request.method() !== "GET") writes.push(new URL(request.url()).pathname); });
    await page.goto(`${server.baseUrl}/?day=${FIXTURE_DAY}`);
    const rail = page.getByRole("navigation", { name: "Workflows", exact: true });
    await expect(rail.getByRole("button")).toHaveCount(15);
    await page.getByRole("button", { name: "Start a run", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Start a run", exact: true });
    const picker = dialog.getByRole("navigation", { name: "Workflow", exact: true });
    await expect(picker.getByRole("button")).toHaveCount(15);
    await expect(picker.getByRole("button", { name: "OCR", exact: true })).toBeEnabled();
    await expect(picker.getByRole("button", { name: "I-9 Lookup", exact: true })).toBeDisabled();
    await expect(picker.getByRole("heading")).toHaveText(["Search", "Separations", "Onboarding", "Work Study", "Payroll", "Utils", "OnBase", "Timekeeping"]);
    await expect(picker.locator("button span").filter({ hasText: /^pl$|^sp$/u })).toHaveCount(0);
    const originalDialog = await dialog.elementHandle(), originalPicker = await picker.elementHandle();
    for (const label of ["Onboarding", "Work-Study", "Oath Signature", "Kronos Pay Rule", "Onboarding", "Oath Upload", "Emergency Contact", "Person Lookup"]) {
      const choice = picker.getByRole("button", { name: label, exact: true });
      await choice.scrollIntoViewIfNeeded();
      const scroll = await picker.locator(".workflow-rail-groups").evaluate(element => element.scrollTop);
      await choice.click();
      await expect.poll(() => picker.locator(".workflow-rail-groups").evaluate(element => element.scrollTop)).toBe(scroll);
      await expect(picker.locator('[aria-current="page"]')).toHaveAccessibleName(label);
      expect(await dialog.evaluate((element, original) => element === original, originalDialog)).toBe(true);
      expect(await picker.evaluate((element, original) => element === original, originalPicker)).toBe(true);
    }
    await expect(dialog.getByRole("textbox", { name: "Employee IDs", exact: true })).toBeVisible();
    const search = dialog.getByRole("searchbox", { name: "Filter workflows", exact: true });
    await search.fill("oath");
    await expect(picker.getByRole("button")).toHaveCount(2);
    await picker.getByRole("button", { name: "Oath Signature", exact: true }).click();
    await expect(search).toHaveValue("");
    const input = dialog.getByRole("textbox", { name: "Employee IDs", exact: true }); await input.fill("10000001");
    await picker.getByRole("button", { name: "Oath Signature", exact: true }).click();
    await expect(input).toHaveValue("10000001");
    await search.fill("oath");
    await dialog.getByRole("button", { name: "Clear search", exact: true }).click();
    await expect(search).toHaveValue(""); await expect(search).toBeFocused();
    await picker.getByRole("button", { name: "Onboarding", exact: true }).click();
    await expect(dialog.getByRole("textbox", { name: "Emails", exact: true })).toHaveValue("");
    await dialog.getByRole("textbox", { name: "Emails", exact: true }).fill("jordan.lee@example.com");
    await dialog.getByRole("button", { name: "Continue", exact: true }).click();
    const flags = dialog.getByRole("checkbox", { name: "Capture screenshots", exact: true });
    await expect(flags).toHaveCount(0);
    await expect(dialog.getByText("Always on", { exact: true })).toBeVisible();
    expect(await picker.evaluate((element, original) => element === original, originalPicker)).toBe(true);
    await expect(flags).toHaveCount(0);
    await picker.getByRole("button", { name: "I-9 Check", exact: true }).click();
    await dialog.getByRole("button", { name: "1 Input", exact: true }).click();
    await expect(dialog.locator('input[type="file"]')).toHaveValue("");

    const metrics = await picker.evaluate(nav => {
      const heading = nav.querySelector("h3")!, row = nav.querySelector("button")!, headingText = heading.getBoundingClientRect().left + parseFloat(getComputedStyle(heading).paddingLeft) + 14 + 8;
      return { textAligned: Math.abs(row.querySelector("span")!.getBoundingClientRect().left - headingText) < 1, rowHeight: row.getBoundingClientRect().height };
    });
    expect(metrics).toEqual({ textAligned: true, rowHeight: 32 });
    await page.keyboard.press("Escape"); await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Start a run", exact: true })).toBeFocused();
    for (const label of ["OCR", "I-9 Lookup"]) {
      await rail.getByRole("button", { name: label, exact: true }).click();
      await page.getByRole("button", { name: "Start a run", exact: true }).click();
      if (label === "OCR") {
        await expect(picker.getByRole("button", { name: label, exact: true })).toBeEnabled();
        await expect(picker.locator('[aria-current="page"]')).toHaveAccessibleName("OCR");
        await expect(dialog.locator('input[type="file"]')).toHaveCount(1);
      } else {
        await expect(picker.getByRole("button", { name: label, exact: true })).toBeDisabled();
        await expect(picker.locator('[aria-current="page"]')).toHaveAccessibleName("Person Lookup");
      }
      await page.keyboard.press("Escape");
    }
    expect(errors).toEqual([]); expect(writes).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  } finally { await page.close(); await server.close(); }
});
