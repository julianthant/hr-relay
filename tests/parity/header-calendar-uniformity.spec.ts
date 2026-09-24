import { expect, test } from '@playwright/test';
import { ensureParityBundle, PARITY_DIST_DIR } from './helpers/bundle.js';
import { startSeededServer } from './helpers/seeded-bff.js';
import { gotoAppState } from './helpers/app-driver.js';
import { installTheme, PARITY_THEMES } from './helpers/capture.js';

for (const theme of PARITY_THEMES) {
  test(`takeover headers and calendars share dashboard dimensions in ${theme.name}`, async ({ page }) => {
    ensureParityBundle();
    const server = await startSeededServer({ distDir: PARITY_DIST_DIR, bundle: { proof: 'working-tree' }, dateNavigation: true });
    try {
      await page.setViewportSize({ width: 1024, height: 768 });
      await installTheme(page, theme);
      await gotoAppState(page, server.baseUrl, { day: '2026-07-30' });

      await page.getByRole('button', { name: /^Pick a day/ }).click();
      const dashboardWidth = await page.getByRole('dialog', { name: 'Pick a day' }).evaluate(el => el.getBoundingClientRect().width);
      await page.keyboard.press('Escape');

      for (const [tab, title] of [['Explorer', 'Explorer'], ['Archive', 'Archive'], ['Activity', 'Activity report']] as const) {
        await page.getByRole('button', { name: tab, exact: true }).click();
        const dimensions = await page.getByText(title, { exact: true }).last().locator('xpath=ancestor::header').evaluate(el => ({
          height: el.getBoundingClientRect().height,
          scrollWidth: el.scrollWidth,
          clientWidth: el.clientWidth,
        }));
        expect(dimensions.height).toBe(38);
        expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
      }

      await page.getByRole('button', { name: 'Choose from date' }).click();
      await expect(page.locator('.date-picker__popover')).toHaveCSS('opacity', '1');
      const fieldWidth = await page.locator('.date-picker__popover').evaluate(el => el.getBoundingClientRect().width);
      expect(fieldWidth).toBe(dashboardWidth);
      await page.getByRole('button', { name: /Sunday, August 2, 2026/ }).click();
      await expect(page).toHaveURL(/activity=2026-08-02\.\.2026-08-03/);
    } finally {
      await server.close();
    }
  });
}
