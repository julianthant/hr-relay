import { expect,test } from "@playwright/test";
import { gotoAppState } from "./helpers/app-driver.js";
import { PARITY_DIST_DIR,ensureParityBundle } from "./helpers/bundle.js";
import { startFixtureServer,type FixtureServer } from "./helpers/fixture-bff.js";
import { FIXTURE_DAY } from "./helpers/fixture-identity.js";
import { BACKFILL_GAP_DAY_WIRE } from "./helpers/fixture-queue.js";

let server: FixtureServer;

test.beforeAll(async () => {
  ensureParityBundle();
  server = await startFixtureServer({
    distDir: PARITY_DIST_DIR,
    bundle: { proof: "working-tree" },
    dayWire: BACKFILL_GAP_DAY_WIRE,
  });
});

test.afterAll(async () => {
  await server.close();
});

test.use({ viewport: { width: 1024, height: 768 } });

test("six pinned refusals and ordinary rows remain reachable on a narrow desktop", async ({ page }) => {
  await page.route("**/api/v1/notifications/status", route => route.fulfill({ json: { state: "ready", pending: 0 } }));
  await gotoAppState(page, server.baseUrl, { day: FIXTURE_DAY });
  const bell = page.getByRole("button", { name: /Notifications/u });
  const bellBox = await bell.boundingBox();
  expect(bellBox).not.toBeNull();
  expect(bellBox?.width).toBeGreaterThan(0);
  expect(bellBox?.height).toBeGreaterThan(0);

  await bell.focus();
  await page.keyboard.press("Enter");
  const drawer = page.getByRole("dialog", { name: "Notifications" });
  await expect(drawer).toBeVisible();
  await page.waitForTimeout(350);
  await expect(drawer.locator("[data-backfill-gap='pinned']")).toHaveCount(6);
  await expect(drawer.getByRole("alert")).toHaveCount(6);

  const filters = drawer.locator("[data-notification-filters]");
  const filtersBefore = await filters.boundingBox();
  expect(filtersBefore).not.toBeNull();
  const scroll = drawer.locator("[data-notification-scroll]");
  expect(await scroll.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);

  await drawer.getByRole("button", { name: "Pings 7" }).click();
  await expect(drawer.locator("[data-backfill-gap='pinned']")).toHaveCount(6);
  await expect(drawer.getByText("Nothing under this filter")).toHaveCount(0);

  const lastPinned = drawer.locator("[data-backfill-gap='pinned']").last();
  await lastPinned.scrollIntoViewIfNeeded();
  await expect(lastPinned).toBeVisible();
  expect(await filters.boundingBox()).toEqual(filtersBefore);

  await drawer.getByRole("button", { name: "All 8" }).click();
  const ordinary = drawer.getByText("A write to UCPath is parked pending proof");
  await ordinary.scrollIntoViewIfNeeded();
  await expect(ordinary).toBeVisible();
  expect(await filters.boundingBox()).toEqual(filtersBefore);

  const geometry = await page.evaluate(() => {
    const scrollElement = document.querySelector<HTMLElement>("[data-notification-scroll]");
    if (scrollElement === null) throw new Error("notification scroll region is missing");
    return {
      viewportOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      drawerOverflow: scrollElement.scrollWidth - scrollElement.clientWidth,
    };
  });
  expect(geometry).toEqual({ viewportOverflow: 0, drawerOverflow: 0 });
});
