import { attachShellA11y } from "./helpers/shell-proof.js";

import { expect, test } from '@playwright/test';

import { readFile } from 'node:fs/promises';
import { importSpreadsheet } from '../../src/dashboard/surfaces/spreadsheets/spreadsheet-editor-model.js';
import { ensureParityBundle, PARITY_DIST_DIR } from './helpers/bundle.js';
import { installTheme, PARITY_THEMES } from './helpers/capture.js';
import { startFixtureServer } from '../support/helpers/dashboard/fixture-bff.js';

for (const theme of PARITY_THEMES) for (const width of [1024, 1440]) {
  const captures = ['advanced-settings', 'xlsx-columns', 'xlsx-imported'];
  test(`filtered XLSX import and Advanced settings @ ${theme.attribute}-${width}`, {
    annotation: captures.map(name => ({ type: 'required-a11y-evidence', description: `${name}-${theme.attribute}-${width}.a11y.yml` })),
  }, async ({ page }, info) => {
    ensureParityBundle();
    const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: 'working-tree' } });
    const errors: string[] = [], writes: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (request.method() !== 'GET') writes.push(request.url()); });

    const captureSemanticEvidence = async (name: string) => { await attachShellA11y(page, info, `${name}-${theme.attribute}-${width}.a11y.yml`); };
    try {
      await page.setViewportSize({ width, height: width === 1024 ? 720 : 1000 }); await installTheme(page, theme);
      await page.goto(`${server.baseUrl}/?settings=performance`);
      const personal = page.locator('.settings-nav-group').filter({ has: page.getByText('Personal', { exact: true }) });
      const advanced = page.locator('.settings-nav-group').filter({ has: page.getByText('Advanced', { exact: true }) });
      await expect(personal.getByRole('link')).toHaveText(['General', 'Credentials']);
      await expect(advanced.getByRole('link')).toHaveText(['Paths', 'Routes']);
      await expect(page.getByRole('textbox', { name: 'Task', exact: true })).toBeVisible();

      await captureSemanticEvidence('advanced-settings');
      await advanced.getByRole('link', { name: 'Paths', exact: true }).click();
      await expect(page).toHaveURL(/settings=paths/u); await expect(page.getByRole('heading', { name: 'Paths', exact: true })).toBeVisible();
      await advanced.getByRole('link', { name: 'Routes', exact: true }).click();
      await expect(page).toHaveURL(/settings=routes/u); await expect(page.getByRole('heading', { name: 'Routes', exact: true })).toBeVisible();
      await page.goBack(); await expect(page).toHaveURL(/settings=paths/u);
      await page.goForward(); await expect(page).toHaveURL(/settings=routes/u);
      await page.reload(); await expect(advanced.getByRole('link', { name: 'Routes', exact: true })).toHaveAttribute('aria-current', 'page');
      await page.getByRole('link', { name: 'Spreadsheets', exact: true }).click();
      await page.getByLabel('Open XLSX or CSV', { exact: true }).setInputFiles(new URL('../support/fixtures/spreadsheet/color-filtered-roster.xlsx', import.meta.url).pathname);
      const dialog = page.getByRole('dialog', { name: 'Choose spreadsheet columns', exact: true });
      await expect(dialog).toBeVisible(); await expect(page.getByText('Spreadsheet unavailable', { exact: true })).toHaveCount(0);
      for (const [letter, field] of [['A', 'fullName'], ['B', 'eid'], ['C', 'personalEmail']]) {
        await expect(dialog.getByRole('combobox', { name: `Dashboard field for ${letter}`, exact: true })).toHaveAttribute('data-value', field);
      }
      await dialog.getByRole('button', { name: 'Roster Sheet to import', exact: true }).click();
      await expect(page.getByRole('menuitemradio', { name: 'Notes', exact: true })).toBeVisible();
      await page.getByRole('menuitemradio', { name: 'Notes', exact: true }).click();
      await dialog.getByRole('checkbox', { name: 'Keep all columns in this sheet', exact: true }).uncheck();
      await dialog.getByRole('button', { name: 'Notes Sheet to import', exact: true }).click();
      await expect(page.getByRole('menuitemradio', { name: 'Roster', exact: true })).toBeVisible();
      await page.getByRole('menuitemradio', { name: 'Roster', exact: true }).click();

      await captureSemanticEvidence('xlsx-columns');
      await dialog.getByRole('button', { name: 'Import selected columns', exact: true }).click();
      const editor = page.getByRole('region', { name: 'Spreadsheet editor', exact: true });
      await expect(editor.getByRole('textbox', { name: 'B2', exact: true })).toHaveValue('10000001');
      await expect(editor.getByRole('textbox', { name: 'B3', exact: true })).toHaveValue('10000002');
      expect(await editor.getByRole('textbox', { name: 'B2', exact: true }).evaluate(element => getComputedStyle(element.closest('td')!).backgroundColor)).toBe('rgb(255, 255, 0)');
      await editor.getByRole('textbox', { name: 'A2', exact: true }).fill('Jordan Updated');
      await editor.getByRole('button', { name: 'Export copy', exact: true }).click();
      const downloading = page.waitForEvent('download');
      await page.getByRole('menuitem', { name: 'Excel workbook (.xlsx)', exact: true }).click();
      const download = await downloading;
      expect(download.suggestedFilename()).toBe('color-filtered-roster-edited.xlsx');
      const path = await download.path(); expect(path).not.toBeNull();
      const bytes = new Uint8Array(await readFile(path)).slice().buffer;
      const workbook = await importSpreadsheet(download.suggestedFilename(), bytes);
      expect(workbook.sheets).toHaveLength(1); expect(workbook.sheets[0].rows).toHaveLength(3);
      expect(workbook.sheets[0].rows[1].cells[0].value).toBe('Jordan Updated');
      expect(workbook.sheets[0].rows[1].cells[1].background).toBe('#ffff00');

      await captureSemanticEvidence('xlsx-imported');
      await editor.getByRole('button', { name: 'Spreadsheets', exact: true }).click();
      await page.getByRole('table', { name: 'Registered spreadsheets', exact: true }).getByRole('button', { name: 'color-filtered-roster.xlsx', exact: true }).click();
      await expect(editor.getByRole('textbox', { name: 'A2', exact: true })).toHaveValue('Jordan Updated');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(errors).toEqual([]); expect(writes).toEqual([]);
    } finally { await server.close(); }
  });
}
