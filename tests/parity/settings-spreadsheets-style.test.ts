import { expect } from '@playwright/test';
import { test } from "./helpers/fixtures.js";
import { PARITY_DIST_DIR } from './helpers/bundle.js';
import { assertThemeApplied, installTheme, PARITY_THEMES } from './helpers/capture.js';
import { startFixtureServer } from '../support/helpers/dashboard/fixture-bff.js';

for (const theme of PARITY_THEMES) for (const width of [1024, 1440]) {
  test(`Spreadsheets matches approved HUB controls @ ${theme.attribute} ${width}`, async ({ page }) => {
    const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: 'working-tree' } });
    try {
      await page.setViewportSize({ width, height: width === 1024 ? 720 : 1000 });
      await installTheme(page, theme);
      await page.goto(`${server.baseUrl}/?settings=spreadsheets`);
      const surface = page.getByRole('region', { name: 'Spreadsheets', exact: true });
      await expect(surface.getByRole('heading', { name: 'Spreadsheets', exact: true })).toHaveCSS('font-size', '27px');
      await expect(surface.getByRole('heading', { name: 'Spreadsheets', exact: true })).toHaveCSS('line-height', '33px');
      await expect(surface.getByRole('heading', { name: 'Spreadsheets', exact: true })).toHaveCSS('font-weight', '650');
      await expect(surface.getByRole('tablist', { name: 'Spreadsheet settings' })).toHaveCount(0);
      await expect(surface.getByRole('heading', { level: 2 })).toHaveText(['Spreadsheet types', 'Kronos reports']);
      await expect(surface.getByRole('table', { name: 'Registered spreadsheets', exact: true }).getByRole('columnheader')).toHaveText(['Spreadsheet', 'Type', 'Rows', 'Actions']);
      for (const button of await surface.locator('.hub-sheets-toolbar').getByRole('button').all()) {
        await expect(button).toHaveCSS('font-size', '12px');
        await expect(button).toHaveCSS('line-height', '18px');
        await expect(button).toHaveCSS('font-weight', '500');
        await expect(button.locator('svg')).toHaveCount(0);
        await expect(button).toHaveCSS('border-radius', '8px');
        expect((await button.boundingBox())!.height).toBe(32);
      }
      const create = surface.getByRole('button', { name: 'Create type', exact: true });
      await create.focus(); await page.keyboard.press('Enter');
      const dialog = page.getByRole('dialog', { name: 'Create spreadsheet type', exact: true });
      await expect(dialog.getByRole('textbox', { name: 'Type name', exact: true })).toBeFocused();
      await expect(dialog.getByRole('button', { name: 'Save type', exact: true })).toBeDisabled();
      await page.keyboard.press('Escape'); await expect(create).toBeFocused();
      const edit = surface.getByRole('button', { name: 'Edit Roster', exact: true });
      await edit.focus(); await page.keyboard.press('Space');
      const editDialog = page.getByRole('dialog', { name: 'Edit spreadsheet type', exact: true });
      await expect(editDialog.getByRole('textbox', { name: 'Type name', exact: true })).toHaveValue('Roster');
      await editDialog.getByRole('button', { name: 'Cancel', exact: true }).click(); await expect(edit).toBeFocused();
      const chooser = page.waitForEvent('filechooser');
      await surface.getByRole('button', { name: 'Import spreadsheet', exact: true }).click();
      expect((await chooser).isMultiple()).toBe(false);
      await assertThemeApplied(page, theme);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    } finally { await server.close(); }
  });
}
