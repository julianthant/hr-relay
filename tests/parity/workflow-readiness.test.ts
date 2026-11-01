import { installFrozenMonotonic } from "./helpers/app-driver.js";

import { expect } from '@playwright/test';
import { test } from "./helpers/fixtures.js";
import { SettingsFactsWireSchema } from '../../src/models/dashboard/settings.js';
import { PARITY_DIST_DIR } from './helpers/bundle.js';
import { installTheme, PARITY_THEMES } from './helpers/capture.js';
import { startFixtureServer } from '../support/helpers/dashboard/fixture-bff.js';
import { FIXTURE_SETTINGS_FACTS } from './helpers/fixture-settings.js';
import { chooseSelect } from './helpers/select-choice.js';

// Explicit synthetic facts exercise an unbuilt boundary and a missing bootstrap label.
const unknownWorkflow = 'unpreviewable-fixture-with-an-unrecognized-workflow-label';
const facts = SettingsFactsWireSchema.parse({
  ...FIXTURE_SETTINGS_FACTS,
  workflowCapabilities: [...FIXTURE_SETTINGS_FACTS.workflowCapabilities, {
    workflowId: unknownWorkflow,
    dryRun: { state: 'unsupported', reason: 'node-declares-unsupported', nodeId: 'write-anyway' },
    typedStart: false, reviewPanel: true, editData: { state: 'read-only' },
    operatorGates: [], browserSystems: [],
  }],
});

for (const theme of PARITY_THEMES) for (const width of [1024, 1440]) {
  test(`Workflow readiness groups real operations and preserves requirements @ ${theme.attribute}-${width}`, async ({ page }, _info) => {
    const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: 'working-tree' }, preflightScenario: 'ready' });
    const errors: string[] = [], writes: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (request.method() !== 'GET') writes.push(new URL(request.url()).pathname); });
    try {
      await page.setViewportSize({ width, height: width === 1024 ? 720 : 1000 });
      await installFrozenMonotonic(page); await installTheme(page, theme);
      await page.route('**/api/v1/settings/facts', route => route.fulfill({ json: facts }));
      await page.goto(`${server.baseUrl}/?settings=preflight`);
      const surface = page.getByRole('region', { name: 'Preflight', exact: true });
      const group = surface.getByRole('group', { name: 'Workflow readiness', exact: true });
      await expect(group.locator('.ds-form-group')).toHaveCount(0);
      await expect(group.getByRole('heading', { name: 'Supported operations', exact: true })).toBeVisible();
      await expect(group.locator('.workflow-operations-card')).toHaveCount(2);
      await expect(group.getByText('Operations and boundaries', { exact: true })).toHaveCount(0);
      const first = group.locator('.workflow-operations-card').first();
      const trigger = first.locator('.ds-disclosure-trigger');
      await expect(trigger).toHaveAttribute('aria-expanded', 'true');
      await expect(trigger).toContainText('Person Lookup');
      await expect(trigger).toContainText('3 available');
      expect((await trigger.boundingBox())!.height).toBe(48);
      expect((await first.boundingBox())!.width).toBe((await group.boundingBox())!.width);
      const grid = first.locator('.workflow-operations-grid');
      expect(await grid.evaluate(node => getComputedStyle(node).gridTemplateColumns.split(' ').length)).toBe(2);
      expect(await grid.locator('[data-capability]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-capability')))).toEqual(['typed-start', 'dry-run', 'edit-data', 'review-panel', 'operator-gates', 'browser-systems']);
      await expect(first.getByText('Available', { exact: true })).toHaveCount(3);
      await expect(first.getByText('Not applicable', { exact: true })).toHaveCount(3);
      await expect(first).toContainText('3 correctable fields');
      await expect(first).toContainText('crm, ucpath');
      await expect(first.locator('.workflow-operations-boundary')).toContainText('commits to no system of record');
      const labelFont = await first.locator('dt').first().evaluate(node => getComputedStyle(node).fontSize);
      expect(labelFont).toBe(await surface.getByRole('group', { name: 'Runtime', exact: true }).locator('.ds-field-label').first().evaluate(node => getComputedStyle(node).fontSize));
      await trigger.focus(); await page.keyboard.press('Enter');
      await expect(trigger).toHaveAttribute('aria-expanded', 'false');
      await expect(grid).toBeHidden();
      await page.keyboard.press('Enter'); await expect(grid).toBeVisible();
      const help = first.getByRole('button', { name: 'What Dry run means', exact: true });
      await help.click();
      await expect(page.getByText('Offers a rehearsal that reads everything for real and writes nothing.', { exact: false })).toBeVisible();
      await page.keyboard.press('Escape'); await expect(help).toBeFocused();
      const source = group.getByRole('button', { name: 'About workflow operations', exact: true });
      await expect(group.getByText('Source: served workflow descriptors.', { exact: true })).toHaveCount(0);
      await source.click(); await expect(page.getByText('Source: served workflow descriptors.', { exact: true })).toBeVisible();
      await page.keyboard.press('Escape'); await expect(source).toBeFocused();
      const unknown = group.locator('.workflow-operations-card').last();
      await expect(unknown.locator('.ds-disclosure-trigger')).toContainText('1 not built');
      await unknown.locator('.ds-disclosure-trigger').click();
      await expect(unknown.getByText('Not built', { exact: true })).toBeVisible();
      await expect(unknown).toContainText('write-anyway declares no preview arm');
      await expect(unknown.locator('.workflow-operations-boundary')).toContainText('Refused: write-anyway commits');
      const id = unknown.locator('.workflow-operations-id');
      await expect(id).toHaveText(unknownWorkflow);
      expect(await id.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await first.scrollIntoViewIfNeeded();

      await chooseSelect(surface.getByRole('combobox', { name: 'Check readiness for', exact: true }), 'person-lookup');
      await expect(group.getByRole('heading', { name: 'Requirements', exact: true })).toBeVisible();
      await expect(group.getByRole('group', { name: 'Workflow requirements', exact: true })).toContainText('UCPath sign-in');
      await expect(group.locator('.workflow-operations-card')).toHaveCount(1);
      await expect(group).not.toContainText(unknownWorkflow);
      await expect(group).toContainText('Passed');
      expect(errors).toEqual([]); expect(writes).toEqual([]);
      await group.scrollIntoViewIfNeeded();

    } finally { await server.close(); }
  });
}
