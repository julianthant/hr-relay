
import { expect } from '@playwright/test';
import { test } from "./helpers/fixtures.js";
import { createHash } from 'node:crypto';
import { PARITY_DIST_DIR } from './helpers/bundle.js';
import { installTheme, PARITY_THEMES } from './helpers/capture.js';
import { startFixtureServer } from '../support/helpers/dashboard/fixture-bff.js';

for (const theme of PARITY_THEMES) for (const width of [1024, 1440]) {
  const evidenceName = `duration-${theme.attribute}-${width}.a11y.yml`;
  test(`Workflow duration chart retains measurement and loading geometry @ ${theme.attribute} ${width}`, { annotation: [{ type: "required-a11y-evidence", description: evidenceName }] }, async ({ page }, info) => {
    const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: 'working-tree' } });
    const errors: string[] = [];
    const writes: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (request.method() !== 'GET') writes.push(`${request.method()} ${request.url()}`); });
    try {
      await page.setViewportSize({ width, height: 900 });
      await installTheme(page, theme);
      await page.goto(`${server.baseUrl}/?settings=activity`);
      const chart = page.getByRole('figure', { name: 'Average workflow time', exact: true });
      await expect(chart).toBeVisible();
      await chart.scrollIntoViewIfNeeded();
      const rows = chart.getByRole('listitem');
      await expect(rows).toHaveCount(2);
      await expect(rows.first()).toContainText('Separations');
      await expect(rows.first()).toContainText('24 of 24 completed runs timed');
      await expect(rows.first().locator('.activity-duration-value')).toHaveText('2m 18s');
      await expect(rows.nth(1)).toContainText('10 of 14 completed runs timed');
      await expect(rows.nth(1).locator('.activity-duration-value')).toHaveText('2m 14s');
      const bars = await chart.locator('.activity-duration-bar').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().width));
      expect(bars[0] / bars[1]).toBeCloseTo((3303 / 24) / (1340 / 10), 2);
      await expect(chart.locator('.activity-duration-ticks > span').first()).toHaveText('0s');
      await expect(page.getByRole('heading', { name: 'Time saved', exact: true })).toHaveCount(0);
      await expect(page.getByRole('table', { name: 'Manual work baselines', exact: true })).toHaveCount(0);
      const loaded = (await chart.locator('.activity-duration-chart').boundingBox())!;

      const tree = await page.locator("body").ariaSnapshot();
      info.annotations.push({ type: `a11y-attachment-sha256:${evidenceName}`, description: createHash("sha256").update(tree).digest("hex") });
      await info.attach(evidenceName, { body: tree, contentType: 'text/yaml' });

      await page.goto(`${server.baseUrl}/?settings=activity&activityPreview=loading`);
      const skeleton = page.locator('.activity-duration-chart');
      await expect(skeleton).toBeVisible();
      const loading = (await skeleton.boundingBox())!;
      expect(loading.width).toBe(loaded.width);
      expect(loading.height).toBe(loaded.height);
      await expect(skeleton.locator('.activity-duration-row')).toHaveCount(2);

      await page.goto(`${server.baseUrl}/?settings=activity&activityPreview=incomplete`);
      await expect(chart.getByText('Not timed', { exact: true })).toHaveCount(2);
      await expect(chart.locator('.activity-duration-bar')).toHaveCount(0);
      await expect(chart.getByRole('listitem').first()).toContainText('0 of 24 completed runs timed');

      await page.goto(`${server.baseUrl}/?settings=activity&activityPreview=empty`);
      await expect(chart).toContainText('No workflow activity in this period');
      await expect(chart.getByRole('listitem')).toHaveCount(0);
      await page.goto(`${server.baseUrl}/?settings=activity&activityPreview=unavailable`);
      await expect(page.getByRole('alert')).toContainText('The report is unavailable.');
      await expect(chart).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(errors).toEqual([]);
      expect(writes).toEqual([]);
    } finally { await server.close(); }
  });
}
