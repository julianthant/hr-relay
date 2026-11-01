import { installFrozenMonotonic, moveAssistantLauncherAboveFooter } from "./helpers/app-driver.js";

import { createHash } from "node:crypto";
import { expect } from "@playwright/test";
import { test } from "./helpers/fixtures.js";
import { PARITY_DIST_DIR } from "./helpers/bundle.js";
import { installTheme, PARITY_THEMES } from "./helpers/capture.js";
import { startFixtureServer } from "../support/helpers/dashboard/fixture-bff.js";
import { FIXTURE_DAY } from "./helpers/fixture-identity.js";

const pdf = { name: "direct-contact.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF") };
for (const theme of PARITY_THEMES) for (const width of [1024, 1440]) {
  const name = `ocr-direct-${theme.attribute}-${width}`;
  test(`standalone OCR reads or opens blank typed records without downstream approval @ ${theme.attribute}-${width}`, { annotation: [{ type: "required-a11y-evidence", description: `${name}.a11y.yml` }] }, async ({ page }, info) => {
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
        await rail.getByRole("button", { name: "OCR", exact: true }).click();
        await page.getByRole("button", { name: "Start a run", exact: true }).click();
        const dialog = page.getByRole("dialog", { name: "Start a run", exact: true });
        const picker = dialog.getByRole("navigation", { name: "Workflow", exact: true });
        await expect(picker.getByRole("button", { name: "OCR", exact: true })).toBeEnabled();
        await expect(picker.getByRole("button", { disabled: true })).toHaveCount(2);
        await expect(picker.getByRole("button", { name: "I-9 Lookup", exact: true })).toBeDisabled();
        await expect(picker.getByRole("button", { name: "SharePoint Download", exact: true })).toBeDisabled();
        if (extraction) {
          const rosterBounds = (await dialog.getByRole("button", { name: /Roster$/u }).boundingBox())!;
          const formBounds = (await dialog.getByRole("button", { name: "Oath Form type", exact: true }).boundingBox())!;
          expect(Math.abs(rosterBounds.y - formBounds.y)).toBeLessThanOrEqual(1);
          expect(rosterBounds.x + rosterBounds.width).toBeLessThan(formBounds.x);
          const inputName = `${name}-input`;
          const inputTree = await dialog.ariaSnapshot();

          await info.attach(`${inputName}.a11y.yml`, { body: inputTree, contentType: "text/yaml" });
          info.annotations.push({ type: "required-a11y-evidence", description: `${inputName}.a11y.yml` }, { type: `a11y-attachment-sha256:${inputName}.a11y.yml`, description: createHash("sha256").update(inputTree).digest("hex") });
          await dialog.getByRole("button", { name: "Oath Form type", exact: true }).click();
          await expect(page.getByRole("menuitemradio")).toHaveCount(4);
          await expect(page.getByRole("menuitemradio", { name: "Verify", exact: true })).toHaveCount(0);
          await page.getByRole("menuitemradio", { name: "Emergency Contact", exact: true }).click();
          await dialog.getByRole("button", { name: "Existing Onboarding Roster Roster", exact: true }).click();
          await page.getByRole("menuitemradio", { name: "Download Onboarding Roster", exact: true }).click();
        }
        await dialog.locator('input[type="file"]').setInputFiles({ ...pdf, name: extraction ? "direct-contact.pdf" : "manual-direct-contact.pdf" });
        await dialog.getByRole("button", { name: "Continue", exact: true }).click();
        await dialog.getByRole("checkbox", { name: "Customize steps", exact: true }).check();
        await expect(dialog.getByRole("checkbox", { name: "Dry run", exact: true })).toHaveCount(0);
        await dialog.getByRole("button", { name: "Continue", exact: true }).click();
        const steps = dialog.getByRole("region", { name: "Steps", exact: true });
        await expect(steps.getByRole("listitem")).toHaveCount(1);
        await expect(steps).toContainText("OCR");
        await steps.getByRole("checkbox", { name: "Read emergency contact", exact: true }).setChecked(extraction);
        await dialog.getByRole("button", { name: "Preview plan", exact: true }).click();
        await expect(dialog).toContainText(extraction ? "1 / 1 included" : "0 / 1 included");
        await dialog.getByRole("button", { name: "Start preview", exact: true }).click();
        await expect(page.getByText("Run started", { exact: true }).last()).toBeVisible();
        if (extraction) {
          await expect(logs).toContainText("Download roster");
          await logs.getByRole("button", { name: /^Records \d+$/u }).click();
        }
        const records = logs.getByRole("region", { name: "OCR records", exact: true });
        await expect(records).toBeVisible();
        await expect(records.getByRole("textbox", { name: "Employee ID", exact: true })).toHaveValue(extraction ? "10000001" : "");
        await expect(records.getByRole("textbox", { name: "Contact name", exact: true })).toBeVisible();
        await expect(records.getByRole("textbox", { name: "Date signed", exact: true })).toHaveCount(0);
        await expect(records.getByRole("textbox", { name: "Notes", exact: true })).toHaveCount(0);
        await expect(records.getByRole("button", { name: "Approve records", exact: true })).toHaveCount(0);
        if (!extraction) {
          const employeeId = records.getByRole("textbox", { name: "Employee ID", exact: true });
          await employeeId.fill("12000001");
          await expect(records).toContainText("Employee ID must start with 10 and contain eight digits.");
          await employeeId.fill("10000001");
          await expect(records).not.toContainText("Employee ID must start with 10 and contain eight digits.");
          await expect(records).not.toContainText("not confirmed by a UCPath lookup");
          await records.getByRole("textbox", { name: "Contact name", exact: true }).fill("Alex Rivera");
          await records.getByRole("button", { name: "Discard", exact: true }).click();
          await expect(page.getByText("Review discarded", { exact: true })).toBeVisible();
          const notice = page.getByRole("status").filter({ has: page.getByText("Review discarded", { exact: true }) });
          await expect(notice).toHaveCSS("pointer-events", "none");
          await expect(notice.getByRole("button", { name: "Dismiss", exact: true })).toHaveCSS("pointer-events", "auto");
          await expect(records.getByRole("button", { name: /Undo/u })).toHaveCount(0);
          const heading = records.locator("[data-ocr-review-heading]").first();
          await expect(heading).toBeFocused();
          await heading.press(width === 1024 ? "Control+z" : "Meta+z");
          await expect(page.getByText("Review restored", { exact: true })).toBeVisible();
          await expect(records.getByRole("textbox", { name: "Contact name", exact: true })).toHaveValue("Alex Rivera");
          const a11y = await records.ariaSnapshot();

          await info.attach(`${name}.a11y.yml`, { body: a11y, contentType: "text/yaml" });
          info.annotations.push({ type: `a11y-attachment-sha256:${name}.a11y.yml`, description: createHash("sha256").update(a11y).digest("hex") });
        }
        await logs.getByRole("button", { name: "Rerun", exact: true }).click();
        const rerun = page.getByRole("dialog", { name: "Rerun", exact: true });
        await expect(rerun.getByRole("checkbox", { name: "Read emergency contact", exact: true })).toBeChecked({ checked: extraction });
        await rerun.getByRole("button", { name: "Continue", exact: true }).click();
        await expect(rerun.getByRole("button", { name: "Emergency Contact Form type", exact: true })).toBeVisible();
        await rerun.getByRole("button", { name: "Cancel", exact: true }).click();
      }
      expect(errors).toEqual([]); expect(writes).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    } finally { await server.close(); }
  });
}
