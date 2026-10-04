import { expect, test } from '@playwright/test';
import { ensureParityBundle, PARITY_DIST_DIR } from './helpers/bundle.js';
import { startFixtureServer } from './helpers/fixture-bff.js';
import { FIXTURE_DAY } from './helpers/fixture-identity.js';

for (const width of [1024, 1440]) test(`review controls stay outside dashboard @ ${width}`, async ({ page }) => {
  ensureParityBundle();
  const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: 'working-tree' }, preflightScenario: 'ready' });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${server.baseUrl}/review.html?day=${FIXTURE_DAY}`);
    await expect(page.getByText('Preview controls', { exact: false })).toBeVisible();
    const dashboard = page.frameLocator('#review-frame');
    await expect(dashboard.getByRole('heading', { name: 'HR GPT', exact: true })).toBeVisible();
    await dashboard.getByRole('button', { name: 'Settings', exact: true }).click();
    await dashboard.getByRole('link', { name: 'Activity', exact: true }).click();
    await expect(dashboard.getByRole('combobox', { name: /[Ss]ample/ })).toHaveCount(0);
    await page.getByLabel('Activity', { exact: true }).selectOption('loading');
    await expect(dashboard.getByRole('status', { name: 'Loading activity report', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Open dashboard', exact: true })).toHaveAttribute('href', /activityPreview=loading/);
    await page.getByLabel('Activity', { exact: true }).selectOption('normal');
    await expect(dashboard.getByRole('table', { name: 'Workflow outcomes', exact: true })).toBeVisible();
    await dashboard.getByRole('button', { name: 'Back to dashboard', exact: true }).click();
    await page.getByLabel('Notifications', { exact: true }).selectOption('empty');
    await dashboard.getByRole('button', { name: 'Notifications, 0 unread', exact: true }).click();
    await expect(dashboard.getByText('No notifications', { exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  } finally { await server.close(); }
});
