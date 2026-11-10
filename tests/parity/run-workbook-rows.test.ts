import { expect, type Locator, type Page, type TestInfo } from '@playwright/test';
import { ERROR_CATALOG } from '../../src/models/failures/error-catalog.js';
import { test } from './helpers/fixtures.js';
import { gotoAppState } from './helpers/app-driver.js';
import { FIXTURE_DAY } from './helpers/fixture-identity.js';
import { attachShellA11y } from './helpers/shell-proof.js';
import { ROW_EMAILS, ROW_IDS, withWorkbookRowsFixture, type WorkbookRowsFixture } from '../support/helpers/dashboard/run-workbook-rows-fixture.js';

type Theme = 'light' | 'dark';
async function openOnboarding(page: Page, fixture: WorkbookRowsFixture, theme: Theme, width: number) {
  await page.addInitScript(value => Reflect.set(window, 'relayParityTheme', value), theme);
  await page.setViewportSize({ width, height: width === 1024 ? 720 : 900 });
  await gotoAppState(page, fixture.server.baseUrl, { day: FIXTURE_DAY, start: true });
  const dialog = page.getByRole('dialog', { name: 'Start run', exact: true });
  await dialog.getByRole('navigation', { name: 'Workflow', exact: true }).getByRole('button', { name: 'Onboarding', exact: true }).click();
  await expect(dialog.getByRole('table', { name: 'Saved spreadsheet rows', exact: true })).toBeVisible();
  await expect(dialog.getByRole('radio', { name: 'New hire', exact: true })).not.toBeChecked();
  await expect(dialog.getByRole('radio', { name: 'Rehire', exact: true })).not.toBeChecked();
  await expect(dialog.getByRole('textbox', { name: /Emails?/u })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Continue', exact: true })).toBeDisabled();
  for (const root of [page.locator('html'), page.locator('body'), page.locator('[data-app-root]')]) await expect(root).toHaveAttribute('data-demo-theme', theme);
  return dialog;
}
function rowCheckbox(dialog: Locator, row: number, sheet = 'People') {
  return dialog.getByRole('checkbox', { name: `Select ${sheet} · Row ${row + 2}: ${ROW_EMAILS[row]}`, exact: true });
}
async function chooseRows(page: Page, dialog: Locator, mode: 'New hire' | 'Rehire') {
  const radio = dialog.getByRole('radio', { name: mode, exact: true });
  await radio.focus(); await page.keyboard.press('Space'); await expect(radio).toBeChecked(); await expect(radio).toBeFocused();
  const first = rowCheckbox(dialog, 0);
  await first.focus(); await page.keyboard.press('Space'); await expect(first).toBeChecked(); await expect(first).toBeFocused();
  for (const index of [1, 2]) await rowCheckbox(dialog, index).check();
  await expect(dialog.getByRole('checkbox', { name: 'Select People · Row 5: The lookup key is blank.', exact: true })).toBeDisabled();
}
function evidenceId(title: string, state: string) {
  return `workbook-rows-${title.replace(/[^a-zA-Z0-9-]+/gu, '-')}-${state}`;
}
async function evidence(page: Page, info: TestInfo, state: string) {
  const id = evidenceId(info.title, state);
  await page.evaluate(() => document.fonts.ready);
  const path = info.outputPath(`${id}.png`);
  await page.screenshot({ path, animations: 'disabled' });
  await info.attach(`${id}.png`, { path, contentType: 'image/png' });
  await attachShellA11y(page, info, `${id}.a11y.yml`);
}
async function review(page: Page, fixture: WorkbookRowsFixture, dialog: Locator, info: TestInfo, capture: boolean, mode: 'new-hire' | 'rehire' = 'new-hire') {
  expect(fixture.commands).toHaveLength(0); expect(fixture.rows).toHaveLength(0); expect(fixture.plans).toHaveLength(0);
  if (capture) await evidence(page, info, 'selected-input');
  await dialog.getByRole('button', { name: 'Continue', exact: true }).click();
  const dryRun = dialog.getByRole('switch', { name: 'Dry run Fill and check every step without submitting.', exact: true });
  await expect(dryRun).toBeEnabled();
  await expect(dryRun).not.toBeChecked();
  if (capture) await evidence(page, info, 'selected-options');
  expect(fixture.commands).toHaveLength(0); expect(fixture.rows).toHaveLength(0);
  await dialog.getByRole('button', { name: 'Preview plan', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Start 2 runs', exact: true })).toBeVisible();
  const refusal = dialog.getByRole('alert').filter({ hasText: 'Entry 2 (People · Row 3: alpha@example.test) was not planned' });
  await expect(refusal).toHaveCount(1);
  await expect(refusal.getByText('Entry 2 (People · Row 3: alpha@example.test) was not planned', { exact: true })).toBeVisible();
  await expect(refusal.getByText('This selected row repeats the normalized email from entry 1.', { exact: true })).toBeVisible();
  await expect(refusal.getByText('· nothing is enqueued for it', { exact: true })).toBeVisible();
  await expect(refusal.getByText('code active-run-exists', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('heading', { name: '2 runs ready to queue', exact: true })).toBeVisible();
  const inputs = dialog.getByRole('group', { name: 'Run inputs', exact: true });
  await expect(inputs.locator('dd')).toHaveText(['Entry 1 · Accepted', 'Entry 2 · Refused', 'Entry 3 · Accepted']);
  await expect(inputs.locator('dt')).toHaveText(ROW_EMAILS.map((email, index) => `People · Row ${index + 2}: ${email}`));
  expect(fixture.plans).toHaveLength(1); expect(fixture.commands).toHaveLength(0); expect(fixture.rows).toHaveLength(0);
  const request = fixture.plans[0];
  expect(request.submissions).toEqual(ROW_EMAILS.map(email => ({ email, mode })));
  expect(request.workbookReferences).toEqual(ROW_IDS.map((rowId, index) => ({ entry: index + 1, typeId: fixture.type.id, libraryId: fixture.libraryId,
    versionId: 'roster-1', selectedRow: { sheetId: 'people', rowId } })));
  expect(request).toMatchObject({ dryRun: false, browserMode: 'headed', captureBrowserScreenshots: true });
  expect(fixture.plan?.planned.map(entry => entry.workbookReferences?.[0].selectedRow?.rowId)).toEqual(['alpha', 'bravo']);
  if (capture) await evidence(page, info, 'selected-confirm');
}

for (const theme of ['light', 'dark'] as const) for (const width of [1024, 1440]) {
  const mode = theme === 'light' ? 'new-hire' : 'rehire';
  const title = `saved Onboarding rows ${mode} ${theme} ${width}`;
  const a11y = `${evidenceId(title, 'queue-summary')}.a11y.yml`;
  test(title, { annotation: [
    { type: 'required-a11y-evidence', description: `${evidenceId(title, 'selected-input')}.a11y.yml` },
    { type: 'required-a11y-evidence', description: `${evidenceId(title, 'selected-options')}.a11y.yml` },
    { type: 'required-a11y-evidence', description: `${evidenceId(title, 'selected-confirm')}.a11y.yml` },
    { type: 'required-a11y-evidence', description: `${evidenceId(title, 'queued')}.a11y.yml` },
    { type: 'required-a11y-evidence', description: a11y },
  ] }, async ({ page }, info) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await withWorkbookRowsFixture(page, async fixture => {
      const dialog = await openOnboarding(page, fixture, theme, width);
      await chooseRows(page, dialog, mode === 'rehire' ? 'Rehire' : 'New hire');
      await review(page, fixture, dialog, info, true, mode);
      await expect(dialog.locator(':scope > header')).toBeInViewport({ ratio: 1 });
      await expect(dialog.getByRole('button', { name: 'Start 2 runs', exact: true })).toBeInViewport({ ratio: 1 });
      await dialog.getByRole('button', { name: 'Start 2 runs', exact: true }).click();
      await expect(page.getByRole('status', { name: '2 runs started', exact: true })).toBeVisible();
      await expect(dialog).toHaveCount(0);
      expect(fixture.commands).toHaveLength(1); expect(fixture.rows).toHaveLength(2);
      expect(fixture.commands[0]).toMatchObject({ family: 'start', type: 'start-run', source: 'run-start',
        target: { workflowId: 'onboarding', startPlanId: fixture.plan!.startPlanId, expectedVersion: fixture.plan!.expectedVersion }, payload: fixture.plan!.fingerprints });
      expect(new Set(fixture.rows.map(row => row.runId)).size).toBe(2);
      const queue = page.getByRole('region', { name: 'Queue', exact: true });
      await expect(queue.locator('section[aria-label$=" batch"]')).toHaveCount(0);
      for (const row of fixture.rows) {
        expect(row.status).toBe('queued'); expect(row.dryRun).toBe(false);
        await expect(queue.locator(`[data-demo-row-id="${row.runId}"]`)).toHaveCount(1);
      }
      const first = queue.locator(`[data-demo-row-id="${fixture.rows[0].runId}"]`);
      await first.focus(); await page.keyboard.press('Enter');
      await expect.poll(() => new URL(page.url()).searchParams.get('run')).toBe(fixture.rows[0].runId);
      expect(fixture.commands).toHaveLength(1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      expect(errors).toEqual([]); await evidence(page, info, 'queued'); await attachShellA11y(page, info, a11y);
    });
  });
}

const authorityTitle = 'saved rows discard late versions and expose stale catalog, empty and provider errors';
test(authorityTitle, {
  annotation: [
    { type: 'required-a11y-evidence', description: `${evidenceId(authorityTitle, 'stale-version')}.a11y.yml` },
    { type: 'required-a11y-evidence', description: `${evidenceId(authorityTitle, 'empty-version')}.a11y.yml` },
    { type: 'required-a11y-evidence', description: `${evidenceId(authorityTitle, 'provider-error')}.a11y.yml` },
    { type: 'required-a11y-evidence', description: `${evidenceId(authorityTitle, 'stale-catalog')}.a11y.yml` },
    { type: 'required-a11y-evidence', description: `${evidenceId(authorityTitle, 'authority-summary')}.a11y.yml` },
  ],
}, async ({ page }, info) => {
  await withWorkbookRowsFixture(page, async fixture => {
    const dialog = await openOnboarding(page, fixture, 'dark', 1024);
    await chooseRows(page, dialog, 'New hire');
    fixture.delayVersion();
    await dialog.getByRole('button', { name: /Reference version$/u }).click();
    await page.getByRole('menuitemradio', { name: 'Delayed roster', exact: true }).click();
    await expect.poll(() => fixture.pendingVersions).toEqual(['roster-2']);
    await expect(dialog.getByText('The selected rows are from earlier spreadsheet data and cannot be planned.', { exact: true })).toBeVisible();
    await expect(rowCheckbox(dialog, 0)).toBeChecked(); await expect(rowCheckbox(dialog, 0)).toBeDisabled();
    await expect(dialog.getByRole('button', { name: 'Continue', exact: true })).toBeDisabled();
    await evidence(page, info, 'stale-version');
    await dialog.getByRole('button', { name: /Reference version$/u }).click();
    await page.getByRole('menuitemradio', { name: 'New roster', exact: true }).click();
    await dialog.getByRole('button', { name: 'Clear previous row selection', exact: true }).click();
    await expect(rowCheckbox(dialog, 0, 'New people')).toBeEnabled();
    const lateReply = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/versions/roster-2'));
    fixture.releaseVersion(); await lateReply;
    await expect(rowCheckbox(dialog, 0, 'New people')).toBeEnabled(); await expect(rowCheckbox(dialog, 0)).toHaveCount(0);
    await dialog.getByRole('button', { name: /Reference version$/u }).click();
    await page.getByRole('menuitemradio', { name: 'Empty roster', exact: true }).click();
    await expect(dialog.getByText('No saved data rows', { exact: true })).toBeVisible();
    await expect(dialog.getByRole('table', { name: 'Saved spreadsheet rows', exact: true })).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Continue', exact: true })).toBeDisabled();
    await evidence(page, info, 'empty-version');
    await dialog.getByRole('button', { name: /Reference version$/u }).click();
    await page.getByRole('menuitemradio', { name: 'Reviewed roster', exact: true }).click();
    await rowCheckbox(dialog, 0).check();
    await dialog.getByRole('button', { name: /Reference version$/u }).click();
    await page.getByRole('menuitemradio', { name: 'Unavailable roster', exact: true }).click();
    await expect(dialog.getByText('Saved rows unavailable', { exact: true })).toBeVisible();
    const providerError = dialog.getByRole('alert').filter({ hasText: 'Saved rows unavailable' });
    await expect(providerError).toHaveCount(1);
    await expect(providerError).toHaveText(`Saved rows unavailable${ERROR_CATALOG.DASHBOARD_READ_FAILED.text}Refresh reference data`);
    await expect(providerError).not.toContainText('/api/v1/');
    await expect(providerError).not.toContainText('GET ');
    await expect(providerError).not.toContainText('Failed to fetch');
    await expect(rowCheckbox(dialog, 0)).toBeDisabled();
    await evidence(page, info, 'provider-error');
    fixture.refreshCatalog();
    await dialog.getByRole('button', { name: 'Refresh reference data', exact: true }).click();
    await expect(dialog.getByText('Refreshing reference data. Row selection is disabled.', { exact: true })).toBeVisible();
    await expect(rowCheckbox(dialog, 0)).toBeChecked(); await expect(rowCheckbox(dialog, 0)).toBeDisabled();
    await expect(dialog.getByRole('button', { name: 'Continue', exact: true })).toBeDisabled();
    await evidence(page, info, 'stale-catalog'); fixture.releaseCatalog();
    await expect(dialog.getByText('Refreshing reference data. Row selection is disabled.', { exact: true })).toHaveCount(0);
    await expect(dialog.getByText('The selected rows are from earlier spreadsheet data and cannot be planned.', { exact: true })).toBeVisible();
    expect(fixture.plans).toHaveLength(0); expect(fixture.commands).toHaveLength(0); expect(fixture.rows).toHaveLength(0);
    await attachShellA11y(page, info, `${evidenceId(info.title, 'authority-summary')}.a11y.yml`);
  });
});

const unknownTitle = 'UNKNOWN saved-row start replays one immutable command after reload';
test(unknownTitle, {
  annotation: [
    { type: 'required-a11y-evidence', description: `${evidenceId(unknownTitle, 'unknown-issued')}.a11y.yml` },
    { type: 'required-a11y-evidence', description: `${evidenceId(unknownTitle, 'unknown-replayed')}.a11y.yml` },
    { type: 'required-a11y-evidence', description: `${evidenceId(unknownTitle, 'unknown-summary')}.a11y.yml` },
  ],
}, async ({ page }, info) => {
  await withWorkbookRowsFixture(page, async fixture => {
    const dialog = await openOnboarding(page, fixture, 'light', 1440);
    await chooseRows(page, dialog, 'New hire'); await review(page, fixture, dialog, info, false);
    fixture.loseResponse(); await dialog.getByRole('button', { name: 'Start 2 runs', exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'Replay exact submission', exact: true })).toBeVisible();
    expect(fixture.commands).toHaveLength(1); expect(fixture.rows).toHaveLength(2);
    const issued = fixture.commandBodies[0], runIds = fixture.rows.map(row => row.runId);
    await expect(dialog.getByRole('button', { name: '1 Input', exact: true })).toBeDisabled();
    await evidence(page, info, 'unknown-issued');
    await page.reload(); await expect(page.locator('[data-parity-ready="true"]')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Replay exact submission', exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Continue', exact: true })).toBeDisabled();
    await dialog.getByRole('button', { name: 'Replay exact submission', exact: true }).click();
    await expect(page.getByRole('status', { name: 'Run submission confirmed', exact: true })).toBeVisible();
    expect(fixture.commandBodies).toEqual([issued, issued]); expect(fixture.plans).toHaveLength(1);
    expect(fixture.rows.map(row => row.runId)).toEqual(runIds);
    await evidence(page, info, 'unknown-replayed'); await attachShellA11y(page, info, `${evidenceId(info.title, 'unknown-summary')}.a11y.yml`);
  });
});
