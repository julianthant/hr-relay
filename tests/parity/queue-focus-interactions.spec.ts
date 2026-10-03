import { createHash } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { ensureParityBundle, PARITY_DIST_DIR } from './helpers/bundle.js';
import { startFixtureServer } from './helpers/fixture-bff.js';
import { installTheme, PARITY_THEMES } from './helpers/capture.js';
import { FIXTURE_DAY } from './helpers/fixture-identity.js';
import { FIXTURE_DAY_WIRE } from './helpers/fixture-queue.js';

const failed = FIXTURE_DAY_WIRE.queueSurfaces.find(row => row.surfaceKind === 'single' && row.status === 'failed');
if (failed === undefined) throw new Error('Focus verification requires a failed single-row fixture');

for (const theme of PARITY_THEMES) for (const width of [1024, 1440]) {
  const evidence = `queue-focus-${theme.attribute}-${width}.a11y.yml`;
  test(`approved Focus queue and Run input @ ${theme.attribute} ${width}`, { annotation: [{ type: 'required-a11y-evidence', description: evidence }] }, async ({ page }, info) => {
    ensureParityBundle();
    const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: 'working-tree' } });
    try {
      const writes: string[] = [], errors: string[] = [];
      page.on('request', request => { if (request.method() !== 'GET') writes.push(`${request.method()} ${new URL(request.url()).pathname}`); });
      page.on('pageerror', error => errors.push(error.message));
      await page.setViewportSize({ width, height: 900 });
      await installTheme(page, theme);
      await page.goto(`${server.baseUrl}/?day=${FIXTURE_DAY}`);
      const bar = page.getByRole('group', { name: 'Queue actions', exact: true });
      const launcher = bar.getByRole('button', { name: /^Workflow Panel/ });
      const start = bar.getByRole('button', { name: 'Start a run', exact: true });
      const status = bar.getByRole('button', { name: 'All statuses', exact: true });
      const sort = bar.getByRole('combobox', { name: 'Sort the queue', exact: true });
      await expect(bar).toBeVisible();
      await expect(launcher).toHaveText('');
      if (await launcher.getAttribute('aria-expanded') === 'true') {
        expect((await page.getByRole('dialog', { name: 'Workflow Panel', exact: true }).boundingBox())!.width).toBe(280);
        await launcher.click();
      }
      const bounds = await Promise.all([launcher, start, status, sort].map(control => control.boundingBox()));
      expect(bounds.every(bound => bound?.height === 32)).toBe(true);
      expect(bounds[0]!.x).toBeLessThan(bounds[1]!.x);
      expect(bounds[1]!.x + bounds[1]!.width).toBeLessThan(bounds[2]!.x);
      expect(bounds[2]!.x).toBeLessThan(bounds[3]!.x);
      await expect(bar.getByRole('button', { name: /^(Select|Done|Clear)$/ })).toHaveCount(0);
      const filters = page.getByRole('group', { name: 'Frequent queue filters', exact: true });
      const rows = page.locator('[data-demo-row-id]');
      await expect(filters.getByRole('button', { name: 'All 14', exact: true })).toHaveAttribute('aria-pressed', 'true');
      expect(Math.abs((await filters.boundingBox())!.width - (await rows.first().boundingBox())!.width)).toBeLessThanOrEqual(1);
      const snapshot = await page.getByRole('main').ariaSnapshot();
      info.annotations.push({ type: `a11y-attachment-sha256:${evidence}`, description: createHash('sha256').update(snapshot).digest('hex') });
      await info.attach(evidence, { body: snapshot, contentType: 'text/yaml' });
      await info.attach(evidence.replace('.a11y.yml', '.png'), { body: await page.screenshot(), contentType: 'image/png' });

      await status.click();
      await page.getByRole('group', { name: 'Filter the queue by status', exact: true }).getByRole('button', { name: /^Failed / }).click();
      const source = page.locator(`[data-demo-row-id="${failed.runId}"]`);
      await expect(source).toBeVisible();
      await source.dblclick();
      const menu = page.getByRole('menu');
      for (const label of ['Select', 'Retry', 'Archive', 'Delete']) await expect(menu.getByRole('menuitem', { name: label, exact: true })).toBeVisible();
      await menu.getByRole('menuitem', { name: 'Select', exact: true }).click();
      await expect(page.getByText('1 selected', { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Delete selected runs', exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Retry selected runs with original settings', exact: true }).click();
      await expect(page.getByText('1 mock run queued', { exact: true })).toBeVisible();
      await expect(page.getByRole('dialog', { name: /run/i })).toHaveCount(0);
      await expect(source).toHaveCount(0);
      await status.click();
      await page.getByRole('group', { name: 'Filter the queue by status', exact: true }).getByRole('button', { name: /^All / }).click();
      const retried = rows.filter({ hasText: 'Mock retry queued with original settings' });
      await expect(retried).toHaveCount(1);
      await expect(retried).toContainText(`#${failed.attempt + 1}`);
      await retried.getByRole('button', { name: /^Attempts for/ }).click();
      await expect(page.getByRole('dialog', { name: /^Attempts for/ })).toContainText(`#${failed.attempt}`);
      await page.keyboard.press('Escape');
      const another = rows.filter({ hasNotText: 'Mock retry queued with original settings' }).first();
      await retried.focus();
      await page.keyboard.press('Shift+F10');
      await menu.getByRole('menuitem', { name: 'Select', exact: true }).click();
      await expect(page.getByText('1 selected', { exact: true })).toBeVisible();
      await another.click({ button: 'right' });
      await menu.getByRole('menuitem', { name: 'Select', exact: true }).click();
      await expect(page.getByText('2 selected', { exact: true })).toBeVisible();
      await another.click();
      await expect(page.getByText('1 selected', { exact: true })).toBeVisible();
      await page.getByRole('checkbox', { name: 'Select all visible runs', exact: true }).focus();
      await page.keyboard.press('Escape');
      await expect(filters).toBeVisible();
      await expect(another).toBeFocused();

      await another.click({ button: 'right' });
      await menu.getByRole('menuitem', { name: 'Archive', exact: true }).click();
      await expect(page.getByText('1 mock run archived', { exact: true })).toBeVisible();
      await expect(start).toBeFocused();
      await retried.click({ button: 'right' });
      await menu.getByRole('menuitem', { name: 'Delete', exact: true }).click();
      await expect(retried).toHaveCount(0);
      await page.reload();
      await expect(source).toBeVisible();
      await source.dblclick();
      await menu.getByRole('menuitem', { name: 'Select', exact: true }).click();
      await page.getByRole('checkbox', { name: 'Select all visible runs', exact: true }).check();
      await page.getByRole('button', { name: 'Delete selected runs', exact: true }).click();
      await expect(rows).toHaveCount(0);
      await expect(filters.getByRole('button', { name: 'All 0', exact: true })).toBeVisible();
      await expect(page.getByText('No Person Lookup runs', { exact: true })).toBeVisible();
      await page.reload();

      await start.click();
      const run = page.getByRole('dialog', { name: 'Start a run', exact: true });
      await expect(run.getByRole('heading', { name: 'Run input', exact: true })).toBeVisible();
      await run.getByRole('textbox', { name: 'employee IDs', exact: true }).fill('10873698; Fictional, Morgan');
      const parsed = run.getByRole('region', { name: 'Parsed input', exact: true });
      await expect(parsed).toContainText('2 runs');
      await expect(parsed.getByRole('listitem')).toHaveCount(2);
      await run.getByRole('button', { name: 'Next', exact: true }).click();
      await expect(run.getByRole('heading', { name: 'Run options', exact: true })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(start).toBeFocused();
      expect(writes).toEqual([]);
      expect(errors).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    } finally { await server.close(); }
  });
}
