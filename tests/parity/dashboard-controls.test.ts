
import { expect, test, type Locator } from "@playwright/test";
import { ensureParityBundle, PARITY_DIST_DIR } from "./helpers/bundle.js";
import { assertThemeApplied, installTheme, PARITY_THEMES } from "./helpers/capture.js";
import { startFixtureServer } from "../support/helpers/dashboard/fixture-bff.js";
import { chooseSelect } from "./helpers/select-choice.js";

async function markerError(tabs: Locator): Promise<number> {
  return tabs.evaluate(node => {
    const tab = node.querySelector('[role="tab"][aria-selected="true"]')!, marker = node.querySelector(".ds-tab-indicator")!;
    const active = tab.getBoundingClientRect(), indicator = marker.getBoundingClientRect();
    return Math.max(Math.abs(active.x - indicator.x), Math.abs(active.width - indicator.width));
  });
}

for (const theme of PARITY_THEMES) for (const width of [1024, 1440]) {
  test(`Tabs, spreadsheet controls and Activity dates remain uniform @ ${theme.attribute}-${width}`, async ({ page }, _info) => {
    ensureParityBundle();
    const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
    const errors: string[] = [], writes: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("request", request => { if (request.method() !== "GET") writes.push(new URL(request.url()).pathname); });
    try {
      await page.setViewportSize({ width, height: 900 });
      await page.clock.setFixedTime(new Date("2026-09-26T12:00:00Z"));
      await installTheme(page, theme);
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await page.goto(`${server.baseUrl}/?settings=spreadsheets`);
      const settings = page.getByRole("region", { name: "Settings", exact: true });
      const navigation = settings.getByRole("navigation", { name: "Settings sections" });
      for (const [section, label] of [["Spreadsheets", "Spreadsheet settings"]]) {
        await navigation.getByRole("link", { name: section, exact: true }).click();
        const tabs = settings.getByRole("tablist", { name: label, exact: true });
        const first = tabs.getByRole("tab").first(), second = tabs.getByRole("tab").nth(1);
        const marker = tabs.locator(".ds-tab-indicator");
        await expect.poll(() => markerError(tabs)).toBeLessThanOrEqual(1);
        const listBounds = (await tabs.boundingBox())!, firstBounds = (await first.boundingBox())!;
        expect(firstBounds.x).toBeCloseTo(listBounds.x, 0);
        await second.click();
        await expect(second).toHaveAttribute("aria-selected", "true");
        await expect(marker).toHaveCSS("transition-property", "transform");
        await expect(marker).toHaveCSS("transition-duration", "0.22s");
        await expect.poll(() => markerError(tabs)).toBeLessThanOrEqual(1);
        await first.click(); await second.click(); await first.click();
        await expect(first).toHaveAttribute("aria-selected", "true");
        await expect.poll(() => markerError(tabs)).toBeLessThanOrEqual(1);
        await first.focus(); await page.keyboard.press("ArrowRight");
        await expect(second).toBeFocused(); await expect(second).toHaveAttribute("aria-selected", "true");
        await expect(marker).toHaveCSS("transition-duration", "0s");
        await expect.poll(() => markerError(tabs)).toBeLessThanOrEqual(1);
        await page.emulateMedia({ reducedMotion: "reduce" });
        await first.click();
        await expect(marker).toHaveCSS("transition-duration", "0s");
        await expect.poll(() => markerError(tabs)).toBeLessThanOrEqual(1);

        await page.emulateMedia({ reducedMotion: "no-preference" });
      }
      await navigation.getByRole("link", { name: "Spreadsheets", exact: true }).click();
      await settings.getByRole("button", { name: "26–27 Student applicants.xlsx", exact: true }).click();
      const editor = settings.getByRole("region", { name: "Spreadsheet editor", exact: true });
      const sheet = editor.getByRole("combobox", { name: "Workbook sheet" });
      const height = (await sheet.boundingBox())!.height;
      for (const button of await editor.locator(".spreadsheet-editor-toolbar button, .spreadsheet-editor-footer button").all()) {
        expect((await button.boundingBox())!.height).toBeCloseTo(height, 0);
      }
      await expect(editor).not.toContainText("Exports include");
      await expect(editor).not.toContainText("Click a column letter");
      await expect(editor.getByRole("button", { name: "Previous spreadsheet page" })).toHaveCount(0);
      await expect(editor.getByRole("button", { name: "Next spreadsheet page" })).toHaveCount(0);
      await editor.getByRole("button", { name: /^Columns/u }).click();
      const visible = page.getByRole("menu").filter({ has: page.getByRole("menuitemcheckbox").first() });
      await expect(visible).toBeVisible();
      const firstColumn = visible.getByRole("menuitemcheckbox").first();
      await firstColumn.click(); await expect(firstColumn).toHaveAttribute("aria-checked", "false");
      await firstColumn.click(); await expect(firstColumn).toHaveAttribute("aria-checked", "true");
      await page.keyboard.press("Escape");
      const originalRows = await editor.locator(".spreadsheet-grid tbody tr").count();
      await editor.getByRole("button", { name: "Insert", exact: true }).click();
      await page.getByRole("menuitem", { name: "Add row", exact: true }).click();
      await expect(editor.locator(".spreadsheet-grid tbody tr")).toHaveCount(originalRows + 1);
      await editor.getByRole("button", { name: "Insert", exact: true }).click();
      await page.getByRole("menuitem", { name: "Add column", exact: true }).click();
      const add = page.getByRole("dialog", { name: "Add column", exact: true });
      await add.getByRole("textbox", { name: "Column title" }).fill("Review note");
      await add.getByRole("button", { name: "Add column", exact: true }).click();
      await editor.getByRole("button", { name: "Next spreadsheet columns", exact: true }).click();
      await expect(editor.getByRole("textbox", { name: "AC1", exact: true })).toHaveValue("Review note");
      await editor.getByRole("button", { name: "Previous spreadsheet columns", exact: true }).click();
      const search = editor.getByRole("searchbox", { name: "Search spreadsheet cells", exact: true });
      await search.fill("Jordan"); await expect(editor.locator(".spreadsheet-grid tbody tr")).toHaveCount(1);
      await editor.getByRole("button", { name: "Clear search", exact: true }).click();
      await expect(editor.locator(".spreadsheet-grid tbody tr")).toHaveCount(originalRows + 1);
      await editor.getByRole("button", { name: "Export copy", exact: true }).click();
      const download = page.waitForEvent("download");
      await page.getByRole("menuitem", { name: "Excel workbook (.xlsx)", exact: true }).click();
      expect((await download).suggestedFilename()).toMatch(/\.xlsx$/u);


      await navigation.getByRole("link", { name: "Analytics", exact: true }).click();
      const period = settings.getByRole("combobox", { name: "Report period", exact: true });
      const range = settings.getByRole("group", { name: "Report date range", exact: true });
      await expect(range.getByRole("spinbutton")).toHaveCount(6);
      await expect(range.locator(".date-field__prefix, .date-input-group__prefix")).toHaveCount(0);
      await expect(range.getByText("Start", { exact: true })).toHaveCount(1);
      await expect(range.locator(".ds-date-label").first()).toHaveClass(/sr-only/u);
      const toolbar = (await settings.locator(".activity-header-filters").boundingBox())!, periodControls = (await settings.locator(".activity-period-controls").boundingBox())!, dateBounds = (await range.boundingBox())!, exportBounds = (await settings.getByRole("button", { name: "Export CSV", exact: true }).boundingBox())!, periodBounds = (await period.boundingBox())!;
      expect(periodBounds.x).toBeCloseTo(toolbar.x, 0);
      expect(dateBounds.x + dateBounds.width).toBeCloseTo(periodControls.x + periodControls.width, 0);
      expect(exportBounds.x + exportBounds.width).toBeCloseTo(toolbar.x + toolbar.width, 0);
      expect(exportBounds.x).toBeGreaterThan(dateBounds.x + dateBounds.width);
      expect(dateBounds.x - periodBounds.x - periodBounds.width).toBeGreaterThan(24);
      await chooseSelect(period, "this-week");
      await range.getByRole("spinbutton", { name: /^day, Start/u }).press("ArrowUp");
      await expect(period).toHaveAttribute("data-value", "custom");
      await expect(page).toHaveURL(/activity=2026-09-21\.\.2026-09-26/u);
      const calendar = range.getByRole("button", { name: /^Choose end date range/u });
      await calendar.click();
      await expect(page.getByRole("dialog", { name: "Select report dates", exact: true }).getByRole("grid")).toHaveCount(2);
      await page.keyboard.press("Escape"); await expect(calendar).toBeFocused();

      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await assertThemeApplied(page, theme);
      expect(errors).toEqual([]); expect(writes).toEqual([]);
    } finally { await server.close(); }
  });
}
