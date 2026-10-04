import { readFile } from 'node:fs/promises';
import Excel from 'exceljs';
import { expect, test } from '@playwright/test';
import { ensureParityBundle, PARITY_DIST_DIR } from './helpers/bundle.js';
import { installTheme, PARITY_THEMES } from './helpers/capture.js';
import { startFixtureServer } from './helpers/fixture-bff.js';
import { FIXTURE_DAY } from './helpers/fixture-identity.js';
import { chooseSelect } from './helpers/select-choice.js';

for (const theme of PARITY_THEMES) for (const width of [1024, 1440]) {
  test(`HR GPT settings, shortcuts, Activity and workbook editor @ ${theme.attribute}-${width}`, async ({ page }, info) => {
    ensureParityBundle();
    const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: 'working-tree' } });
    const errors: string[] = [], writes: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (request.method() !== 'GET') writes.push(new URL(request.url()).pathname); });
    try {
      await page.setViewportSize({ width, height: width === 1024 ? 720 : 1000 }); await installTheme(page, theme);
      await page.goto(`${server.baseUrl}/?day=${FIXTURE_DAY}`);
      const rail = page.getByRole('complementary', { name: 'Workspace', exact: true });
      const workflows = rail.getByRole('navigation', { name: 'Workflows', exact: true });
      await expect(rail.getByRole('heading', { name: 'HR GPT', exact: true })).toBeVisible();
      await expect(workflows.locator('button > svg')).toHaveCount(0);
      const meta = workflows.locator('.workflow-rail-meta').first();
      if (width === 1024) await expect(meta).toBeHidden(); else await expect(meta).toBeVisible();
      const bell = rail.getByRole('button', { name: /^Notifications,/ }); await bell.click();
      await expect(rail.getByRole('heading', { name: 'HR GPT', exact: true })).toBeVisible();
      await expect(rail.getByText('History gap', { exact: true })).toHaveCount(0);
      await expect(rail.locator('.notification-row')).toHaveCount(5);
      await rail.getByRole('button', { name: 'Read all', exact: true }).click();
      await expect(bell).toHaveAccessibleName('Notifications, 0 unread');
      await info.attach(`notifications-${theme.attribute}-${width}.png`, { body: await page.screenshot(), contentType: 'image/png' });
      await page.keyboard.press('Escape'); await expect(bell).toBeFocused();
      const queue = page.getByRole('region', { name: 'Queue', exact: true });
      const quick = queue.getByRole('group', { name: 'Frequent queue filters', exact: true });
      await quick.getByRole('button', { name: 'Needs you 3', exact: true }).click(); await quick.getByRole('button', { name: 'Running 3', exact: true }).click();
      await expect(quick.getByRole('button', { name: 'Needs you 3', exact: true })).toHaveAttribute('aria-pressed', 'true');
      await expect(quick.getByRole('button', { name: 'Running 3', exact: true })).toHaveAttribute('aria-pressed', 'true');
      await expect(page.locator('[data-demo-row-id]:not(tr)')).toHaveCount(7);
      await quick.getByRole('button', { name: 'All 14', exact: true }).click();
      const attention = page.getByRole('button', { name: 'Attention first', exact: true });
      await expect(attention).toHaveAttribute('aria-pressed', 'true');
      const sort = page.getByRole('combobox', { name: 'Sort the queue', exact: true });
      await sort.click(); await expect(page.getByRole('option', { name: 'Newest first', exact: true })).toBeVisible(); await expect(page.getByRole('option', { name: 'Attention first', exact: true })).toHaveCount(0); await page.keyboard.press('Escape'); await expect(sort).toHaveAttribute('aria-expanded', 'false');
      for (const mode of ['newest', 'oldest', 'longest']) {
        await chooseSelect(sort, mode); await expect(attention).toHaveAttribute('aria-pressed', 'false'); await expect(queue.locator('[data-queue-band]')).toHaveCount(0);
      }
      await attention.click(); await expect(queue.locator('[data-queue-band]')).toHaveCount(4);
      await attention.click(); await expect(queue.locator('[data-queue-band]')).toHaveCount(0);
      await attention.click();
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      await expect(queue).toHaveCount(0); await expect(rail).toBeHidden();
      const settings = page.getByRole('region', { name: 'Settings', exact: true });
      const nav = settings.getByRole('navigation', { name: 'Settings sections', exact: true });
      expect((await nav.boundingBox())!.x).toBe(0); expect((await nav.boundingBox())!.width).toBe(264);
      await expect(nav.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
      await expect(nav.getByRole('button', { name: /^Notifications,|^Search runs$/u })).toHaveCount(0);
      const choosePage = async (name: string) => { await nav.getByRole('link', { name, exact: true }).click(); };
      await nav.getByRole('searchbox', { name: 'Search settings', exact: true }).fill('sheet');
      await expect(nav.getByRole('link')).toHaveCount(1); await expect(nav.getByRole('link', { name: 'Spreadsheets', exact: true })).toBeVisible();
      await nav.getByRole('searchbox', { name: 'Search settings', exact: true }).fill('');
      await choosePage('Keyboard');
      await expect(settings.locator('.shortcut-reference-row')).toHaveCount(6);
      await settings.getByRole('button', { name: 'Edit Start a run shortcut 1', exact: true }).click();
      const edit = page.getByRole('dialog', { name: 'Edit shortcut', exact: true }); await edit.getByRole('textbox', { name: 'Shortcut keys', exact: true }).press('q'); await edit.getByRole('button', { name: 'Save shortcut', exact: true }).click();
      await expect(settings.locator('.shortcut-reference-row').filter({ hasText: 'Start a run' }).locator('kbd')).toHaveText('q');
      await settings.getByRole('button', { name: 'Edit Run actions shortcut 1', exact: true }).click(); await edit.getByRole('textbox', { name: 'Shortcut keys', exact: true }).press('q'); await edit.getByRole('button', { name: 'Save shortcut', exact: true }).click(); await expect(edit).toContainText('already assigned'); await edit.getByRole('button', { name: 'Cancel', exact: true }).click();
      await info.attach(`shortcuts-${theme.attribute}-${width}.png`, { body: await page.screenshot(), contentType: 'image/png' });
      await settings.getByRole('button', { name: 'Back to dashboard', exact: true }).click(); await page.getByRole('button', { name: 'Start a run', exact: true }).focus(); await page.keyboard.press('q');
      await expect(page.getByRole('dialog', { name: 'Start a run', exact: true })).toBeVisible(); await page.keyboard.press('Escape');
      await page.reload(); await page.getByRole('button', { name: 'Settings', exact: true }).click(); await choosePage('Keyboard');
      await expect(settings.locator('.shortcut-reference-row').filter({ hasText: 'Start a run' }).locator('kbd')).toHaveText('q');
      await settings.getByRole('button', { name: 'Reset defaults', exact: true }).click();
      await choosePage('General');
      const date = settings.locator('[data-settings-path$=".jobEndDate"] .ds-date-picker');
      await expect(date.locator('.ds-date-text-input')).toHaveCount(0); await expect(date.getByRole('spinbutton')).toHaveCount(3);
      await date.getByRole('button', { name: /^Choose job end date/u }).click(); await expect(page.locator('.ds-calendar')).toBeVisible(); await page.keyboard.press('Escape');
      await choosePage('Preflight'); await expect(settings.getByRole('heading', { name: 'Preflight', exact: true })).toBeVisible(); await expect(settings.getByRole('heading', { name: 'Workflow capabilities', exact: true })).toBeVisible();
      await choosePage('Activity'); await expect(settings.getByRole('button', { name: 'Export report' })).toHaveCount(0); await expect(settings.getByRole('button', { name: 'How this report is counted' })).toHaveCount(0);
      const outcomes = settings.getByRole('table', { name: 'Workflow outcomes', exact: true }); await expect(outcomes.getByRole('button')).toHaveCount(0); await expect(outcomes).not.toContainText('Version');
      const period = settings.getByRole('combobox', { name: 'Report period', exact: true }); await chooseSelect(period, 'this-week');
      const baseline = settings.getByRole('table', { name: 'Manual work baselines', exact: true }); await baseline.getByRole('spinbutton').nth(0).fill('12'); await baseline.getByRole('spinbutton').nth(1).fill('2'); await expect(settings.getByText(/h estimated$/)).toBeVisible();
      await info.attach(`activity-${theme.attribute}-${width}.png`, { body: await page.screenshot(), contentType: 'image/png' });
      await choosePage('Spreadsheets');
      const original = new Excel.Workbook(), sheet = original.addWorksheet('People'); sheet.addRows([['Name', 'ID', 'Department'], ['Zoe', '00002', 'Services'], ['Alex', '00001', 'Payroll']]);
      sheet.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFB7D7F0' } }; sheet.getCell('A2').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFE699' } }; sheet.getCell('A3').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC6E0B4' } };
      const source = Buffer.from(await original.xlsx.writeBuffer());
      await settings.locator('input[type=file]').setInputFiles({ name: 'People.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: source });
      await expect(settings.getByRole('textbox', { name: 'A2', exact: true })).toHaveValue('Zoe');
      await expect(settings.getByRole('textbox', { name: 'A2', exact: true }).locator('..')).toHaveCSS('background-color', 'rgb(255, 230, 153)');
      await settings.getByRole('button', { name: 'Sort column A', exact: true }).click(); await expect(settings.getByRole('textbox', { name: 'A2', exact: true })).toHaveValue('Alex');
      await expect(settings.getByRole('textbox', { name: 'A2', exact: true }).locator('..')).toHaveCSS('background-color', 'rgb(198, 224, 180)');
      await settings.getByRole('textbox', { name: 'A2', exact: true }).fill('Alex edited');
      await settings.getByRole('button', { name: 'Add column', exact: true }).click(); const add = page.getByRole('dialog', { name: 'Add column', exact: true }); await add.getByRole('textbox', { name: 'Column title', exact: true }).fill('Notes'); await add.getByRole('button', { name: 'Add column', exact: true }).click();
      await settings.getByRole('button', { name: 'Add row', exact: true }).click(); await settings.getByRole('textbox', { name: 'A4', exact: true }).fill('New person');
      await settings.getByRole('button', { name: 'Columns 4/4', exact: true }).click(); await page.getByRole('menuitemcheckbox', { name: 'C · Department', exact: true }).click(); await page.keyboard.press('Escape'); await expect(settings.getByRole('textbox', { name: 'C2', exact: true })).toHaveCount(0);
      await choosePage('General'); await choosePage('Spreadsheets'); await expect(settings.getByRole('textbox', { name: 'A2', exact: true })).toHaveValue('Alex edited');
      await info.attach(`workbook-${theme.attribute}-${width}.png`, { body: await page.screenshot(), contentType: 'image/png' });
      for (const format of ['xlsx', 'csv'] as const) {
        await settings.getByRole('button', { name: 'Export copy', exact: true }).click(); const downloaded = page.waitForEvent('download'); await page.getByRole('menuitem', { name: format === 'xlsx' ? 'Excel workbook (.xlsx)' : 'Current sheet (.csv)', exact: true }).click();
        const download = await downloaded; expect(download.suggestedFilename()).toBe(`People-edited.${format}`); const data = await readFile((await download.path()));
        if (format === 'xlsx') { const exported = new Excel.Workbook(); await exported.xlsx.load(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)); expect(exported.worksheets[0].getCell('A2').value).toBe('Alex edited'); expect(exported.worksheets[0].getCell('A2').fill).toEqual(sheet.getCell('A3').fill); expect(exported.worksheets[0].getCell('C1').value).toBe('Notes'); }
        else { expect(data.toString()).toContain('Name,ID,Notes'); expect(data.toString()).toContain('Alex edited,00001,'); expect(data.toString()).toContain('New person,,'); }
      }
      await settings.getByRole('button', { name: 'Back to dashboard', exact: true }).click(); await expect(page.getByRole('dialog', { name: 'Discard unsaved settings?', exact: true })).toBeVisible(); await page.getByRole('button', { name: 'Keep editing', exact: true }).click(); await expect(settings.getByRole('textbox', { name: 'A2', exact: true })).toHaveValue('Alex edited');
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width); expect(errors).toEqual([]); expect(writes).toEqual([]);
    } finally { await server.close(); }
  });
}
