/** D340: desktop control density and hit ownership, measured in the built browser. */
import { expect, test, type Page } from "@playwright/test";
import { gotoAppState } from "./helpers/app-driver.js";
import { PARITY_DIST_DIR, ensureParityBundle } from "./helpers/bundle.js";
import { startFixtureServer, type FixtureServer } from "./helpers/fixture-bff.js";
import { FIXTURE_DAY } from "./helpers/fixture-day.js";
const COMPACT_PAINT = 24;
const VIEWPORT = { width: 1024, height: 768 } as const;

let server: FixtureServer;

test.beforeAll(async () => {
  ensureParityBundle();
  server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
});

test.afterAll(async () => {
  await server.close();
});

async function assertDesktopPointer(page: Page): Promise<void> {
  expect(await page.evaluate(() => matchMedia("(pointer: fine)").matches)).toBe(true);
}

async function openSearch(page: Page): Promise<void> {
  await gotoAppState(page, server.baseUrl, { day: FIXTURE_DAY });
  await page.getByRole("button", { name: "Search runs across dates" }).click();
  await expect(page.getByRole("group", { name: "Search scope" })).toBeVisible();
}

test.describe("desktop Top Bar scope controls", () => {
  test.use({ viewport: VIEWPORT });

  test("preserves the compact mouse density", async ({ page }) => {
    await openSearch(page);
    await assertDesktopPointer(page);
    const buttons = page.getByRole("group", { name: "Search scope" }).getByRole("button");
    await expect(buttons).toHaveCount(2);
    for (let index = 0; index < 2; index += 1) {
      const box = await buttons.nth(index).boundingBox();
      if (box === null) throw new Error(`scope button ${String(index)} was not laid out`);
      expect(box.height).toBe(COMPACT_PAINT);
    }
  });
});
