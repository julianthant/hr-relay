import { expect, test, type Locator } from "@playwright/test";
import { ensureParityBundle, PARITY_DIST_DIR } from "./helpers/bundle.js";
import { assertThemeApplied, installTheme, PARITY_THEMES } from "./helpers/capture.js";
import { startFixtureServer } from "./helpers/fixture-bff.js";

async function tableStyle(cell: Locator) {
  return cell.evaluate(node => {
    const style = getComputedStyle(node);
    return { font: style.fontSize, line: style.lineHeight, weight: style.fontWeight, padding: style.padding };
  });
}

async function expectTitleActions(heading: Locator) {
  const title = (await heading.getByRole("heading").boundingBox())!;
  const actions = (await heading.locator(".ds-page-heading-actions").boundingBox())!;
  expect(actions.x).toBeGreaterThan(title.x + title.width);
  expect(Math.abs(actions.y + actions.height / 2 - title.y - title.height / 2)).toBeLessThanOrEqual(1);
}

for (const theme of PARITY_THEMES) for (const width of [1024, 1440]) {
  test(`Archive shares the spreadsheet table layout @ ${theme.attribute}-${width}`, async ({ page }, info) => {
    ensureParityBundle();
    const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
    const errors: string[] = [], writes: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("request", request => { if (request.method() !== "GET") writes.push(new URL(request.url()).pathname); });
    try {
      await page.setViewportSize({ width, height: width === 1024 ? 720 : 1000 });
      await installTheme(page, theme);
      await page.goto(`${server.baseUrl}/?settings=spreadsheets`);
      const library = page.getByRole("table", { name: "Registered spreadsheets", exact: true });
      await expect(library).toBeVisible();
      await expectTitleActions(page.locator(".spreadsheet-workspace .ds-page-heading"));
      const headerStyle = await tableStyle(library.locator("th").first());
      const cellPadding = await library.locator("td").first().evaluate(node => getComputedStyle(node).padding);
      const rowHeight = (await library.locator("tbody tr").first().boundingBox())!.height;
      const searchWidth = (await page.locator(".ds-table-toolbar-search").boundingBox())!.width;
      expect(searchWidth).toBe(280);
      const frameStyle = await page.locator(".ds-table-list-frame").evaluate(node => ({ radius: getComputedStyle(node).borderRadius, background: getComputedStyle(node).backgroundColor }));
      await info.attach(`table-spreadsheets-${theme.attribute}-${width}.png`, { body: await page.screenshot(), contentType: "image/png" });

      await page.getByRole("link", { name: "Archive", exact: true }).click();
      const archive = page.getByRole("region", { name: "Archive", exact: true });
      await expect(archive.getByRole("button", { name: "Export workflow", exact: true })).toHaveCount(0);
      await archive.getByRole("region", { name: "Dashboard 1.3", exact: true }).getByRole("button", { name: /^Separations/u }).click();
      const table = archive.getByRole("table", { name: "Saved reports", exact: true });
      await expect(table.getByRole("row")).toHaveCount(5);
      await expect(table.getByRole("columnheader")).toHaveCount(8);
      await expectTitleActions(archive.locator(".mock-archive-folder-header .ds-page-heading"));
      await expect(archive.locator(".ds-page-heading-description")).toHaveCount(0);
      await expect(archive.locator(".ds-table-toolbar-summary")).toHaveText("4 reports");
      expect(await tableStyle(table.locator("th").first())).toEqual(headerStyle);
      expect(await table.locator("td").first().evaluate(node => getComputedStyle(node).padding)).toBe(cellPadding);
      expect((await table.locator("td").first().boundingBox())!.width).toBeGreaterThanOrEqual(314);
      expect((await table.locator("tbody tr").first().boundingBox())!.height).toBeLessThanOrEqual(rowHeight + 1);
      expect((await archive.locator(".ds-table-toolbar-search").boundingBox())!.width).toBe(searchWidth);
      expect(await archive.locator(".ds-table-list-frame").evaluate(node => ({ radius: getComputedStyle(node).borderRadius, background: getComputedStyle(node).backgroundColor }))).toEqual(frameStyle);
      await expect(archive.locator(".ds-table-list")).toHaveCSS("gap", "12px");
      const toolbar = (await archive.locator(".ds-table-toolbar").boundingBox())!;
      for (const control of await archive.locator(".ds-table-toolbar-search, .ds-date-range, .ds-table-toolbar-summary").all()) {
        const box = (await control.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(toolbar.x);
        expect(box.x + box.width).toBeLessThanOrEqual(toolbar.x + toolbar.width + 1);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      const frame = archive.locator(".ds-table-list-frame");
      await frame.evaluate(node => { node.scrollLeft = node.scrollWidth; });
      await expect(table.getByRole("button", { name: "Open report for Jordan Lee", exact: true })).toBeInViewport();
      await frame.evaluate(node => { node.scrollLeft = 0; });
      await assertThemeApplied(page, theme);
      await info.attach(`table-archive-${theme.attribute}-${width}.png`, { body: await page.screenshot(), contentType: "image/png" });

      const range = archive.getByRole("group", { name: "Completed date range", exact: true });
      await expect(range.getByRole("spinbutton")).toHaveCount(6);
      const calendar = range.getByRole("button").first();
      await calendar.click();
      await expect(page.locator(".ds-calendar-popover")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(calendar).toBeFocused();
      await archive.getByRole("textbox", { name: "Search saved reports", exact: true }).fill("Jordan");
      await expect(table.getByRole("row")).toHaveCount(2);
      await expect(archive.locator(".ds-table-toolbar-summary")).toHaveText("1 report");
      await archive.getByRole("button", { name: "Reset filters", exact: true }).click();
      await expect(table.getByRole("row")).toHaveCount(5);
      const open = table.getByRole("button", { name: "Appointment ended · Jordan Lee", exact: true });
      await open.focus();
      await page.keyboard.press("Enter");
      await expect(archive.getByRole("article", { name: "Saved run report", exact: true })).toBeVisible();
      await expectTitleActions(archive.locator(".mock-archive-folder-header .ds-page-heading"));
      await expect(archive.getByRole("button", { name: "Export workflow", exact: true })).toHaveCount(0);
      await archive.getByRole("button", { name: "Export run", exact: true }).click();
      const downloading = page.waitForEvent("download");
      await page.getByRole("menuitem", { name: "JSON", exact: true }).click();
      expect((await downloading).suggestedFilename()).toBe("mock-run-48216.json");
      const bump = archive.getByRole("button", { name: "Plan a bump", exact: true });
      await bump.click();
      await page.getByRole("dialog", { name: "Plan a version bump", exact: true }).getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(bump).toBeFocused();
      expect(errors).toEqual([]);
      expect(writes).toEqual([]);
    } finally { await server.close(); }
  });
}
