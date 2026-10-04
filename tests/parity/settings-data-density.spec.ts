import { expect, test } from '@playwright/test';
import { ensureParityBundle, PARITY_DIST_DIR } from './helpers/bundle.js';
import { installTheme, PARITY_THEMES } from './helpers/capture.js';
import { startFixtureServer } from './helpers/fixture-bff.js';

for (const theme of PARITY_THEMES) for (const width of [1024, 1440]) {
  test(`compact density and Settings Data navigation @ ${theme.attribute}-${width}`, async ({ page }, info) => {
    ensureParityBundle();
    const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: 'working-tree' } });
    try {
      const height = 900;
      await page.setViewportSize({ width, height });
      await installTheme(page, theme);
      const writes: string[] = [], errors: string[] = [];
      page.on('request', request => { if (request.method() !== 'GET') writes.push(request.url()); });
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(server.baseUrl);
      const banner = page.getByRole('banner');
      await expect(page.locator('html')).toHaveCSS('zoom', '0.9');
      await expect(banner.getByRole('navigation', { name: 'Main navigation' })).toHaveCount(0);
      for (const label of ['Explorer', 'Archive', 'Activity']) await expect(banner.getByRole('button', { name: label, exact: true })).toHaveCount(0);
      expect((await banner.boundingBox())!.height).toBeCloseTo(54 * .9, 1);
      const search = (await banner.locator('.navbar-search').boundingBox())!;
      expect(search.width).toBe(460 * .9);
      expect(search.x + search.width / 2).toBeCloseTo(width / 2, 1);
      const root = (await page.locator('[data-app-root]').boundingBox())!;
      expect(root.width).toBe(width);
      expect(root.y + root.height).toBe(height);
      await banner.getByRole('button', { name: 'Settings', exact: true }).click();
      const settings = page.getByRole('region', { name: 'Settings', exact: true });
      const nav = settings.getByRole('navigation', { name: 'Settings sections' });
      const data = nav.locator('div').filter({ has: page.locator(':scope > span', { hasText: /^Data$/u }) }).first();
      await expect(data.getByRole('link')).toHaveText(['Explorer', 'Archive', 'Activity', 'Spreadsheets']);
      const standardWidth = (await page.locator('.settings-tab-body').boundingBox())!.width;
      for (const [label, section, region] of [
        ['Explorer', 'explorer', 'Workflow explorer preview'],
        ['Archive', 'archive', 'Archive mock'],
        ['Activity', 'activity', 'Activity report'],
      ] as const) {
        await nav.getByRole('link', { name: label, exact: true }).click();
        expect(new URL(page.url()).searchParams.get('settings')).toBe(section);
        await expect(nav.getByRole('link', { name: label, exact: true })).toHaveAttribute('aria-current', 'page');
        await expect(settings).toBeVisible();
        await expect(settings.getByRole('region', { name: region, exact: true })).toBeVisible();
        await expect(banner.getByRole('button', { name: 'Settings', exact: true })).toHaveAttribute('aria-pressed', 'true');
      }
      await nav.getByRole('link', { name: 'Spreadsheets', exact: true }).click();
      const sheets = settings.getByRole('region', { name: 'Spreadsheets', exact: true });
      await expect(sheets).toHaveAttribute('data-expanded', 'false');
      const collapsedWidth = (await sheets.boundingBox())!.width;
      expect(collapsedWidth).toBeCloseTo(standardWidth, 1);
      await sheets.getByRole('button', { name: 'Expand spreadsheets', exact: true }).click();
      await expect(sheets.getByRole('button', { name: 'Collapse spreadsheets', exact: true })).toHaveAttribute('aria-expanded', 'true');
      const expandedWidth = (await sheets.boundingBox())!.width;
      if (width === 1440) expect(expandedWidth).toBeGreaterThan(collapsedWidth + 300);
      await sheets.getByRole('button', { name: '26–27 Student applicants.xlsx', exact: true }).click();
      await expect(sheets.getByRole('table', { name: 'Registered spreadsheet rows' })).toBeVisible();
      await sheets.getByRole('searchbox', { name: 'Search mapped data' }).fill('Jordan');
      await expect(sheets.getByRole('table').getByRole('row')).toHaveCount(2);
      await sheets.getByRole('button', { name: 'Collapse spreadsheets', exact: true }).click();
      await expect(sheets.getByRole('heading', { name: '26–27 Student applicants.xlsx', exact: true })).toBeVisible();
      await expect(sheets.getByRole('searchbox', { name: 'Search mapped data' })).toHaveValue('Jordan');
      expect((await sheets.boundingBox())!.width).toBeCloseTo(collapsedWidth, 1);
      await info.attach(`spreadsheets-${theme.attribute}-${width}.png`, { body: await page.screenshot({ animations: 'disabled' }), contentType: 'image/png' });
      await sheets.getByRole('button', { name: 'Expand spreadsheets', exact: true }).click();
      await nav.getByRole('link', { name: 'General', exact: true }).click();
      await nav.getByRole('link', { name: 'Spreadsheets', exact: true }).click();
      await expect(sheets).toHaveAttribute('data-expanded', 'false');
      await expect(sheets.getByRole('table', { name: 'Registered spreadsheets', exact: true })).toBeVisible();
      await banner.getByRole('button', { name: 'Dashboard', exact: true }).click();
      await expect(settings).toHaveCount(0);
      await expect(page.getByRole('group', { name: 'Queue actions', exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(errors).toEqual([]);
      expect(writes).toEqual([]);
    } finally { await server.close(); }
  });
}

test('existing Data deep links keep their page state inside Settings through reload and history', async ({ page }) => {
  ensureParityBundle();
  const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: 'working-tree' } });
  try {
    for (const [route, section, label] of [
      ['archive=&archiveDashboard=1.3&archiveWorkflow=archive-demo-separation', 'archive', 'Archive'],
      ['activity=2026-09-21..2026-09-26', 'activity', 'Activity'],
      ['explore=fixture-ui-explorer', 'explorer', 'Explorer'],
    ] as const) {
      await page.goto(`${server.baseUrl}/?${route}`);
      const nav = page.getByRole('region', { name: 'Settings', exact: true }).getByRole('navigation', { name: 'Settings sections' });
      await expect(nav.getByRole('link', { name: label, exact: true })).toHaveAttribute('aria-current', 'page');
      if (section === 'archive') await expect(page.getByRole('table', { name: 'Saved reports' })).toBeVisible();
      if (section === 'activity') await expect(page.getByRole('group', { name: 'Custom report range', exact: true })).toBeVisible();
      await page.reload();
      await expect(nav.getByRole('link', { name: label, exact: true })).toHaveAttribute('aria-current', 'page');
      await nav.getByRole('link', { name: 'Spreadsheets', exact: true }).click();
      await page.goBack();
      await expect(page).toHaveURL(`${server.baseUrl}/?${route}`);
      await expect(nav.getByRole('link', { name: label, exact: true })).toHaveAttribute('aria-current', 'page');
    }
  } finally { await server.close(); }
});
