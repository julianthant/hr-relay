import { setSwitchChecked } from "./helpers/switch-choice.js";
import { installFrozenMonotonic, moveAssistantLauncherAboveFooter } from "./helpers/app-driver.js";

import { expect, type Locator } from "@playwright/test";
import { test } from "./helpers/fixtures.js";
import { createHash } from "node:crypto";
import { PARITY_DIST_DIR } from "./helpers/bundle.js";
import { installTheme, PARITY_THEMES } from "./helpers/capture.js";
import { startFixtureServer } from "../support/helpers/dashboard/fixture-bff.js";
import { FIXTURE_DAY } from "./helpers/fixture-identity.js";
import { chooseSelect } from "./helpers/select-choice.js";

const pdf = { name: "manual-oath.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF") };
async function advance(dialog: Locator) {
  const preview = dialog.getByRole("button", { name: "Preview plan", exact: true });
  await (await preview.count() ? preview : dialog.getByRole("button", { name: "Continue", exact: true })).click();
}
for (const theme of PARITY_THEMES) for (const width of [1024, 1440]) {
  const a11yName = `manual-input-${theme.attribute}-${width}.a11y.yml`;
  test(`manual OCR, read replacement, form locks and rerun @ ${theme.attribute}-${width}`, { annotation: [{ type: "required-a11y-evidence", description: a11yName }] }, async ({ page }, info) => {
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
      await rail.getByRole("button", { name: "Oath Signature", exact: true }).click();
      await page.getByRole("button", { name: "Start a run", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Start a run", exact: true });
      await dialog.getByRole("textbox", { name: "Employee IDs", exact: true }).fill("10000022");
      await advance(dialog);
      await dialog.getByRole("checkbox", { name: "Customize steps", exact: true }).check();
      await setSwitchChecked(dialog.getByRole("switch", { name: "Dry run Fill and check every step without submitting.", exact: true }), false);
      await advance(dialog);
      const read = dialog.getByRole("checkbox", { name: "Verify onboarding and oath date", exact: true });
      await expect(read).toBeEnabled(); await read.uncheck();
      const form = dialog.getByRole("checkbox", { name: "Sign oath", exact: true });
      await expect(form).toBeDisabled(); await expect(form).toBeChecked();
      await expect(dialog.getByRole("button", { name: "Preview plan", exact: true })).toBeDisabled();
      const manual = dialog.getByRole("group", { name: "Manual values for Verify onboarding and oath date", exact: true });
      await manual.getByRole("textbox", { name: "CRM onboarding", exact: true }).fill("Record found");
      await manual.getByRole("textbox", { name: "Process stage", exact: true }).fill("Onboarding complete");
      await manual.getByRole("textbox", { name: "First day of service", exact: true }).fill("10/06/2026");
      await manual.getByRole("textbox", { name: "Signed date", exact: true }).fill("10/06/2026");
      const privateUrl = page.url();
      expect(privateUrl).not.toContain("10000022"); expect(privateUrl).not.toContain("Onboarding%20complete");

      await advance(dialog);
      await expect(dialog).toContainText("Manual reading");
      await dialog.getByRole("button", { name: "Start preview", exact: true }).click();
      await expect(logs).toContainText("Operator-entered values");
      await expect(logs).toContainText("10/06/2026");
      await logs.getByRole("button", { name: "Rerun", exact: true }).click();
      const rerun = page.getByRole("dialog", { name: "Rerun", exact: true });
      await expect(rerun.getByRole("textbox", { name: "Signed date", exact: true })).toHaveValue("10/06/2026");
      await expect(rerun.getByRole("checkbox", { name: "Sign oath", exact: true })).toBeDisabled();
      await rerun.getByRole("button", { name: "Cancel", exact: true }).click();

      await rail.getByRole("button", { name: "Oath Upload", exact: true }).click();
      await page.getByRole("button", { name: "Start a run", exact: true }).click();
      await dialog.locator('input[type="file"]').setInputFiles(pdf);
      await advance(dialog);
      await dialog.getByRole("checkbox", { name: "Extract with OCR", exact: true }).uncheck();
      await dialog.getByRole("checkbox", { name: "Customize steps", exact: true }).check();
      await advance(dialog);
      for (const name of ["Attach oath PDF", "File HR ticket"]) {
        await expect(dialog.getByRole("checkbox", { name, exact: true })).toBeDisabled();
        await expect(dialog.getByRole("checkbox", { name, exact: true })).toBeChecked();
      }
      await advance(dialog);
      await expect(dialog).toContainText("Off · enter records in review");
      const confirmUrl = page.url();
      await dialog.getByRole("button", { name: "Start preview", exact: true }).click();
      const review = logs.getByRole("region", { name: "OCR records", exact: true });
      await expect(review).toBeVisible();
      await expect(review.getByRole("textbox", { name: "Employee ID", exact: true })).toHaveValue("");
      await expect(review.getByRole("textbox", { name: "First name", exact: true })).toHaveValue("");
      await expect(review.getByRole("textbox", { name: "Date signed", exact: true })).toHaveValue("");
      await expect(review.getByRole("textbox", { name: "Notes", exact: true })).toHaveCount(0);
      await expect(review.getByRole("button", { name: "Approve records", exact: true })).toBeDisabled();
      const reviewUrl = page.url();
      await page.goBack(); await expect(page).toHaveURL(confirmUrl);
      await page.goForward(); await expect(page).toHaveURL(reviewUrl); await expect(review).toBeVisible();
      for (const [name, value] of [["Employee ID", "10000022"], ["First name", "Sam"], ["Last name", "Rivera"], ["Date signed", "10/06/2026"]]) await review.getByRole("textbox", { name, exact: true }).fill(value);
      await review.getByRole("checkbox", { name: "Employee signed", exact: true }).check();
      await review.getByRole("checkbox", { name: "Officer signed", exact: true }).check();
      await expect(review.getByRole("button", { name: "Approve records", exact: true })).toBeEnabled();
      await expect(review).not.toContainText("not confirmed by a UCPath lookup");

      const a11y = await review.ariaSnapshot();
      await info.attach(a11yName, { body: a11y, contentType: "text/yaml" });
      info.annotations.push({ type: `a11y-attachment-sha256:${a11yName}`, description: createHash("sha256").update(a11y).digest("hex") });
      await review.getByRole("button", { name: "Approve records", exact: true }).click();
      await rail.getByRole("button", { name: "Oath Signature", exact: true }).click();
      await expect(page.getByRole("region", { name: "Queue", exact: true })).toContainText("Sam Rivera");
      await rail.getByRole("button", { name: "I-9 Check", exact: true }).click();
      await page.getByRole("button", { name: "Start a run", exact: true }).click();
      await dialog.locator('input[type="file"]').setInputFiles({ ...pdf, name: "manual-i9.pdf" });
      await advance(dialog);
      await dialog.getByRole("checkbox", { name: "Extract with OCR", exact: true }).uncheck();
      await advance(dialog);
      await dialog.getByRole("button", { name: "Start preview", exact: true }).click();
      await expect(review).toBeVisible();
      await expect(review.getByRole("textbox", { name: "Employee ID", exact: true })).toHaveValue("");
      await chooseSelect(review.getByRole("combobox", { name: "Section 1 page", exact: true }), "2");
      await chooseSelect(review.getByRole("combobox", { name: "Section 2 page", exact: true }), "1");
      await expect(review.getByRole("img")).toHaveAccessibleName("Source page 2 of manual-i9.pdf");
      await review.getByRole("button", { name: "Add record", exact: true }).click();
      await expect(review.getByRole("region", { name: "Source PDF", exact: true })).toHaveCount(2);
      await expect(review.getByRole("img")).toHaveCount(2);
      await expect(review.getByRole("button", { name: "Approve records", exact: true })).toBeDisabled();
      expect(errors).toEqual([]); expect(writes).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    } finally { await server.close(); }
  });
}
