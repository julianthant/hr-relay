import { installFrozenMonotonic } from "./helpers/app-driver.js";
import { setSwitchChecked } from "./helpers/switch-choice.js";

import { createHash } from "node:crypto";
import { expect } from "@playwright/test";
import { test } from "./helpers/fixtures.js";
import { PARITY_DIST_DIR } from "./helpers/bundle.js";
import { installTheme, PARITY_THEMES } from "./helpers/capture.js";
import { startFixtureServer } from "../support/helpers/dashboard/fixture-bff.js";
import { FIXTURE_DAY } from "./helpers/fixture-identity.js";

const pdf = { name: "contacts.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF") };

for (const theme of PARITY_THEMES) for (const width of [1024, 1440]) {
  const planName = `ocr-plan-${theme.attribute}-${width}`, reviewName = `ocr-manual-contact-${theme.attribute}-${width}`;
  test(`PDF contact plan, priority and OCR review @ ${theme.attribute}-${width}`, { annotation: [
    { type: "required-a11y-evidence", description: `${planName}.a11y.yml` },
    { type: "required-a11y-evidence", description: `${reviewName}.a11y.yml` },
  ] }, async ({ page }, info) => {
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
        await expect(dialog.getByRole("button", { name: "Add spreadsheet", exact: true })).toBeVisible();
        await dialog.locator('input[type="file"]').setInputFiles({ ...pdf, name: extraction ? "contacts.pdf" : "manual-contacts.pdf" });
        await dialog.getByRole("button", { name: "Continue", exact: true }).click();
        const priority = dialog.getByRole("switch", { name: "Priority", exact: true });
        await expect(priority).toBeChecked();
        await expect(dialog).toContainText("· Priority");
        await priority.press("Space");
        await expect(priority).not.toBeChecked();
        await expect(dialog).not.toContainText("· Priority");
        await dialog.getByRole("switch", { name: "Customize steps", exact: true }).dispatchEvent("click");
        await dialog.getByRole("button", { name: "Continue", exact: true }).click();
        const steps = dialog.getByRole("region", { name: "Steps", exact: true }).last();
        const rows = steps.locator(".ds-run-row");
        await expect(rows).toHaveCount(6);
        await expect(rows.nth(0)).toContainText("Read emergency contact");
        await expect(rows.nth(0)).toContainText("OCR");
        await expect(steps).not.toContainText("Delegate document to OCR");
        await expect(steps).not.toContainText("Wait for OCR approval");
        const reading = steps.getByRole("switch", { name: "Include Read emergency contact", exact: true });
        await expect(reading).toBeEnabled(); await expect(reading).toBeChecked();
        await setSwitchChecked(reading, extraction);
        await expect(steps.getByRole("switch", { name: "Include Read existing contacts", exact: true })).toBeEnabled();
        await expect(steps.getByRole("switch", { name: "Fill emergency contact (required)", exact: true })).toBeDisabled();
        await expect(steps.getByRole("switch", { name: "Save emergency contact (required)", exact: true })).toBeDisabled();
        await expect(dialog).toContainText(extraction ? "6 of 6 included" : "4 of 6 included");
        if (extraction) {
          const a11y = await dialog.ariaSnapshot();

          await info.attach(`${planName}.a11y.yml`, { body: a11y, contentType: "text/yaml" });
          info.annotations.push({ type: `a11y-attachment-sha256:${planName}.a11y.yml`, description: createHash("sha256").update(a11y).digest("hex") });
        }
        await dialog.getByRole("button", { name: /^Start (dry|live) run$/u }).click();
        const review = page.getByRole("dialog", { name: /^Review records/u }).getByRole("region", { name: "OCR records", exact: true });
        if (extraction) {
          await expect(logs).toContainText("Read emergency contact");
          await logs.locator("header").first().getByRole("button", { name: "Review", exact: true }).click();
          await expect(review.getByRole("textbox", { name: "Employee ID", exact: true })).toHaveValue("10000001");
          await page.keyboard.press("Escape");
          await expect(review).toHaveCount(0);
        } else {
          await expect(review).toBeVisible();
          await expect(review.getByRole("textbox", { name: "Employee ID", exact: true })).toHaveValue("");
          await expect(review.getByRole("button", { name: "Approve records", exact: true })).toBeDisabled();
          const a11y = await review.ariaSnapshot();

          await info.attach(`${reviewName}.a11y.yml`, { body: a11y, contentType: "text/yaml" });
          info.annotations.push({ type: `a11y-attachment-sha256:${reviewName}.a11y.yml`, description: createHash("sha256").update(a11y).digest("hex") });
          for (const [label, value] of [["Employee ID", "10000022"], ["Employee name", "Sam Rivera"], ["Contact name", "Alex Rivera"], ["Cell phone", "2025550101"]]) await (label === "Contact name" ? review.getByRole("group", { name: "Emergency contact", exact: true }).getByRole("textbox", { name: "Name", exact: true }) : label === "Cell phone" ? review.getByRole("group", { name: "Emergency contact", exact: true }).getByRole("textbox", { name: "Cell phone", exact: true }) : review.getByRole("textbox", { name: label, exact: true })).fill(value);
          await review.getByRole("button", { name: "Approve records", exact: true }).click();
          await expect(page.locator('[data-slot="toast"]').getByText("Records approved", { exact: true }).first()).toBeVisible();
          await expect(page.locator('[data-slot="toast"]').getByText("1 record released to the parent workflow.", { exact: true }).first()).toBeVisible();
          await page.keyboard.press("Escape");
          await expect(review).toHaveCount(0);
          await rail.getByRole("button", { name: "Emergency Contact", exact: true }).click();
          await expect(page.getByRole("region", { name: "Queue", exact: true })).toContainText("Sam Rivera");
        }
      }
      expect(errors).toEqual([]); expect(writes).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    } finally { await server.close(); }
  });
}
