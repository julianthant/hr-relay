import { expect, test } from "@playwright/test";
import { ensureParityBundle, PARITY_DIST_DIR } from "./helpers/bundle.js";
import { installTheme, PARITY_THEMES } from "./helpers/capture.js";
import { startFixtureServer } from "./helpers/fixture-bff.js";
import { FIXTURE_DAY } from "./helpers/fixture-identity.js";

for (const theme of PARITY_THEMES) for (const width of [1024, 1440]) {
  test(`centered queue footers without a row context menu @ ${theme.attribute}-${width}`, async ({ page }, info) => {
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
      await info.attach(`queue-footer-${theme.attribute}-${width}.png`, { body: await page.screenshot(), contentType: 'image/png' });
      await info.attach(`queue-footer-${theme.attribute}-${width}.yml`, { body: await page.getByRole('main').ariaSnapshot(), contentType: 'text/yaml' });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(errors).toEqual([]); expect(writes).toEqual([]);
    } finally { await server.close(); }
  });
}
