import { expect, test } from '@playwright/test';
import { ensureParityBundle, PARITY_DIST_DIR } from './helpers/bundle.js';
import { installTheme, PARITY_THEMES } from './helpers/capture.js';
import { startFixtureServer } from './helpers/fixture-bff.js';

for (const theme of PARITY_THEMES) for (const width of [1024, 1440]) {
 test(`Settings Data navigation, archive details and original spreadsheet sizing @ ${theme.attribute} ${width}`, async ({ page }, info) => {
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
   await expect(data.getByRole('link')).toHaveText(['Explorer', 'Archive', 'Activity']);
   await expect(nav.getByRole('link', { name: 'Spreadsheets', exact: true })).toHaveCount(1);
   await expect(data.getByRole('link', { name: 'Spreadsheets', exact: true })).toHaveCount(0);
   await nav.getByRole('link', { name: 'Archive', exact: true }).click();
   await expect(page).toHaveURL(/settings=archive/);
   await expect(settings.getByRole('heading', { name: 'Archive', exact: true })).toBeVisible();
   await settings.getByRole('region', { name: 'Dashboard 1.3', exact: true }).getByRole('button', { name: /^Separations/ }).click();
   await expect(settings.getByRole('table', { name: 'Saved reports' }).getByRole('row')).toHaveCount(5);
   await settings.getByRole('button', { name: 'Open report for Jordan Lee', exact: true }).click();
   const deepLink = page.url();
   await expect(settings.getByRole('heading', { name: /Jordan Lee/ })).toBeVisible();
   await page.reload();
   await expect(page).toHaveURL(deepLink);
   await expect(settings.getByRole('heading', { name: /Jordan Lee/ })).toBeVisible();
   await settings.getByRole('button', { name: 'Workflow details', exact: true }).click();
   await expect(settings).toContainText('Dashboard version');
   await expect(settings).toContainText('Workflow version');
   await settings.getByRole('button', { name: 'Logs', exact: true }).click();
   await expect(settings.getByRole('region', { name: 'Selected run logs', exact: true })).toBeVisible();
   const bump = settings.getByRole('button', { name: 'Plan a bump', exact: true });
   await bump.click();
   await expect(page.getByRole('dialog', { name: 'Plan a version bump', exact: true })).toBeVisible();
   await page.getByRole('button', { name: 'Cancel', exact: true }).click();
   await expect(bump).toBeFocused();
   await nav.getByRole('link', { name: 'Activity', exact: true }).click();
   await expect(settings.getByRole('heading', { name: 'Activity', exact: true })).toBeVisible();
   await page.goBack();
   await expect(settings.getByRole('heading', { name: /Jordan Lee/ })).toBeVisible();
   await nav.getByRole('link', { name: 'Explorer', exact: true }).click();
   await expect(settings.getByRole('heading', { name: 'Explorer', exact: true })).toBeVisible();
   await nav.getByRole('link', { name: 'Spreadsheets', exact: true }).click();
   await expect(settings.getByRole('heading', { name: 'Spreadsheets', exact: true })).toBeVisible();
   await expect(settings.getByRole('button', { name: /Expand spreadsheets|Collapse spreadsheets/ })).toHaveCount(0);
   await expect(page.locator('html')).not.toHaveAttribute('data-dashboard-density', 'compact');
   expect(await page.evaluate(() => getComputedStyle(document.documentElement).zoom)).toBe('1');
   expect((await page.getByRole('banner').boundingBox())!.height).toBe(54);
   expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
   await info.attach('settings-spreadsheets.png', { body: await page.screenshot(), contentType: 'image/png' });
   expect(errors).toEqual([]); expect(writes).toEqual([]);
  } finally { await server.close(); }
 });
}
