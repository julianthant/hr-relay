import { expect, test } from "@playwright/test";
import { ensureParityBundle, PARITY_DIST_DIR } from "./helpers/bundle.js";
import { installTheme, PARITY_THEMES } from "./helpers/capture.js";
import { startFixtureServer } from "./helpers/fixture-bff.js";
import { FIXTURE_DAY, WORKFLOW_ID } from "./helpers/fixture-identity.js";

for (const theme of PARITY_THEMES) for (const width of [1024, 1440]) {
  test(`centered queue footers and retained Archive snapshots @ ${theme.attribute}-${width}`, async ({ page }, info) => {
    ensureParityBundle();
    const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
    const errors: string[] = [], writes: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("request", request => { if (request.method() !== "GET") writes.push(new URL(request.url()).pathname); });
    try {
      await page.setViewportSize({ width, height: 900 }); await installTheme(page, theme);
      await page.goto(`${server.baseUrl}/?day=${FIXTURE_DAY}`);
      const rail = page.getByRole("navigation", { name: "Workflows", exact: true });
      await expect(page.locator("[data-queue-row-footer]").first()).toBeVisible();
      const checkFooters = async () => {
        const footers = page.locator("[data-queue-row-footer]");
        expect(await footers.count()).toBeGreaterThan(0);
        for (const footer of await footers.all()) {
          const bounds = (await footer.boundingBox())!;
          const metadata = (await footer.locator(":scope > div").first().boundingBox())!;
          expect(Math.abs(metadata.y + metadata.height / 2 - bounds.y - bounds.height / 2)).toBeLessThanOrEqual(1);
          for (const control of await footer.getByRole("button").all()) {
            const box = (await control.boundingBox())!;
            expect(Math.abs(box.y + box.height / 2 - bounds.y - bounds.height / 2)).toBeLessThanOrEqual(metadata.height > 32 ? metadata.height / 2 : 1);
            const icon = control.locator("svg");
            if (await icon.count()) {
              const iconBox = (await icon.boundingBox())!;
              expect(Math.abs(iconBox.y + iconBox.height / 2 - box.y - box.height / 2)).toBeLessThanOrEqual(1);
            }
          }
          const actions = footer.locator(":scope > div").last();
          for (const button of await actions.getByRole("button").all()) {
            const box = (await button.boundingBox())!;
            expect(box.width).toBe(24); expect(box.height).toBe(24);
            expect(Math.abs(box.y + box.height / 2 - bounds.y - bounds.height / 2)).toBeLessThanOrEqual(1);
          }
        }
      };
      await checkFooters();
      const served = page.locator("[data-demo-row-id]:not(tr)").first();
      const servedTitle = await served.locator("[data-demo-row-title]").innerText();
      await served.click({ button: "right" });
      await page.getByRole("menuitem", { name: "Archive", exact: true }).click();
      await expect(page.getByText("1 run archived", { exact: true })).toBeVisible();

      await rail.getByRole("button", { name: "Oath Upload", exact: true }).click();
      const logs = page.getByRole("region", { name: "Selected run logs", exact: true });
      await logs.getByRole("button", { name: "Open OCR", exact: true }).click();
      await logs.getByRole("button", { name: /^Records \d+$/u }).click();
      const record = logs.getByRole("region", { name: "Record person-1", exact: true });
      await record.getByRole("textbox", { name: "Notes", exact: true }).fill("Reviewed before archiving");
      const source = page.locator("[data-demo-row-id]:not(tr)").filter({ hasText: "multiple-oath.pdf" });
      await checkFooters();
      await source.focus(); await page.keyboard.press("Shift+F10");
      for (const name of ["Retry", "Archive", "Delete"]) await expect(page.getByRole("menuitem", { name, exact: true })).toBeVisible();
      await info.attach(`queue-footer-${theme.attribute}-${width}.png`, { body: await page.screenshot(), contentType: "image/png" });
      await info.attach(`queue-footer-${theme.attribute}-${width}.yml`, { body: await page.getByRole("main").ariaSnapshot(), contentType: "text/yaml" });
      await page.getByRole("menuitem", { name: "Archive", exact: true }).click();
      await expect(source).toHaveCount(0);
      await expect(page.getByText("2 runs archived", { exact: true })).toBeVisible();
      await expect(page.locator("[data-demo-row-id]:not(tr)").first()).toBeFocused();
      await rail.getByRole("button", { name: "Oath Upload", exact: true }).click();
      await expect(page.locator("[data-demo-row-id]:not(tr)")).toHaveCount(0);

      await page.getByRole("button", { name: "Settings", exact: true }).click();
      await page.getByRole("link", { name: "Archive", exact: true }).click();
      const archive = page.getByRole("region", { name: "Archive", exact: true });
      const version = archive.getByRole("region", { name: "Version not recorded", exact: true });
      await expect(version.locator(`[data-archive-workflow="${WORKFLOW_ID}"]`)).toBeVisible();
      await version.getByRole("button", { name: /^OCR/u }).click();
      const table = archive.getByRole("table", { name: "Saved reports", exact: true });
      await expect(table).toContainText("multiple-oath.pdf");
      await expect(table).toContainText("Review"); await expect(table).toContainText("Not completed");
      await table.getByRole("button", { name: "Open report for multiple-oath.pdf", exact: true }).click();
      const report = page.getByRole("article", { name: "Saved run report", exact: true });
      await expect(report).toContainText("Reviewed before archiving");
      await expect(report).toContainText("Not completed");
      await expect(report).not.toContainText("The workflow completed.");
      await report.getByRole("button", { name: "Logs", exact: true }).click();
      await expect(report.getByRole("region", { name: "Selected run logs", exact: true })).toContainText("Review extracted records");
      await expect(report.getByRole("button", { name: /Approve|Continue|Rerun/u })).toHaveCount(0);
      await info.attach(`archived-ocr-${theme.attribute}-${width}.png`, { body: await page.screenshot(), contentType: "image/png" });
      await info.attach(`archived-ocr-${theme.attribute}-${width}.yml`, { body: await report.ariaSnapshot(), contentType: "text/yaml" });
      await archive.getByRole("button", { name: "Archive", exact: true }).click();
      await version.locator(`[data-archive-workflow="${WORKFLOW_ID}"]`).click();
      await expect(table).toContainText(servedTitle);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(errors).toEqual([]); expect(writes).toEqual([]);
    } finally { await server.close(); }
  });
}
