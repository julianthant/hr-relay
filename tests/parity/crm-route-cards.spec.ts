import { expect, test } from "@playwright/test";
import { ensureParityBundle, PARITY_DIST_DIR } from "./helpers/bundle.js";
import { assertThemeApplied, installTheme, PARITY_THEMES } from "./helpers/capture.js";
import { startFixtureServer } from "./helpers/fixture-bff.js";

for (const theme of PARITY_THEMES) for (const width of [1024, 1440]) {
  test(`CRM has five separate URL cards @ ${theme.attribute}-${width}`, async ({ page }, info) => {
    ensureParityBundle();
    const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
    const errors: string[] = [], writes: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("request", request => { if (request.method() !== "GET") writes.push(new URL(request.url()).pathname); });
    try {
      await page.setViewportSize({ width, height: width === 1024 ? 720 : 1000 });
      await installTheme(page, theme);
      await page.goto(`${server.baseUrl}/?settings=routes`);
      const crm = page.locator(".routes-page-crm");
      await expect(crm.getByRole("heading", { name: "CRM 5 URLs", exact: true })).toBeVisible();
      await expect(crm.getByRole("button")).toHaveCount(0);
      const cards = crm.locator(".routes-page-url-card");
      await expect(cards).toHaveCount(5);
      await expect(crm.locator('input[type="url"]')).toHaveCount(5);
      const standardCard = page.getByRole("group", { name: "Kuali", exact: true });
      const standardStyle = await standardCard.evaluate(node => {
        const style = getComputedStyle(node);
        return { radius: style.borderRadius, background: style.backgroundColor, border: style.borderTopColor };
      });
      const boxes = [];
      for (const card of await cards.all()) {
        await expect(card.getByRole("textbox")).toHaveCount(1);
        await expect(card.getByRole("textbox")).toHaveAttribute("required", "");
        await expect(card).toHaveCSS("border-top-width", "1px");
        expect(await card.evaluate(node => {
          const style = getComputedStyle(node);
          return { radius: style.borderRadius, background: style.backgroundColor, border: style.borderTopColor };
        })).toEqual(standardStyle);
        expect(await card.evaluate(node => node.parentElement?.closest(".ds-form-group") === null)).toBe(true);
        const box = (await card.boundingBox())!;
        const input = (await card.getByRole("textbox").boundingBox())!;
        expect(input.x + input.width).toBeLessThan(box.x + box.width);
        expect(box.height).toBeLessThanOrEqual(80);
        boxes.push(box);
      }
      for (let index = 1; index < boxes.length; index++) {
        const previous = boxes[index - 1];
        const gap = boxes[index].y - previous.y - previous.height;
        expect(gap).toBeGreaterThanOrEqual(6);
        expect(gap).toBeLessThanOrEqual(10);
        expect(boxes[index].x).toBe(boxes[0].x);
        expect(boxes[index].width).toBe(boxes[0].width);
      }
      const inputs = crm.getByRole("textbox");
      await inputs.first().focus();
      await page.keyboard.press("Tab");
      await expect(inputs.nth(1)).toBeFocused();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      await assertThemeApplied(page, theme);
      await info.attach(`crm-cards-${theme.attribute}-${width}.png`, { body: await page.screenshot(), contentType: "image/png" });

      const search = page.getByRole("searchbox", { name: "Find a system or route", exact: true });
      await search.fill("onboarding history");
      await expect(cards).toHaveCount(5);
      await expect(page.locator(".routes-page-system")).toHaveCount(0);
      await search.fill("no matching system");
      await expect(crm).toHaveCount(0);
      await expect(page.getByText("No routes match “no matching system”.", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Clear search", exact: true }).click();
      await expect(search).toBeFocused();
      await expect(cards).toHaveCount(5);
      const kuali = page.getByRole("button", { name: "Kuali Forms and workflows 1 URL", exact: true });
      await kuali.click();
      await expect(kuali).toHaveAttribute("aria-expanded", "true");
      await expect(page.locator('[data-settings-path="urls.kuali.prod"] input')).toBeVisible();
      const sharepoint = page.getByRole("button", { name: "SharePoint Shared files and rosters 2 URLs", exact: true });
      await sharepoint.click();
      await expect(kuali).toHaveAttribute("aria-expanded", "false");
      await expect(page.getByLabel("SharePoint onboarding roster URL", { exact: true })).toHaveAttribute("type", "password");
      await expect(cards).toHaveCount(5);
      expect(errors).toEqual([]);
      expect(writes).toEqual([]);
    } finally { await server.close(); }
  });
}
