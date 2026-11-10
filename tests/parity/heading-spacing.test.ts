
import { expect } from "@playwright/test";
import { test } from "./helpers/fixtures.js";
import { PARITY_DIST_DIR } from "./helpers/bundle.js";
import { assertThemeApplied, installTheme, PARITY_THEMES } from "./helpers/capture.js";
import { startFixtureServer } from "../support/helpers/dashboard/fixture-bff.js";

const sections = ["general", "account", "spreadsheets", "explorer", "analytics", "keyboard"];

for (const theme of PARITY_THEMES) for (const width of [1024, 1440]) {
  test(`Dashboard headings group their descriptions before content @ ${theme.attribute}-${width}`, async ({ page }, _info) => {
    const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
    const errors: string[] = [], writes: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("request", request => { if (request.method() !== "GET") writes.push(new URL(request.url()).pathname); });
    try {
      await page.setViewportSize({ width, height: width === 1024 ? 720 : 1000 });
      await installTheme(page, theme);
      for (const section of sections) {
        await page.goto(`${server.baseUrl}/?${section === "analytics" ? "activity=" : `settings=${section}`}`);
        const heading = page.locator(".ds-page-heading").first();
        await expect(page.locator("[data-settings-loading]")).toHaveCount(0);
        await expect(heading.locator(".ds-page-heading-title"), `${section}: page heading`).toBeVisible();
        const description = heading.locator(".ds-page-heading-description");
        if (await description.count()) {
          await expect(description).toBeVisible();
          await expect(async () => {
            const title = (await heading.locator(".ds-page-heading-title").boundingBox())!;
            const copy = (await description.boundingBox())!;
            expect(title, `${section}: loaded title`).not.toBeNull();
            expect(copy, `${section}: loaded description`).not.toBeNull();
            // The Spreadsheets heading sits in a flex column that adds 4px between title and description.
            const gap = await heading.evaluate(node => node.parentElement?.classList.contains("hub-sheets-library") ? 8 : 4);
            expect(copy.y - title.y - title.height, `${section}: title/description gap`).toBe(gap);
            const next = heading.locator("xpath=following-sibling::*[1]");
            if (await next.count()) {
              const content = (await next.boundingBox())!;
              expect(content.y - copy.y - copy.height, `${section}: description/content gap`).toBe(await heading.evaluate(node => node.parentElement?.classList.contains("settings-compact-page") && !node.parentElement.classList.contains("hub-sheets-library") ? 30 : 24));
            }
            if (await heading.locator(".ds-page-heading-actions").count()) {
              const actions = (await heading.locator(".ds-page-heading-actions").boundingBox())!;
              const headerBox = (await heading.boundingBox())!;
              expect(Math.abs(actions.y + actions.height / 2 - headerBox.y - headerBox.height / 2), `${section}: heading action alignment`).toBeLessThanOrEqual(1);
            }
          }).toPass({ timeout: 5000 });
        }
        for (const copy of await page.locator(".ds-body-section-description").all()) {
          const title = (await copy.locator("xpath=preceding-sibling::*[1]").boundingBox())!;
          const copyBox = (await copy.boundingBox())!;
          const group = (await copy.locator("xpath=following-sibling::*[1]").boundingBox())!;
          expect(copyBox.y - title.y - title.height).toBe(4);
          expect(group.y - copyBox.y - copyBox.height).toBe(16);
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
        await assertThemeApplied(page, theme);
      }
      expect(errors).toEqual([]);
      expect(writes).toEqual([]);
    } finally { await server.close(); }
  });
}
