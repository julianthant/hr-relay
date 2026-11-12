import { installFrozenMonotonic } from "./helpers/app-driver.js";

import { expect } from "@playwright/test";
import { test } from "./helpers/fixtures.js";
import { PARITY_DIST_DIR } from "./helpers/bundle.js";
import { installTheme, PARITY_THEMES } from "./helpers/capture.js";
import { startFixtureServer } from "../support/helpers/dashboard/fixture-bff.js";
import { FIXTURE_DAY } from "./helpers/fixture-identity.js";
import { setSwitchChecked } from "./helpers/switch-choice.js";

const pdf = { name: "direct-contact.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF") };
for (const theme of PARITY_THEMES) for (const width of [1024, 1440]) {
  test(`Emergency Contact reads inline or opens blank typed records @ ${theme.attribute}-${width}`, async ({ page }) => {
    const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
    const errors: string[] = [], writes: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("request", request => { if (request.method() !== "GET") writes.push(request.url()); });
    try {
      await page.setViewportSize({ width, height: width === 1024 ? 720 : 1000 }); await installFrozenMonotonic(page); await installTheme(page, theme);
      await page.goto(`${server.baseUrl}/?day=${FIXTURE_DAY}`);
      const rail = page.getByRole("navigation", { name: "Workflows", exact: true });
      const logs = page.getByRole("region", { name: "Selected run logs", exact: true });
      for (const extraction of [true, false]) {
        await rail.getByRole("button", { name: "Emergency Contact", exact: true }).click();
        await page.getByRole("button", { name: "Start run", exact: true }).click();
        const dialog = page.getByRole("dialog", { name: "Start run", exact: true });
        const picker = dialog.getByRole("navigation", { name: "Workflow", exact: true });
        await expect(picker.getByRole("button", { name: "OCR", exact: true })).toHaveCount(0);
        await expect(picker.getByRole("button", { name: "Emergency Contact", exact: true })).toBeEnabled();
        await dialog.locator('input[type="file"]').setInputFiles({ ...pdf, name: extraction ? "direct-contact.pdf" : "manual-direct-contact.pdf" });
        await dialog.getByRole("button", { name: "Continue", exact: true }).click();
        await dialog.getByRole("switch", { name: "Customize steps", exact: true }).dispatchEvent("click");
        await expect(dialog.getByRole("switch", { name: "Dry run", exact: true })).toHaveCount(1);
        await dialog.getByRole("button", { name: "Continue", exact: true }).click();
        const steps = dialog.getByRole("region", { name: "Steps", exact: true }).last();
        await expect(steps.locator(".ds-run-row")).toHaveCount(6);
        await expect(steps).toContainText("OCR");
        await setSwitchChecked(steps.getByRole("switch", { name: "Include Read emergency contact", exact: true }), extraction);
        await expect(dialog).toContainText(extraction ? "6 of 6 included" : "4 of 6 included");
        await dialog.getByRole("button", { name: /^Start (dry|live) run$/u }).click();
        await expect(page.getByText("Run started", { exact: true }).last()).toBeVisible();
        if (extraction) {
          await logs.getByRole("button", { name: /^Records \d+$/u }).click();
        }
        const records = page.getByRole("dialog", { name: /^Review records/u }).getByRole("region", { name: "OCR records", exact: true });
        await expect(records).toBeVisible();
        await expect(records.getByRole("textbox", { name: "Employee ID", exact: true })).toHaveValue(extraction ? "10000001" : "");
        await expect(records.getByRole("group", { name: "Emergency contact", exact: true }).getByRole("textbox", { name: "Name", exact: true })).toBeVisible();
        await expect(records.getByRole("textbox", { name: "Date signed", exact: true })).toHaveCount(0);
        await expect(records.getByRole("textbox", { name: "Notes", exact: true })).toHaveCount(0);
        await expect(records.getByRole("button", { name: "Approve records", exact: true })).toHaveCount(1);
        if (!extraction) {
          const employeeId = records.getByRole("textbox", { name: "Employee ID", exact: true });
          await employeeId.fill("12000001");
          await expect(records).toContainText("Employee ID must start with 10 and contain eight digits.");
          await employeeId.fill("10000001");
          await expect(records).not.toContainText("Employee ID must start with 10 and contain eight digits.");
          await expect(records).not.toContainText("not confirmed by a UCPath lookup");
          await records.getByRole("group", { name: "Emergency contact", exact: true }).getByRole("textbox", { name: "Name", exact: true }).fill("Alex Rivera");
          await records.getByRole("button", { name: "Discard", exact: true }).click();
          await expect(page.getByText("Review discarded", { exact: true })).toBeVisible();
          const toastEvents = await page.evaluate(() => {
            const notice = [...document.querySelectorAll('[data-slot="toast"]')].find(item => item.textContent?.includes("Review discarded"));
            return [notice?.closest('[data-slot="toast-viewport"]'), notice].map(item => item ? getComputedStyle(item).pointerEvents : "missing");
          });
          expect(toastEvents).toEqual(["none", "none"]);
          await expect(records.getByRole("button", { name: /Undo/u })).toHaveCount(0);
          const heading = records.locator("[data-ocr-review-heading]").first();
          await expect(heading).toBeFocused();
          await heading.press(width === 1024 ? "Control+z" : "Meta+z");
          await expect(page.getByText("Review restored", { exact: true })).toBeVisible();
          await expect(records.getByRole("group", { name: "Emergency contact", exact: true }).getByRole("textbox", { name: "Name", exact: true })).toHaveValue("Alex Rivera");

        }
        await page.keyboard.press("Escape");
        await expect(records).toHaveCount(0);
        await logs.getByRole("button", { name: "Rerun", exact: true }).click();
        const rerun = page.getByRole("dialog", { name: "Rerun", exact: true });
        await expect(rerun.getByRole("switch", { name: "Include Read emergency contact", exact: true })).toBeChecked({ checked: extraction });
        await rerun.getByRole("button", { name: "Continue", exact: true }).click();
                await rerun.getByRole("button", { name: "Cancel", exact: true }).click();
      }
      expect(errors).toEqual([]); expect(writes).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    } finally { await server.close(); }
  });
}
