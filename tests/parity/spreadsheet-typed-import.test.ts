
import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { ensureParityBundle, PARITY_DIST_DIR } from './helpers/bundle.js';
import { installTheme, PARITY_THEMES } from './helpers/capture.js';
import { startFixtureServer } from '../support/helpers/dashboard/fixture-bff.js';

for (const theme of PARITY_THEMES) for (const width of [1024, 1440]) {
  const evidenceName = `typed-import-${theme.attribute}-${width}.a11y.yml`;
  test(`typed spreadsheet mapping and retained edits @ ${theme.attribute}-${width}`, { annotation: [{ type: "required-a11y-evidence", description: evidenceName }] }, async ({ page }, info) => {
    ensureParityBundle();
    const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: 'working-tree' } });
    const errors: string[] = [], writes: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (request.method() !== 'GET') writes.push(new URL(request.url()).pathname); });
    try {
      await page.setViewportSize({ width, height: width === 1024 ? 720 : 1000 }); await installTheme(page, theme);
      await page.goto(`${server.baseUrl}/?settings=spreadsheets`);
      const content = 'Student applicants,,,,,\nOctober,,,,,\nLegal Name,UCPath ID,Personal Email,Transaction #,I9 Profile,Private note\nJordan Lee,10000001,jordan@example.com,T1234,123456,Excluded value\nTaylor Chen,Pending,taylor@example.com,T5678,1234567,Excluded value';
      await page.getByLabel('Open XLSX or CSV', { exact: true }).setInputFiles({ name: 'Fictional roster.csv', mimeType: 'text/csv', buffer: Buffer.from(content) });
      const dialog = page.getByRole('dialog', { name: 'Choose spreadsheet columns', exact: true });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole('combobox', { name: 'Header row', exact: true })).toHaveAttribute('data-value', '3');
      for (const [letter, value] of [['A', 'fullName'], ['B', 'eid'], ['C', 'personalEmail'], ['D', 'transactionNumber'], ['E', 'roster.i9ProfileId']]) await expect(dialog.getByRole('combobox', { name: `Dashboard field for ${letter}`, exact: true })).toHaveAttribute('data-value', value);
      await expect(dialog.getByRole('textbox', { name: /^Label for/ })).toHaveCount(0);
      const submit = dialog.getByRole('button', { name: 'Import selected columns', exact: true });
      await expect(submit).toBeEnabled();
      await expect(dialog.getByRole('status')).toContainText('row 5, column B');
      await expect(dialog.getByRole('status')).toContainText('Values will be kept.');
      await dialog.getByRole('checkbox', { name: 'F · Private note', exact: true }).uncheck();
      await expect(submit).toBeEnabled();
      const eid = dialog.getByRole('combobox', { name: 'Dashboard field for B', exact: true });
      await eid.click(); await page.getByRole('option', { name: 'Legal name', exact: true }).click();
      await expect(submit).toBeDisabled(); await expect(dialog.getByRole('status').filter({ hasText: 'mapped more than once' })).toContainText('mapped more than once');
      await eid.click(); await page.getByRole('option', { name: 'Employee ID', exact: true }).click();
      await eid.focus(); await eid.press('ArrowDown'); await expect(page.getByRole('listbox')).toBeVisible(); await page.keyboard.press('Escape'); await expect(eid).toBeFocused();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

      const tree = await page.locator("body").ariaSnapshot();
      info.annotations.push({ type: `a11y-attachment-sha256:${evidenceName}`, description: createHash("sha256").update(tree).digest("hex") });
      await info.attach(evidenceName, { body: tree, contentType: 'text/yaml' });
      await submit.click();
      const editor = page.getByRole('region', { name: 'Spreadsheet editor', exact: true });
      await expect(editor.getByRole('textbox', { name: 'A1', exact: true })).toHaveValue('Legal Name');
      await expect(editor.getByRole('textbox', { name: 'B2', exact: true })).toHaveValue('10000001');
      await expect(editor.getByRole('textbox', { name: 'F1', exact: true })).toHaveCount(0);
      await editor.getByRole('button', { name: 'Workbook actions', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Edit column mappings', exact: true }).click();
      await expect(eid).toHaveAttribute('data-value', 'eid'); await expect(dialog.getByRole('combobox', { name: 'Header row', exact: true })).toHaveAttribute('data-value', '1');
      await submit.click();
      await editor.getByRole('button', { name: 'Spreadsheets', exact: true }).click();
      const library = page.getByRole('table', { name: 'Registered spreadsheets', exact: true });
      await expect(library.getByRole('button', { name: 'Fictional roster.csv', exact: true })).toHaveCount(1);
      await library.getByRole('button', { name: 'Fictional roster.csv', exact: true }).click();
      await expect(editor.getByRole('textbox', { name: 'E2', exact: true })).toHaveValue('123456');
      await page.goBack(); await expect(library).toBeVisible();
      await page.goForward(); await expect(editor).toBeVisible();
      await expect(editor.getByRole('textbox', { name: 'B2', exact: true })).toHaveValue('10000001');
      expect(errors).toEqual([]); expect(writes).toEqual([]);
    } finally { await server.close(); }
  });
}
