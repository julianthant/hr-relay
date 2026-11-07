import { chooseSelect } from "./helpers/select-choice.js";
import { expect, type Locator } from '@playwright/test';
import { test } from "./helpers/fixtures.js";
import { PARITY_DIST_DIR } from './helpers/bundle.js';
import { startFixtureServer } from '../support/helpers/dashboard/fixture-bff.js';
import { installTheme, PARITY_THEMES } from './helpers/capture.js';



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

test(`global single and range calendars across Logs and Activity @ ${theme.attribute}-${width}`, async ({ page }, _info) => {
    const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: 'working-tree' } });
    try {
      await page.setViewportSize({ width, height: 900 });
      await page.clock.setFixedTime(new Date('2026-09-26T12:00:00Z'));
      await installTheme(page, theme);
      const writes: string[] = [], errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('request', request => { if (request.method() !== 'GET') writes.push(request.url()); });
      await page.goto(`${server.baseUrl}/`);
      const date = page.locator('.dashboard-log-date').getByRole('button', { name: /^Choose date/u });
      const dateFieldStyle = await controlStyle(page.locator('.dashboard-log-date .date-input-group'));
      await date.click();
      const single = page.getByRole('dialog', { name: 'Choose date', exact: true });
      await expect(single).toHaveCSS('opacity', '1');
      await expect(single.getByRole('grid')).toHaveCount(1);
      await expect(single.getByRole('button', { name: /Tuesday, August 4, 2026/u })).toBeDisabled();
      const singleStyle = await calendarStyle(single);
      const singleWidth = (await single.boundingBox())!.width;
      await page.keyboard.press('Escape');
      await expect(date).toBeFocused();

      await page.getByRole("button", { name: "Settings", exact: true }).click();
      await page.getByRole("link", { name: "Analytics", exact: true }).click();
      await chooseSelect(page.getByRole('combobox', { name: 'Report period' }), 'custom');
      const start = page.getByRole('button', { name: /^Choose start date range/u });
      const end = page.getByRole('button', { name: /^Choose end date range/u });
      const controls = page.getByRole('group', { name: 'Report date range', exact: true }).locator('.date-input-group');
      const buttonStyle = await controlStyle(page.getByRole('combobox', { name: 'Report period', exact: true }));
      expect(await controlStyle(controls.first())).toEqual(buttonStyle);
      expect(await controlStyle(controls.last())).toEqual(buttonStyle);
      expect(dateFieldStyle).toEqual({ ...buttonStyle, height: '32px', radius: '6px' });
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
      await range.getByRole('grid').first().getByRole('button', { name: /Wednesday, September 30, 2026/u }).click();
      expect(new URL(page.url()).searchParams.get("activity")).toBe("");
      await range.getByRole('grid').nth(1).getByRole('button', { name: /Friday, October 2, 2026/u }).click();
      await expect(range).toHaveCount(0);
      await expect(page).toHaveURL(/activity=2026-09-30\.\.2026-10-02/u);
      const pair = page.getByRole('group', { name: 'Report date range', exact: true });
      await expect(pair.getByRole('spinbutton', { name: /^day, Start/u })).toHaveText('30');
      await expect(pair.getByRole('spinbutton', { name: /^month, End/u })).toHaveText('10');
      await expect(pair.getByRole('spinbutton', { name: /^day, End/u })).toHaveText('02');
      await start.click();
      const sameDay = range.getByRole('grid').first().getByRole('button', { name: /Wednesday, September 30, 2026/u });
      await sameDay.click();
      await sameDay.click();
      await expect(page).toHaveURL(/activity=2026-09-30\.\.2026-09-30/u);

      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(writes).toEqual([]);
      expect(errors).toEqual([]);
    } finally { await server.close(); }
  });
}

test('default DatePicker fields and the shared range preserve typed dates and update both endpoints', async ({ page }) => {
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
    await expect(pair.getByRole('spinbutton', { name: /^month, Start/u })).toHaveText('07');
    await expect(pair.getByRole('spinbutton', { name: /^day, Start/u })).toHaveText('31');
    await expect(pair.getByRole('spinbutton', { name: /^month, End/u })).toHaveText('08');
    await expect(pair.getByRole('spinbutton', { name: /^day, End/u })).toHaveText('02');
    const endDay = pair.getByRole('spinbutton', { name: /^day, End/u });
    await endDay.focus();
    await endDay.press('Alt+ArrowDown');
    await expect(range).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(endDay).toBeFocused();
  } finally { await server.close(); }
});
