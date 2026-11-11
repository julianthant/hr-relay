import { expect } from '@playwright/test';
import { test } from "./helpers/fixtures.js";
import { PARITY_DIST_DIR } from './helpers/bundle.js';
import { startFixtureServer } from '../support/helpers/dashboard/fixture-bff.js';
import { installTheme, PARITY_THEMES } from './helpers/capture.js';



for (const theme of PARITY_THEMES) for (const width of [1024, 1440]) {

test(`the Logs single-date calendar @ ${theme.attribute}-${width}`, async ({ page }, _info) => {
    const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: 'working-tree' } });
    try {
      await page.setViewportSize({ width, height: 900 });
      await page.clock.setFixedTime(new Date('2026-09-26T12:00:00Z'));
      await installTheme(page, theme);
      const writes: string[] = [], errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('request', request => { if (request.method() !== 'GET') writes.push(request.url()); });
      await page.goto(`${server.baseUrl}/`);
      const date = page.locator('.dashboard-log-date').getByRole('button', { name: /^Choose date/u });
      await date.click();
      const single = page.getByRole('dialog', { name: 'Choose date', exact: true });
      await expect(single).toHaveCSS('opacity', '1');
      await expect(single.getByRole('grid')).toHaveCount(1);
      await expect(single.getByRole('button', { name: /Tuesday, August 4, 2026/u })).toBeDisabled();
      await page.keyboard.press('Escape');
      await expect(date).toBeFocused();

      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(writes).toEqual([]);
      expect(errors).toEqual([]);
    } finally { await server.close(); }
  });
}

test('default DatePicker fields and the shared range preserve typed dates and update both endpoints', async ({ page }) => {
  const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: 'working-tree' } });
  try {
    await page.goto(`${server.baseUrl}/kit.html#forms`);
    const forms = page.locator('#forms');
    await forms.getByRole('button', { name: 'Choose start date Start date', exact: true }).click();
    const picker = page.getByRole('dialog', { name: 'Choose start date', exact: true });
    await picker.getByRole('button', { name: /year selector/u }).click();
    await picker.getByRole('button', { name: '2025', exact: true }).click();
    await expect(picker.getByRole('button', { name: 'December 2025, year selector', exact: true })).toBeVisible();
    await picker.getByRole('button', { name: /Wednesday, December 17, 2025/u }).click();
    await expect(picker).toHaveCount(0);
    await expect(forms.getByRole('group', { name: 'Start date', exact: true }).getByRole('spinbutton', { name: /^year/u })).toHaveText('2025');
    await forms.getByRole('button', { name: 'Open launch controls', exact: true }).click();
    const launch = page.getByRole('dialog', { name: 'Launch controls', exact: true });
    const text = launch.getByRole('textbox', { name: 'Last day worked', exact: true });
    await text.fill('02/30/2026');
    await expect(text).toHaveValue('02/30/2026');
    await expect(text.locator('xpath=ancestor::*[@data-invalid][1]')).toBeVisible();
    await text.fill('07/16/2026');
    await launch.getByRole('button', { name: /^Choose last day worked/u }).click();
    const nested = page.getByRole('dialog', { name: 'Choose last day worked', exact: true });
    await nested.getByRole('button', { name: /Friday, July 17, 2026/u }).click();
    await expect(text).toHaveValue('07/17/2026');
    await launch.getByRole('button', { name: 'Close controls', exact: true }).click();
    const pair = forms.getByRole('group', { name: 'Choose specimen date range', exact: true });
    await pair.getByRole('button', { name: /^Choose start date range/u }).click();
    const range = page.getByRole('dialog', { name: 'Choose specimen date range', exact: true });
    await range.getByRole('grid').first().getByRole('button', { name: /Friday, July 31, 2026/u }).click();
    await range.getByRole('grid').nth(1).getByRole('button', { name: /Sunday, August 2, 2026/u }).click();
    await expect(range).toHaveCount(0);
    await expect(pair.getByRole('spinbutton', { name: /^month, Start/u })).toHaveText('07');
    await expect(pair.getByRole('spinbutton', { name: /^day, Start/u })).toHaveText('31');
    await expect(pair.getByRole('spinbutton', { name: /^month, End/u })).toHaveText('08');
    await expect(pair.getByRole('spinbutton', { name: /^day, End/u })).toHaveText('02');
    const endDay = pair.getByRole('spinbutton', { name: /^day, End/u });
    await endDay.focus();
    await endDay.press('Alt+ArrowDown');
    await expect(range).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(endDay).toBeFocused();
  } finally { await server.close(); }
});
