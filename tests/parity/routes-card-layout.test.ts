
import { expect } from "@playwright/test";
import { test } from "./helpers/fixtures.js";
import { PARITY_DIST_DIR } from "./helpers/bundle.js";
import { assertThemeApplied, installTheme, PARITY_THEMES } from "./helpers/capture.js";
import { startFixtureServer } from "../support/helpers/dashboard/fixture-bff.js";

for (const theme of PARITY_THEMES) for (const width of [1024, 1440]) {
  test(`Routes keeps each system in one expanded card @ ${theme.attribute}-${width}`, async ({ page }, _info) => {
    const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
    const errors: string[] = [], writes: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("request", request => { if (request.method() !== "GET") writes.push(new URL(request.url()).pathname); });
    try {
      await page.setViewportSize({ width, height: width === 1024 ? 720 : 1000 });
      await installTheme(page, theme);
      await page.goto(`${server.baseUrl}/?settings=routes`);
      const routes = page.locator(".routes-page");
      const systems = routes.locator(".routes-page-system");
      await expect(systems).toHaveCount(9);
      await expect(routes.locator(".ds-disclosure, button[aria-expanded]")).toHaveCount(0);
      await expect(routes.locator('.routes-page-field input[type="url"]')).toHaveCount(18);
      const crm = routes.getByRole("group", { name: "CRM", exact: true });
      await expect(crm.locator("input")).toHaveCount(5);
      for (const system of await systems.all()) {
        await expect(system.locator(".ds-form-group")).toHaveCount(1);
        await expect(system.locator(".ds-form-group .ds-form-group")).toHaveCount(0);
        for (const input of await system.locator("input").all()) await expect(input).toBeVisible();
      }
      const rows = crm.locator(".routes-page-field");
      const cardBox = (await crm.boundingBox())!;
      let priorBottom = cardBox.y;
      let controlX: number | undefined;
      for (const row of await rows.all()) {
        const rowBox = (await row.boundingBox())!;
        const copy = (await row.locator(".ds-field-copy").boundingBox())!;
        const input = row.locator("input");
        const inputBox = (await input.boundingBox())!;
        expect(rowBox.y - priorBottom).toBeLessThanOrEqual(1);
        expect(copy.x + copy.width).toBeLessThan(inputBox.x);
        expect(Math.abs(copy.y + copy.height / 2 - inputBox.y - inputBox.height / 2)).toBeLessThanOrEqual(1);
        expect(inputBox.x + inputBox.width).toBeLessThan(cardBox.x + cardBox.width);
        if (controlX !== undefined) expect(inputBox.x).toBe(controlX);
        controlX = inputBox.x;
        priorBottom = rowBox.y + rowBox.height;
        await row.locator("label").click();
        await expect(input).toBeFocused();
      }
      await assertThemeApplied(page, theme);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      await crm.scrollIntoViewIfNeeded();

      const search = routes.locator(".routes-page-search input");
      await search.fill("Kuali");
      await expect(systems).toHaveCount(1);
      await expect(routes.getByRole("group", { name: "Kuali", exact: true }).locator("input")).toBeVisible();
      await search.fill("roster");
      await expect(systems).toHaveCount(1);
      const sharepoint = routes.getByRole("group", { name: "SharePoint", exact: true });
      await expect(sharepoint.getByLabel("SharePoint onboarding roster URL", { exact: true })).toBeVisible();
      await search.fill("no-matching-system");
      await expect(systems).toHaveCount(0);
      await expect(routes).toContainText("No routes match “no-matching-system”.");
      await routes.getByRole("button", { name: "Clear search", exact: true }).click();
      await expect(systems).toHaveCount(9);
      expect(errors).toEqual([]);
      expect(writes).toEqual([]);
    } finally { await server.close(); }
  });
}
