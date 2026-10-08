
import { expect, test, type Locator } from "@playwright/test";
import { ensureParityBundle, PARITY_DIST_DIR } from "./helpers/bundle.js";
import { assertThemeApplied, installTheme, PARITY_THEMES } from "./helpers/capture.js";
import { startFixtureServer } from "./helpers/fixture-bff.js";

async function typography(control: Locator) {
  return control.evaluate(node => {
    const style = getComputedStyle(node);
    return { size: style.fontSize, line: style.lineHeight, weight: style.fontWeight };
  });
}

for (const theme of PARITY_THEMES) for (const width of [1024, 1440]) {
  test(`Spreadsheets matches Settings controls @ ${theme.attribute} ${width}`, async ({ page }, _info) => {
    ensureParityBundle();
    const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
    try {
      await page.setViewportSize({ width, height: width === 1024 ? 720 : 1000 });
      await installTheme(page, theme);
      await page.goto(`${server.baseUrl}/?settings=storage`);
      const storageHeading = page.locator('.ds-page-heading');
      const titleStyle = await typography(storageHeading.getByRole('heading'));
      const actionStyle = await typography(storageHeading.getByRole('button'));
      const actionHeight = (await storageHeading.getByRole('button').boundingBox())!.height;
      await page.goto(`${server.baseUrl}/?settings=spreadsheets`);
      const surface = page.getByRole('region', { name: 'Spreadsheets', exact: true });
      const heading = surface.locator('.ds-page-heading');
      expect(await typography(heading.getByRole('heading'))).toEqual(titleStyle);
      const copy = (await heading.locator('.ds-page-heading-copy').boundingBox())!;
      const actions = (await heading.locator(':scope > div').last().boundingBox())!;
      expect(actions.x).toBeGreaterThan(copy.x + copy.width);
      expect(Math.abs(actions.y + actions.height / 2 - copy.y - copy.height / 2)).toBeLessThanOrEqual(2);
      for (const button of await heading.getByRole('button').all()) {
        expect(await typography(button)).toEqual(actionStyle);
        expect((await button.boundingBox())!.height).toBe(actionHeight);
        await expect(button.locator('svg')).toHaveCSS('width', '14px');
      }
      const tabs = surface.getByRole('tablist', { name: 'Spreadsheet settings' });
      const registered = tabs.getByRole('tab', { name: /^Registered spreadsheets/u });
      const types = tabs.getByRole('tab', { name: /^Spreadsheet types/u });
      await expect(registered).toHaveCSS('border-bottom-width', '2px');
      await expect(registered).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
      await registered.focus();
      await page.keyboard.press('ArrowRight');
      await expect(types).toBeFocused();
      await expect(types).toHaveAttribute('aria-selected', 'true');
      const addType = surface.getByRole('button', { name: 'Add spreadsheet type', exact: true });
      expect(await typography(addType)).toEqual(actionStyle);
      await addType.click();
      const dialog = page.getByRole('dialog', { name: 'Add spreadsheet type', exact: true });
      await expect(dialog).toBeVisible();
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(addType).toBeFocused();
      await types.focus();
      await page.keyboard.press('ArrowLeft');
      await expect(registered).toHaveAttribute('aria-selected', 'true');
      await expect(surface.getByRole('table', { name: 'Registered spreadsheets', exact: true })).toBeVisible();
      const chooser = page.waitForEvent('filechooser');
      await heading.getByRole('button', { name: 'Import spreadsheet', exact: true }).click();
      expect((await chooser).isMultiple()).toBe(false);
      await assertThemeApplied(page, theme);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    } finally { await server.close(); }
  });
}
