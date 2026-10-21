
import { expect, test } from "@playwright/test";
import { ensureParityBundle, PARITY_DIST_DIR } from "./helpers/bundle.js";
import { assertThemeApplied, installTheme, PARITY_THEMES } from "./helpers/capture.js";
import { startFixtureServer } from "../support/helpers/dashboard/fixture-bff.js";

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
        if (section === "spreadsheets") {
          const library = page.locator(".hub-sheets-library");
          const title = (await library.getByRole("heading", { name: "Spreadsheets", exact: true }).boundingBox())!;
          const intro = (await library.locator(".hub-sheets-intro").boundingBox())!;
          expect(intro.y - title.y - title.height).toBe(4);
          await expect(library.locator(".hub-sheets-intro")).toHaveCSS("margin-bottom", "30px");
          await expect(library.getByRole("heading", { level: 2 })).toHaveText(["Spreadsheet types", "Kronos reports"]);
          continue;
        }
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
            expect(content.y - copy.y - copy.height, `${section}: description/content gap`).toBe(await heading.evaluate(node => node.parentElement?.classList.contains("settings-compact-page") ? 30 : 16));
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
          expect(copyBox.y - title.y - title.height).toBe(10);
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
