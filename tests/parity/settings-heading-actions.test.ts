
import { expect, type Locator } from "@playwright/test";
import { test } from "./helpers/fixtures.js";
import { PARITY_DIST_DIR } from "./helpers/bundle.js";
import { installTheme, PARITY_THEMES } from "./helpers/capture.js";
import { startFixtureServer } from "../support/helpers/dashboard/fixture-bff.js";

async function assertHeadingActions(surface: Locator): Promise<void> {
  const heading = surface.locator(".ds-page-heading").first();
  const copy = (await heading.locator(".ds-page-heading-copy").boundingBox())!;
  const actions = (await heading.locator(".ds-page-heading-actions").boundingBox())!;
  const bounds = (await heading.boundingBox())!;
  expect(actions.x).toBeGreaterThan(copy.x + copy.width);
  expect(Math.abs(actions.y + actions.height / 2 - copy.y - copy.height / 2)).toBeLessThanOrEqual(2);
  expect(Math.abs(actions.x + actions.width - bounds.x - bounds.width)).toBeLessThanOrEqual(2);
  await expect(surface.locator(".diagnostic-toolbar")).toHaveCount(0);
}

for (const theme of PARITY_THEMES) for (const width of [1024, 1440]) {
  test(`Settings actions center on title-only and described headings @ ${theme.attribute} ${width}`, async ({ page }, _info) => {
    const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    try {
      await page.setViewportSize({ width, height: width === 1024 ? 720 : 1000 });
      await installTheme(page, theme);
      await page.goto(`${server.baseUrl}/?settings=spreadsheets`);
      const settings = page.getByRole("region", { name: "Settings", exact: true });
      const body = settings.locator(".settings-tab-body");
      const navigation = settings.getByRole("navigation", { name: "Settings sections", exact: true });
      for (const name of ["Spreadsheets", "Explorer"]) {
        await navigation.getByRole("link", { name, exact: true }).click();
        if (name === "Spreadsheets") {
          await expect(body.locator(".hub-sheets-library h1")).toHaveText(name);
          await expect(body.locator(".ds-page-heading-actions").getByRole("button")).toHaveText(["Import"]);
          await assertHeadingActions(body);
          await expect(body.locator(".ds-page-heading-description")).toHaveText("Reference lists your runs look people up in.");
          continue;
        }
        await expect(body.locator(".ds-page-heading-title").first()).toHaveText(name);
        await expect(body.locator(".ds-page-heading-actions").first()).toBeVisible();
        await assertHeadingActions(body);
        await expect(body.locator(".ds-page-heading-description").first()).toBeVisible();

      }
      expect(errors).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    } finally { await server.close(); }
  });
}
