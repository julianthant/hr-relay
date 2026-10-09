
import { expect, test } from "@playwright/test";
import { ensureParityBundle, PARITY_DIST_DIR } from "./helpers/bundle.js";
import { assertThemeApplied, installTheme, PARITY_THEMES } from "./helpers/capture.js";
import { startFixtureServer } from "./helpers/fixture-bff.js";

const sections = ["general", "performance", "paths", "routes", "credentials", "spreadsheets", "explorer", "activity", "storage", "preflight", "keyboard"];

for (const theme of PARITY_THEMES) for (const width of [1024, 1440]) {
  test(`Dashboard headings group their descriptions before content @ ${theme.attribute}-${width}`, async ({ page }, _info) => {
    ensureParityBundle();
    const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" }, preflightScenario: "ready" });
    const errors: string[] = [], writes: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("request", request => { if (request.method() !== "GET") writes.push(new URL(request.url()).pathname); });
    try {
      await page.setViewportSize({ width, height: width === 1024 ? 720 : 1000 });
      await installTheme(page, theme);
      for (const section of sections) {
        await page.goto(`${server.baseUrl}/?settings=${section}`);
        const heading = page.locator(".ds-page-heading").first();
        await expect(heading.locator(".ds-page-heading-title")).toBeVisible();
        await expect(page.locator("[data-settings-loading]")).toHaveCount(0);
        const description = heading.locator(".ds-page-heading-description");
        if (await description.count()) {
          const title = (await heading.locator(".ds-page-heading-title").boundingBox())!;
          const copy = (await description.boundingBox())!;
          expect(copy.y - title.y - title.height, `${section}: title/description gap`).toBe(4);
          const next = heading.locator("xpath=following-sibling::*[1]");
          if (await next.count()) {
            const content = (await next.boundingBox())!;
            expect(content.y - copy.y - copy.height, `${section}: description/content gap`).toBe(16);
          }
          if (await heading.locator(".ds-page-heading-actions").count()) {
            const actions = (await heading.locator(".ds-page-heading-actions").boundingBox())!;
            const headerBox = (await heading.boundingBox())!;
            expect(Math.abs(actions.y + actions.height / 2 - headerBox.y - headerBox.height / 2), `${section}: heading action alignment`).toBeLessThanOrEqual(1);
          }
        }
        for (const copy of await page.locator(".ds-body-section-description").all()) {
          const title = (await copy.locator("xpath=preceding-sibling::*[1]").boundingBox())!;
          const copyBox = (await copy.boundingBox())!;
          const group = (await copy.locator("xpath=following-sibling::*[1]").boundingBox())!;
          expect(copyBox.y - title.y - title.height).toBe(4);
          expect(group.y - copyBox.y - copyBox.height).toBe(12);
        }
        if (section === "preflight") {
          const title = page.getByRole("heading", { name: "Workflow readiness", exact: true });
          await expect(title).toBeVisible();
          const operations = page.locator(".workflow-operations-heading");
          const titleBox = (await title.boundingBox())!;
          const operationsBox = (await operations.boundingBox())!;
          expect(operationsBox.y - titleBox.y - titleBox.height).toBeCloseTo(4, 1);
          const firstCard = (await page.locator(".workflow-operations-card").first().boundingBox())!;
          expect(firstCard.y - operationsBox.y - operationsBox.height).toBe(12);
          await title.scrollIntoViewIfNeeded();

        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
        await assertThemeApplied(page, theme);
      }
      expect(errors).toEqual([]);
      expect(writes).toEqual([]);
    } finally { await server.close(); }
  });
}
