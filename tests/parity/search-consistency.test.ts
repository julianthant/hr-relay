
import { expect, type Page } from "@playwright/test";
import { test } from "./helpers/fixtures.js";
import { PARITY_DIST_DIR } from "./helpers/bundle.js";
import { assertThemeApplied, installTheme, PARITY_THEMES } from "./helpers/capture.js";
import { startFixtureServer } from "../support/helpers/dashboard/fixture-bff.js";
import { FIXTURE_DAY } from "./helpers/fixture-identity.js";

async function expectSearchCorners(page: Page) {
  const groups = page.locator('.ds-search-field [data-slot="search-field-group"]:visible');
  expect(await groups.count()).toBeGreaterThan(0);
  for (const group of await groups.all()) {
    for (const corner of ["top-left", "top-right", "bottom-left", "bottom-right"]) {
      await expect(group).toHaveCSS(`border-${corner}-radius`, await group.evaluate(node => node.closest(".settings-nav-search") ? "8px" : "12px"));
    }
  }
}

for (const theme of PARITY_THEMES) for (const width of [1024, 1440]) {
  test(`Shared square search fields @ ${theme.attribute}-${width}`, async ({ page }, _info) => {
    const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" }, preflightScenario: "ready" });
    const errors: string[] = [], writes: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("request", request => { if (request.method() !== "GET") writes.push(new URL(request.url()).pathname); });
    try {
      await page.setViewportSize({ width, height: width === 1024 ? 720 : 1000 });
      await installTheme(page, theme);
      for (const section of ["keyboard", "routes", "spreadsheets"]) {
        await page.goto(`${server.baseUrl}/?settings=${section}&day=${FIXTURE_DAY}`);
        await expect(page.getByRole("searchbox", { name: "Search settings", exact: true })).toBeVisible();
        await expect(page.locator('.ds-search-field [data-slot="search-field-group"]:visible')).toHaveCount(section === 'spreadsheets' ? 1 : 2);
        if (section === 'spreadsheets') {
          await expect(page.getByRole('searchbox', { name: 'Find a spreadsheet', exact: true })).toHaveCount(0);
          await expect(page.getByRole('table', { name: 'Registered spreadsheets', exact: true })).toBeVisible();
        }
        await expectSearchCorners(page);
        await assertThemeApplied(page, theme);
        if (section === "keyboard") {
          const search = page.getByRole("searchbox", { name: "Search shortcuts", exact: true });
          await search.fill("Search runs");
          await expect(page.locator(".shortcut-reference-row")).toHaveCount(1);
          await page.getByRole("button", { name: "Clear search", exact: true }).click();
          await expect(search).toHaveValue("");
          await expect(search).toBeFocused();
          await expect(page.locator(".shortcut-reference-row")).toHaveCount(5);
        }
      }
      await page.goto(`${server.baseUrl}/?day=${FIXTURE_DAY}`);
      await page.getByRole("button", { name: "Close assistant", exact: true }).click();
      const searchButton = page.getByRole("button", { name: "Search runs", exact: true });
      await searchButton.click();
      await expectSearchCorners(page);
      const runSearch = page.locator('input[aria-label="Search runs"]');
      await runSearch.fill("no matching synthetic run");
      await expect(page.getByText("No runs match your search.", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Clear search", exact: true }).click();
      await expect(runSearch).toHaveValue("");
      await page.keyboard.press("Escape");
      await expect(searchButton).toBeFocused();
      await page.getByRole("button", { name: "Start a run", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Start a run", exact: true });
      await expect(dialog).toBeVisible();
      await expectSearchCorners(page);
      expect((await dialog.boundingBox())!.width).toBe(880);
      expect((await dialog.boundingBox())!.height).toBe(628);
      await expect(dialog.locator('[data-slot="search-field-group"]')).toHaveCSS("height", "32px");
      await page.keyboard.press("Escape");
      await page.getByRole("region", { name: "Queue", exact: true }).getByRole("button", { name: /^Morrow, Bea — review/u }).click();
      await expect(page.getByRole("searchbox", { name: "Search logs", exact: true })).toBeVisible();
      await expectSearchCorners(page);
      expect(errors).toEqual([]);
      expect(writes).toEqual([]);
    } finally { await server.close(); }
  });
}
