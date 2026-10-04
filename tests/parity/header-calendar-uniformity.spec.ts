import { expect, test, type Locator } from '@playwright/test';
import { ensureParityBundle, PARITY_DIST_DIR } from './helpers/bundle.js';
import { startFixtureServer } from './helpers/fixture-bff.js';
import { installTheme, PARITY_THEMES } from './helpers/capture.js';
import { ArchiveBrowseStateSchema } from '../../src/dashboard/app/archive-route-model.js';

async function calendarStyle(picker: Locator) {
  return picker.locator('.ds-calendar').evaluate(el => {
    const style = getComputedStyle(el);
    return { accent: style.getPropertyValue('--accent'), focus: style.getPropertyValue('--focus'), muted: style.getPropertyValue('--muted'), color: style.color, font: style.fontFamily };
  });
}

async function controlStyle(control: Locator) {
  return control.evaluate(el => {
    const style = getComputedStyle(el);
    return { background: style.backgroundColor, border: style.borderColor, width: style.borderWidth, radius: style.borderRadius, height: style.height };
  });
}

for (const theme of PARITY_THEMES) for (const width of [1024, 1440]) {
  test(`global single and range calendars across Navbar, Activity and Archive @ ${theme.attribute}-${width}`, async ({ page }, info) => {
    ensureParityBundle();
    const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: 'working-tree' } });
    try {
      await page.setViewportSize({ width, height: 900 });
      await page.clock.setFixedTime(new Date('2026-09-26T12:00:00Z'));
      await installTheme(page, theme);
      const writes: string[] = [], errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('request', request => { if (request.method() !== 'GET') writes.push(request.url()); });
      await page.goto(`${server.baseUrl}/?activity=`);
      const date = page.getByRole('banner').getByRole('button', { name: /^Choose date/u });
      await date.click();
      const single = page.getByRole('dialog', { name: 'Choose date', exact: true });
      await expect(single).toHaveCSS('opacity', '1');
      await expect(single.getByRole('grid')).toHaveCount(1);
      await expect(single.getByRole('button', { name: /Sunday, September 27, 2026/u })).toBeDisabled();
      const singleStyle = await calendarStyle(single);
      const singleWidth = (await single.boundingBox())!.width;
      await single.screenshot({ path: info.outputPath(`single-${theme.attribute}-${width}.png`) });
      await page.keyboard.press('Escape');
      await expect(date).toBeFocused();

      await page.getByRole('combobox', { name: 'Report period' }).selectOption('custom');
      const start = page.getByRole('button', { name: /^Choose start date range/u });
      const end = page.getByRole('button', { name: /^Choose end date range/u });
      const controls = page.getByRole('group', { name: 'Custom report range', exact: true }).locator('.date-input-group');
      const buttonStyle = await controlStyle(page.getByRole('button', { name: 'Export report', exact: true }));
      expect(await controlStyle(controls.first())).toEqual(buttonStyle);
      expect(await controlStyle(controls.last())).toEqual(buttonStyle);
      const header = page.getByRole('banner').locator('.ds-date-navigation');
      expect(await controlStyle(header)).toEqual(buttonStyle);
      await expect(header.locator('.date-input-group')).toHaveCSS('border-width', '0px');
      await expect(header.locator('.date-input-group')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
      const startDay = controls.first().getByRole('spinbutton', { name: /^day, Start/u });
      await startDay.focus();
      await expect(controls.first()).toHaveCSS('box-shadow', /0px 0px 0px 2px/u);
      await start.click();
      const range = page.getByRole('dialog', { name: 'Select report dates', exact: true });
      await expect(range).toHaveCSS('opacity', '1');
      await expect(range.getByRole('grid')).toHaveCount(2);
      expect(await calendarStyle(range)).toEqual(singleStyle);
      const rangeWidth = (await range.boundingBox())!.width;
      expect(rangeWidth).toBeGreaterThan(singleWidth * 1.8);
      await expect(end).toHaveAttribute('aria-controls', (await start.getAttribute('aria-controls'))!);
      const bounds = (await range.boundingBox())!;
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
      await range.screenshot({ path: info.outputPath(`range-${theme.attribute}-${width}.png`) });
      await range.getByRole('grid').first().getByRole('button', { name: /Wednesday, September 30, 2026/u }).click();
      await expect(page).toHaveURL(/activity=$/u);
      await range.getByRole('grid').nth(1).getByRole('button', { name: /Friday, October 2, 2026/u }).click();
      await expect(range).toHaveCount(0);
      await expect(page).toHaveURL(/activity=2026-09-30\.\.2026-10-02/u);
      const pair = page.getByRole('group', { name: 'Custom report range', exact: true });
      await expect(pair.getByRole('spinbutton', { name: /^day, Start/u })).toHaveText('30');
      await expect(pair.getByRole('spinbutton', { name: /^month, End/u })).toHaveText('10');
      await expect(pair.getByRole('spinbutton', { name: /^day, End/u })).toHaveText('2');
      await start.click();
      const sameDay = range.getByRole('grid').first().getByRole('button', { name: /Wednesday, September 30, 2026/u });
      await sameDay.click();
      await sameDay.click();
      await expect(page).toHaveURL(/activity=2026-09-30\.\.2026-09-30/u);

      await page.goto(`${server.baseUrl}/?archive=&archiveDashboard=1.3&archiveWorkflow=archive-demo-separation`);
      const from = page.getByRole('button', { name: /^Choose completed from \(utc\) date range/u });
      const through = page.getByRole('button', { name: /^Choose completed through \(utc\) date range/u });
      await through.click();
      const archived = page.getByRole('dialog', { name: 'Completed date range', exact: true });
      await expect(archived).toHaveCSS('opacity', '1');
      expect((await archived.boundingBox())!.width).toBe(rangeWidth);
      expect(await calendarStyle(archived)).toEqual(singleStyle);
      await archived.getByRole('grid').first().getByRole('button', { name: /Thursday, September 24, 2026/u }).click();
      await archived.getByRole('grid').first().getByRole('button', { name: /Friday, September 25, 2026/u }).click();
      await expect(archived).toHaveCount(0);
      await expect(through).toBeFocused();
      const filters = ArchiveBrowseStateSchema.parse(JSON.parse(new URL(page.url()).searchParams.get('archiveBrowse')!)).filters;
      expect(filters.from).toBe('2026-09-24T00:00:00.000Z');
      expect(filters.to).toBe('2026-09-25T23:59:59.999Z');
      const fromDay = page.getByRole('spinbutton', { name: /^day, Completed from/u });
      await fromDay.focus();
      await fromDay.press('3');
      await fromDay.press('0');
      await expect(fromDay).toHaveText('30');
      await expect(page.locator('.ds-date-picker[data-invalid="true"]')).toHaveCount(2);
      const invalid = page.locator('.ds-date-picker[data-invalid="true"] .date-input-group').first();
      await expect.poll(async () => (await controlStyle(invalid)).border).not.toBe(buttonStyle.border);
      const validFilters = ArchiveBrowseStateSchema.parse(JSON.parse(new URL(page.url()).searchParams.get('archiveBrowse')!)).filters;
      expect(validFilters.from! <= validFilters.to!).toBe(true);
      await from.click();
      await expect(archived.getByRole('grid')).toHaveCount(2);
      await page.keyboard.press('Escape');
      await expect(from).toBeFocused();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(writes).toEqual([]);
      expect(errors).toEqual([]);
    } finally { await server.close(); }
  });
}

test('default DatePicker fields and the shared range preserve typed dates and update both endpoints', async ({ page }) => {
  ensureParityBundle();
  const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: 'working-tree' } });
  try {
    await page.goto(`${server.baseUrl}/kit.html#forms`);
    const forms = page.locator('#forms');
    await forms.getByRole('button', { name: 'Choose start date Start date', exact: true }).click();
    const picker = page.getByRole('dialog', { name: 'Choose start date', exact: true });
    await picker.getByRole('button', { name: /year selector/u }).click();
    await picker.getByRole('button', { name: '2025', exact: true }).click();
    await expect(picker.getByRole('button', { name: 'December 2025, year selector', exact: true })).toBeVisible();
    await picker.getByRole('button', { name: /Wednesday, December 17, 2025/u }).click();
    await expect(picker).toHaveCount(0);
    await expect(forms.getByRole('group', { name: 'Start date', exact: true }).getByRole('spinbutton', { name: /^year/u })).toHaveText('2025');
    await forms.getByRole('button', { name: 'Open launch controls', exact: true }).click();
    const launch = page.getByRole('dialog', { name: 'Launch controls', exact: true });
    const text = launch.getByRole('textbox', { name: 'Last day worked', exact: true });
    await text.fill('02/30/2026');
    await expect(text).toHaveValue('02/30/2026');
    await expect(text.locator('xpath=ancestor::*[@data-invalid][1]')).toBeVisible();
    await text.fill('07/16/2026');
    await launch.getByRole('button', { name: /^Choose last day worked/u }).click();
    const nested = page.getByRole('dialog', { name: 'Choose last day worked', exact: true });
    await nested.getByRole('button', { name: /Friday, July 17, 2026/u }).click();
    await expect(text).toHaveValue('07/17/2026');
    await launch.getByRole('button', { name: 'Close controls', exact: true }).click();
    const pair = forms.getByRole('group', { name: 'Choose specimen date range', exact: true });
    await pair.getByRole('button', { name: /^Choose start date range/u }).click();
    const range = page.getByRole('dialog', { name: 'Choose specimen date range', exact: true });
    await range.getByRole('grid').first().getByRole('button', { name: /Friday, July 31, 2026/u }).click();
    await range.getByRole('grid').nth(1).getByRole('button', { name: /Sunday, August 2, 2026/u }).click();
    await expect(range).toHaveCount(0);
    await expect(pair.getByRole('spinbutton', { name: /^month, Start/u })).toHaveText('7');
    await expect(pair.getByRole('spinbutton', { name: /^day, Start/u })).toHaveText('31');
    await expect(pair.getByRole('spinbutton', { name: /^month, End/u })).toHaveText('8');
    await expect(pair.getByRole('spinbutton', { name: /^day, End/u })).toHaveText('2');
    const endDay = pair.getByRole('spinbutton', { name: /^day, End/u });
    await endDay.focus();
    await endDay.press('Alt+ArrowDown');
    await expect(range).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(endDay).toBeFocused();
  } finally { await server.close(); }
});
