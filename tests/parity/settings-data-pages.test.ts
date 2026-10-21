
import { expect, test } from '@playwright/test';
import { ensureParityBundle, PARITY_DIST_DIR } from './helpers/bundle.js';
import { installTheme, PARITY_THEMES } from './helpers/capture.js';
import { startFixtureServer } from '../support/helpers/dashboard/fixture-bff.js';

for (const theme of PARITY_THEMES) for (const width of [1024, 1440]) {
 test(`Settings Data navigation and approved HUB spreadsheet sizing @ ${theme.attribute} ${width}`, async ({ page }, _info) => {
  ensureParityBundle();
  const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: 'working-tree' } });
  const errors: string[] = [], writes: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (request.method() !== 'GET') writes.push(`${request.method()} ${new URL(request.url()).pathname}`); });
  try {
   await page.setViewportSize({ width, height: width === 1024 ? 720 : 1000 });
   await installTheme(page, theme);
   await page.goto(`${server.baseUrl}/?settings=general`);
   const settings = page.getByRole('region', { name: 'Settings', exact: true });
   const nav = settings.getByRole('navigation', { name: 'Settings sections' });
   const data = nav.locator('div').filter({ has: page.locator(':scope > span', { hasText: /^Data$/ }) }).first();
   await expect(data.getByRole('link')).toHaveText(['Spreadsheets', 'Explorer', 'Analytics']);
   await expect(nav.getByRole('link', { name: 'Spreadsheets', exact: true })).toHaveCount(1);
   await expect(data.getByRole('link', { name: 'Spreadsheets', exact: true })).toHaveCount(1);
   await nav.getByRole('link', { name: 'Analytics', exact: true }).click();
   await expect(settings.getByRole('heading', { name: 'Analytics', exact: true })).toBeVisible();
   await nav.getByRole('link', { name: 'Explorer', exact: true }).click();
   await expect(settings.getByRole('heading', { name: 'Explorer', exact: true })).toBeVisible();
   await nav.getByRole('link', { name: 'Spreadsheets', exact: true }).click();
   await expect(settings.getByRole('heading', { name: 'Spreadsheets', exact: true })).toBeVisible();
   await expect(settings.getByRole('button', { name: /Expand spreadsheets|Collapse spreadsheets/ })).toHaveCount(0);
   await expect(page.locator('html')).not.toHaveAttribute('data-dashboard-density', 'compact');
   expect(await page.evaluate(() => getComputedStyle(document.documentElement).zoom)).toBe('1');
   await expect(page.getByRole('banner')).toHaveCount(0);
   expect((await nav.boundingBox())!.width).toBe(width === 1024 ? 210 : 244);
   expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

   expect(errors).toEqual([]); expect(writes).toEqual([]);
  } finally { await server.close(); }
 });
}
