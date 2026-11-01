import { installFrozenMonotonic, moveAssistantLauncherAboveFooter } from "./helpers/app-driver.js";

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
      await page.getByRole("button", { name: "Close assistant", exact: true }).click();
      await moveAssistantLauncherAboveFooter(page);
      const rail = page.getByRole("navigation", { name: "Workflows", exact: true });
      const logs = page.getByRole("region", { name: "Selected run logs", exact: true });
      for (const extraction of [true, false]) {
        await rail.getByRole("button", { name: "Emergency Contact", exact: true }).click();
        await page.getByRole("button", { name: "Start a run", exact: true }).click();
        const dialog = page.getByRole("dialog", { name: "Start a run", exact: true });
        const roster = dialog.getByRole("button", { name: "Existing Onboarding Roster Roster", exact: true });
        expect((await roster.locator("svg").boundingBox())?.width).toBe(14);
        expect((await roster.locator("svg").boundingBox())?.height).toBe(14);
        await roster.press("Enter");
        await expect(page.getByRole("menuitemradio")).toHaveCount(2);
        await page.keyboard.press("Escape"); await expect(roster).toBeFocused();
        await dialog.locator('input[type="file"]').setInputFiles({ ...pdf, name: extraction ? "contacts.pdf" : "manual-contacts.pdf" });
        await dialog.getByRole("button", { name: "Continue", exact: true }).click();
        await expect(dialog).toContainText("Interactive runs go first.");
        await expect(dialog.getByRole("radio", { name: "Bulk", exact: true })).toBeVisible();
        await dialog.getByRole("radio", { name: "Bulk", exact: true }).press("Space");
        await dialog.getByRole("checkbox", { name: "Customize steps", exact: true }).check();
        await dialog.getByRole("button", { name: "Continue", exact: true }).click();
        const steps = dialog.getByRole("region", { name: "Steps", exact: true });
        const rows = steps.getByRole("listitem");
        await expect(rows).toHaveCount(4);
        await expect(rows.nth(0)).toContainText("Read emergency contact");
        await expect(rows.nth(0)).toContainText("OCR");
        await expect(steps).not.toContainText("Delegate document to OCR");
        await expect(steps).not.toContainText("Wait for OCR approval");
        const reading = steps.getByRole("checkbox", { name: "Read emergency contact", exact: true });
        await expect(reading).toBeEnabled(); await expect(reading).toBeChecked();
        await reading.setChecked(extraction);
        await expect(steps.getByRole("checkbox", { name: "Read existing contacts", exact: true })).toBeEnabled();
        await expect(steps.getByRole("checkbox", { name: "Fill emergency contact", exact: true })).toBeDisabled();
        await expect(steps.getByRole("checkbox", { name: "Save emergency contact", exact: true })).toBeDisabled();
        await expect(dialog).toContainText(extraction ? "4 / 4 included" : "3 / 4 included");
        if (extraction) {
          const a11y = await dialog.ariaSnapshot();

          await info.attach(`${planName}.a11y.yml`, { body: a11y, contentType: "text/yaml" });
          info.annotations.push({ type: `a11y-attachment-sha256:${planName}.a11y.yml`, description: createHash("sha256").update(a11y).digest("hex") });
        }
        await dialog.getByRole("button", { name: "Preview plan", exact: true }).click();
        await expect(dialog.getByRole("region", { name: "Confirm", exact: true })).toContainText(extraction ? "4 / 4 included" : "3 / 4 included");
        await expect(dialog.getByRole("region", { name: "Confirm", exact: true })).toContainText("Bulk");
        await dialog.getByRole("button", { name: "Start preview", exact: true }).click();
        if (extraction) {
          await expect(logs).toContainText("Read emergency contact");
          await logs.getByRole("button", { name: "Open OCR", exact: true }).click();
          await logs.locator("header").first().getByRole("button", { name: "Review", exact: true }).click();
          await expect(logs.getByRole("textbox", { name: "Employee ID", exact: true })).toHaveValue("10000001");
        } else {
          const review = logs.getByRole("region", { name: "OCR records", exact: true });
          await expect(review).toBeVisible();
          await expect(review.getByRole("textbox", { name: "Employee ID", exact: true })).toHaveValue("");
          await expect(review.getByRole("button", { name: "Approve records", exact: true })).toBeDisabled();
          const a11y = await review.ariaSnapshot();

          await info.attach(`${reviewName}.a11y.yml`, { body: a11y, contentType: "text/yaml" });
          info.annotations.push({ type: `a11y-attachment-sha256:${reviewName}.a11y.yml`, description: createHash("sha256").update(a11y).digest("hex") });
          for (const [label, value] of [["Employee ID", "10000022"], ["First name", "Sam"], ["Last name", "Rivera"], ["Contact name", "Alex Rivera"], ["Cell phone", "2025550101"]]) await review.getByRole("textbox", { name: label, exact: true }).fill(value);
          await review.getByRole("button", { name: "Approve records", exact: true }).click();
          await expect(page.getByText("Records approved", { exact: true })).toBeVisible();
          await expect(page.getByText("1 record released to the parent workflow.", { exact: true })).toBeVisible();
          await rail.getByRole("button", { name: "Emergency Contact", exact: true }).click();
          await expect(page.getByRole("region", { name: "Queue", exact: true })).toContainText("Sam Rivera");
        }
      }
      expect(errors).toEqual([]); expect(writes).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    } finally { await server.close(); }
  });
}
