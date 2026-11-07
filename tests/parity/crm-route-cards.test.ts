import { expect } from "@playwright/test";
import { test } from "./helpers/fixtures.js";
import { PARITY_DIST_DIR } from "./helpers/bundle.js";
import { assertThemeApplied, installTheme, PARITY_THEMES } from "./helpers/capture.js";
import { startFixtureServer } from "../support/helpers/dashboard/fixture-bff.js";

const expectedFields = [
  ["Entry (required)", "https://crm.ucsd.edu/hr"],
  ["Onboarding search (required)", "https://act-crm.my.site.com/hr/ONB_SearchOnboardings"],
  ["UCPath entry sheet (required)", "https://act-crm.my.site.com/hr/ONB_PPSEntrySheet"],
  ["Onboarding history (required)", "https://act-crm.my.site.com/hr/ONB_ShowOnboardingHistory"],
  ["iDocs viewer (required)", "https://act-idocs.ucsd.edu"],
] as const;

for (const theme of PARITY_THEMES) for (const width of [1024, 1440]) {
  test(`CRM has five grouped URL fields @ ${theme.attribute}-${width}`, async ({ page }) => {
    const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
    const errors: string[] = [], writes: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("request", request => { if (request.method() !== "GET") writes.push(new URL(request.url()).pathname); });
    try {
      await page.setViewportSize({ width, height: width === 1024 ? 720 : 1000 });
      await installTheme(page, theme);
      await page.goto(`${server.baseUrl}/?settings=routes`);
      const crm = page.getByRole("group", { name: "CRM", exact: true });
      await expect(page.getByRole("heading", { name: "CRM 5 URLs", exact: true })).toBeVisible();
      await expect(crm.getByRole("button")).toHaveCount(0);
      const fields = crm.locator(".routes-page-field");
      await expect(fields).toHaveCount(5);
      await expect(crm.locator('input[type="url"]')).toHaveCount(5);
      for (const [label, value] of expectedFields) {
        const input = crm.getByRole("textbox", { name: label, exact: true });
        await expect(input).toHaveAttribute("required", "");
        await expect(input).toHaveValue(value);
      }
      const kuali = page.getByRole("group", { name: "Kuali", exact: true });
      const appearance = (node: Element) => {
        const style = getComputedStyle(node);
        return { radius: style.borderRadius, background: style.backgroundColor, border: style.borderTopColor, borderWidth: style.borderTopWidth };
      };
      expect(await crm.evaluate(appearance)).toEqual(await kuali.evaluate(appearance));
      const boxes = [];
      for (const field of await fields.all()) {
        await expect(field.getByRole("textbox")).toHaveCount(1);
        const box = (await field.boundingBox())!, input = (await field.getByRole("textbox").boundingBox())!;
        expect(input.x).toBeGreaterThanOrEqual(box.x);
        expect(input.x + input.width).toBeLessThanOrEqual(box.x + box.width);
        boxes.push({ field: box, input });
      }
      for (let index = 1; index < boxes.length; index++) {
        expect(boxes[index].field.y).toBeGreaterThanOrEqual(boxes[index - 1].field.y + boxes[index - 1].field.height);
        expect(boxes[index].field.x).toBe(boxes[0].field.x);
        expect(boxes[index].field.width).toBe(boxes[0].field.width);
        expect(boxes[index].input.x).toBe(boxes[0].input.x);
        expect(boxes[index].input.width).toBe(boxes[0].input.width);
      }
      const inputs = crm.getByRole("textbox");
      await inputs.first().focus(); await page.keyboard.press("Tab");
      await expect(inputs.nth(1)).toBeFocused();
      await assertThemeApplied(page, theme);
      const search = page.getByRole("searchbox", { name: "Find a system or route", exact: true });
      await search.fill("onboarding history");
      await expect(fields).toHaveCount(5);
      await expect(page.locator(".routes-page-system")).toHaveCount(1);
      await expect(kuali).toHaveCount(0);
      await search.fill("no matching system");
      await expect(crm).toHaveCount(0);
      await expect(page.getByText("No routes match “no matching system”.", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Clear search", exact: true }).click();
      await expect(search).toBeFocused(); await expect(fields).toHaveCount(5);
      await expect(kuali).toBeVisible();
      await expect(kuali.locator('input[type="url"]')).toHaveCount(1);
      await expect(page.locator('[data-settings-path="urls.kuali.prod"] input')).toBeVisible();
      await expect(page.getByRole("group", { name: "SharePoint", exact: true })).toBeVisible();
      await expect(page.getByLabel("SharePoint onboarding roster URL", { exact: true })).toHaveAttribute("type", "password");
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      expect(errors).toEqual([]); expect(writes).toEqual([]);
    } finally { await server.close(); }
  });
}
