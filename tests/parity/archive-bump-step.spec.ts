import { expect, test } from '@playwright/test';
import { ensureParityBundle, PARITY_DIST_DIR } from './helpers/bundle.js';
import { assertThemeApplied, installTheme, PARITY_THEMES } from './helpers/capture.js';
import { startFixtureServer } from './helpers/fixture-bff.js';
import { dismissWorkflowWindow, failOnPageErrors } from './helpers/reference-harness.js';

test.beforeAll(() => { ensureParityBundle(); });
for (const theme of PARITY_THEMES) for (const width of [1024, 1440]) {
 test(`Archive bump review is a separate page ${theme.name} ${width}`, async ({ page }, info) => {
  const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: 'working-tree' } });
  try {
   const errors = failOnPageErrors(page);
   const versionCommands: string[] = [];
   page.on('request', request => {
    if (request.method() === 'POST' && request.url().includes('/commands')) {
     const type = (request.postDataJSON() as { type: string }).type;
     if (type.includes('version')) versionCommands.push(type);
    }
   });
   await page.setViewportSize({ width, height: width === 1024 ? 720 : 1000 });
   await installTheme(page, theme);
   await page.goto(`${server.baseUrl}/?archive=`);
   await dismissWorkflowWindow(page);
   await assertThemeApplied(page, theme);
   const trigger = page.getByRole('button', { name: 'Plan a bump', exact: true });
   await trigger.click();
   const dialog = page.getByRole('dialog', { name: 'Plan a version bump' });
   const picker = dialog.getByRole('button', { name: 'Workflow to bump', exact: true });
   await expect(dialog.getByRole('heading', { name: 'Choose what to update' })).toBeVisible();
   await expect(dialog.getByRole('table', { name: 'Version changes' })).toHaveCount(0);
   await expect(dialog.getByRole('button', { name: 'Apply reviewed change' })).toHaveCount(0);
   await picker.click();
   const choices = page.getByRole('group', { name: 'Workflows to bump' });
   await choices.getByRole('checkbox', { name: /Onboarding/u }).check();
   await choices.getByRole('checkbox', { name: /Emergency Contact/u }).check();
   await page.keyboard.press('Escape');
   await expect(picker).toContainText('3 workflows selected');
   const selectionBounds = await dialog.boundingBox();
   await info.attach('selection.png', { body: await page.screenshot(), contentType: 'image/png' });
   await dialog.getByRole('button', { name: 'Review change', exact: true }).click();
   const heading = dialog.getByRole('heading', { name: 'Review version change' });
   await expect(heading).toBeFocused();
   await expect(dialog.getByRole('group', { name: 'Version bump scope' })).toHaveCount(0);
   await expect(picker).toHaveCount(0);
   const table = dialog.getByRole('table', { name: 'Version changes' });
   await expect(table.getByRole('row')).toHaveCount(5);
   await expect(table.getByRole('row', { name: /^Dashboard/u })).toContainText('Unchanged');
   for (const name of ['Separations', 'Onboarding', 'Emergency Contact']) await expect(table.getByRole('row', { name: new RegExp(`^${name}`, 'u') })).toBeVisible();
   await expect(dialog.getByRole('button', { name: 'Apply reviewed change' })).toBeEnabled();
   expect(await dialog.boundingBox()).toEqual(selectionBounds);
   await info.attach('review.png', { body: await page.screenshot(), contentType: 'image/png' });
   await info.attach('review.a11y.yml', { body: await dialog.ariaSnapshot(), contentType: 'text/yaml' });
   await dialog.getByRole('button', { name: 'Back', exact: true }).click();
   await expect(dialog.getByRole('heading', { name: 'Choose what to update' })).toBeFocused();
   await expect(picker).toContainText('3 workflows selected');
   await expect(table).toHaveCount(0);
   await picker.click();
   for (const name of ['Separations', 'Onboarding', 'Emergency Contact']) await expect(choices.getByRole('checkbox', { name: new RegExp(name, 'u') })).toBeChecked();
   await page.keyboard.press('Escape');
   await dialog.getByRole('radio', { name: 'All workflows', exact: true }).check();
   await dialog.getByRole('button', { name: 'Review change', exact: true }).click();
   await expect(table.getByRole('row')).toHaveCount(6);
   await expect(table.locator('tbody td:last-child')).toHaveText(['2.0', '2.0', '2.0', '2.0', '2.0']);
   const footer = dialog.locator('footer');
   await expect(footer.getByRole('button', { name: 'Back' })).toBeInViewport();
   await expect(footer.getByRole('button', { name: 'Apply reviewed change' })).toBeInViewport();
   await table.locator('tbody tr').last().scrollIntoViewIfNeeded();
   await expect(footer.getByRole('button', { name: 'Apply reviewed change' })).toBeInViewport();
   expect(await dialog.boundingBox()).toEqual(selectionBounds);
   expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
   await info.attach('all-workflows-review.png', { body: await page.screenshot(), contentType: 'image/png' });
   await dialog.getByRole('button', { name: 'Apply reviewed change' }).click();
   await expect(dialog).toHaveCount(0);
   await expect(trigger).toBeFocused();
   await expect(page.getByText('No version or run was changed.', { exact: true })).toBeVisible();
   expect(versionCommands).toEqual([]);
   expect(errors).toEqual([]);
  } finally { await server.close(); }
 });
}
