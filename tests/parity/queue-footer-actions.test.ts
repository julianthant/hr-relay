
import { expect } from "@playwright/test";
import { test } from "./helpers/fixtures.js";
import { PARITY_DIST_DIR } from "./helpers/bundle.js";
import { installTheme, PARITY_THEMES } from "./helpers/capture.js";
import { startFixtureServer } from "../support/helpers/dashboard/fixture-bff.js";
import { FIXTURE_DAY } from "./helpers/fixture-identity.js";
import { attachShellA11y } from "./helpers/shell-proof.js";

for (const theme of PARITY_THEMES) for (const width of [1024, 1280, 1440, 1920]) {
  const evidence = `queue-footer-${theme.attribute}-${width}.a11y.yml`;
  const floorEvidence = `queue-footer-floor-${theme.attribute}.a11y.yml`;
  test(`single-line queue footers without a row context menu @ ${theme.attribute}-${width}`, {
    annotation: [evidence, ...(width === 1024 ? [floorEvidence] : [])].map(description => ({ type: "required-a11y-evidence", description })),
  }, async ({ page }, info) => {
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
          const metadataRow = footer.locator(":scope > div").first();
          const metadata = (await metadataRow.boundingBox())!;
          expect(metadata.height).toBe(24);
          expect(await footer.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
          for (const fact of await metadataRow.locator(":scope > *").all()) {
            const box = (await fact.boundingBox())!;
            expect(Math.abs(box.y + box.height / 2 - metadata.y - metadata.height / 2)).toBeLessThanOrEqual(1);
            expect(box.x).toBeGreaterThanOrEqual(metadata.x);
            expect(box.x + box.width).toBeLessThanOrEqual(metadata.x + metadata.width + 1);
            expect(await fact.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
          }
          expect(Math.abs(metadata.y + metadata.height / 2 - bounds.y - bounds.height / 2)).toBeLessThanOrEqual(1);
          for (const control of await footer.getByRole("button").all()) {
            const box = (await control.boundingBox())!;
            expect(Math.abs(box.y + box.height / 2 - bounds.y - bounds.height / 2)).toBeLessThanOrEqual(1);
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
      if (width === 1024) {
        for (const resizedWidth of [1100, 1215, 1216, 1217, 1366, 1439, 1440, 1920, 1024]) {
          await page.setViewportSize({ width: resizedWidth, height: 900 });
          await checkFooters();
          expect((await page.locator('.dashboard-queue-column').boundingBox())!.width).toBeGreaterThanOrEqual(376);
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        }
        await page.setViewportSize({ width: 900, height: 600 });
        await checkFooters();
        expect((await page.locator('[data-app-root]').boundingBox())!.width).toBe(1024);

        await attachShellA11y(page, info, floorEvidence);
        await page.setViewportSize({ width, height: 900 });
        await page.evaluate(() => scrollTo(0, 0));
      }
      const served = page.locator('[data-demo-row-id]:not(tr)').first();
      await served.click({ button: 'right' });
      await expect(page.getByRole('menu')).toHaveCount(0);
      await served.focus(); await page.keyboard.press('Shift+F10');
      await expect(page.getByRole('menu')).toHaveCount(0);
      await page.keyboard.press('m'); await expect(page.getByRole('menu')).toHaveCount(0);
      await served.dblclick(); await expect(page.getByRole('menu')).toHaveCount(0);
      await rail.getByRole('button', { name: 'Oath Upload', exact: true }).click();
      await checkFooters();
      const source = page.locator('[data-demo-row-id]:not(tr)').filter({ hasText: 'multiple-oath.pdf' });
      await expect(source.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
      await expect(source.getByRole('button', { name: 'Delete', exact: true })).toBeVisible();
      await source.click({ button: 'right' }); await expect(page.getByRole('menu')).toHaveCount(0);

      await attachShellA11y(page, info, evidence);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(errors).toEqual([]); expect(writes).toEqual([]);
    } finally { await server.close(); }
  });
}
