import { expect, test } from '@playwright/test';
import { ensureParityBundle, PARITY_DIST_DIR } from './helpers/bundle.js';
import { startSeededServer } from './helpers/seeded-bff.js';
import { gotoAppState } from './helpers/app-driver.js';
import { installTheme, PARITY_THEMES } from './helpers/capture.js';

for (const theme of PARITY_THEMES) {
  test(`takeover headers and calendars share dashboard dimensions in ${theme.name}`, async ({ page }, info) => {
    ensureParityBundle();
    const server = await startSeededServer({ distDir: PARITY_DIST_DIR, bundle: { proof: 'working-tree' }, dateNavigation: true });
    try {
      await page.setViewportSize({ width: 1024, height: 768 });
      await installTheme(page, theme);
      await gotoAppState(page, server.baseUrl, { day: '2026-07-30' });

      await page.getByRole('button', { name: /^Pick a day/ }).click();
      const dashboardPicker = page.getByRole('dialog', { name: 'Pick a day' });
      const dashboardWidth = await dashboardPicker.evaluate(el => el.getBoundingClientRect().width);
      const dashboardOffset = await dashboardPicker.evaluate(el => {
        const calendar = el.querySelector('.ds-hero-calendar');
        if (calendar === null) throw new Error('dashboard calendar missing');
        const frame = el.getBoundingClientRect();
        const grid = calendar.getBoundingClientRect();
        return Math.abs((frame.left + frame.right) / 2 - (grid.left + grid.right) / 2);
      });
      expect(dashboardOffset).toBeLessThanOrEqual(1);
      await dashboardPicker.screenshot({ path: info.outputPath(`dashboard-calendar-${theme.name}.png`) });
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
        if (tab !== 'Activity') {
          const header = page.getByText(title, { exact: true }).last().locator('xpath=ancestor::header');
          await expect(header.getByRole('button')).toHaveCount(0);
          await expect(header).not.toContainText('read-only');
        }
      }

      await page.getByRole('button', { name: /^Select report dates:/ }).click();
      const picker = page.getByRole('dialog', { name: 'Select report dates' });
      await expect(picker).toBeVisible();
      await expect(picker).toHaveCSS('opacity', '1');
      await expect(picker.getByText('Select report dates', { exact: true })).toHaveCount(0);
      const activityOffset = await picker.evaluate(el => {
        const calendar = el.querySelector('.ds-hero-calendar');
        if (calendar === null) throw new Error('activity calendar missing');
        const frame = el.getBoundingClientRect();
        const grid = calendar.getBoundingClientRect();
        return Math.abs((frame.left + frame.right) / 2 - (grid.left + grid.right) / 2);
      });
      expect(activityOffset).toBeLessThanOrEqual(1);
      await picker.screenshot({ path: info.outputPath(`activity-range-calendar-${theme.name}.png`) });
      const fieldWidth = await picker.evaluate(el => el.getBoundingClientRect().width);
      expect(fieldWidth).toBe(dashboardWidth);
      await picker.getByRole('button', { name: /Sunday, August 2, 2026/ }).click();
      await picker.getByRole('button', { name: /Monday, August 3, 2026/ }).click();
      await expect(page).toHaveURL(/activity=2026-08-02\.\.2026-08-03/);
      await page.getByRole('button', { name: /^Select report dates:/ }).click();
      await picker.getByRole('button', { name: /Wednesday, August 5, 2026/ }).click();
      await picker.getByRole('button', { name: /Wednesday, August 5, 2026/ }).click();
      await expect(page).toHaveURL(/activity=2026-08-05\.\.2026-08-05/);
      await page.getByRole('button', { name: /^Select report dates:/ }).click();
      await picker.getByRole('button', { name: /Next month/i }).click();
      await picker.getByRole('button', { name: /Next month/i }).click();
      await picker.getByRole('button', { name: /Wednesday, October 14, 2026/ }).click();
      await picker.getByRole('button', { name: /Wednesday, October 14, 2026/ }).click();
      await expect(page).toHaveURL(/activity=2026-10-14\.\.2026-10-14/);
      await page.getByRole('button', { name: /^Select report dates:/ }).click();
      await expect(picker).toHaveCSS('opacity', '1');
      await picker.screenshot({ path: info.outputPath(`activity-single-day-calendar-${theme.name}.png`) });
    } finally {
      await server.close();
    }
  });
}
