/** Speed smoke: the built bundle's size, a cold load, and what the dashboard does while nobody touches it. */
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { MOCK_DIST_DIR } from "../support/helpers/dashboard/served-fixtures/bundle.js";
import { expect, test } from "../support/helpers/dashboard/smoke/smoke-fixtures.js";

/** Bytes before compression. Raise a budget only with the reason in the same change; split the bundle instead where possible. */
const SCRIPT_BUDGET_BYTES = 2_950_000;
const STYLE_BUDGET_BYTES = 770_000;

function assetBytes(extension: string, exclude: RegExp): number {
  const assets = join(MOCK_DIST_DIR, "assets");
  return readdirSync(assets).filter(name => name.endsWith(extension) && !exclude.test(name))
    .reduce((total, name) => total + statSync(join(assets, name)).size, 0);
}

test("the dashboard's scripts and styles stay inside their size budgets", () => {
  // The spreadsheet import worker loads on demand and the kit page is a separate entry.
  expect(assetBytes(".js", /worker|^kit-/u), "script bytes loaded by the dashboard").toBeLessThanOrEqual(SCRIPT_BUDGET_BYTES);
  expect(assetBytes(".css", /^kit-/u), "stylesheet bytes loaded by the dashboard").toBeLessThanOrEqual(STYLE_BUDGET_BYTES);
});

test("a cold load reaches the queue quickly", async ({ dashboard, page }) => {
  await dashboard.open();
  await expect(dashboard.queue).toBeVisible();
  const timing = await page.evaluate(() => {
    const [navigation] = performance.getEntriesByType("navigation") as PerformanceNavigationTiming[];
    const paint = performance.getEntriesByName("first-contentful-paint")[0];
    return { domContentLoaded: navigation?.domContentLoadedEventEnd ?? Number.NaN, firstContentfulPaint: paint?.startTime ?? Number.NaN };
  });
  // Local runs measure about 0.1 s; the budget only catches an order-of-magnitude regression on a shared runner.
  expect(timing.domContentLoaded, "DOMContentLoaded in ms").toBeLessThan(3_000);
  expect(timing.firstContentfulPaint, "first contentful paint in ms").toBeLessThan(3_000);
});

test("an idle dashboard does not write styles every frame", async ({ dashboard, page }) => {
  test.fail(true, "The Ask mark's idle orbit rewrites an inline transform on every animation frame.");
  await dashboard.open();
  await expect(dashboard.queue).toBeVisible();
  const styleWrites = await page.evaluate(async () => {
    let writes = 0;
    const observer = new MutationObserver(records => { writes += records.length; });
    observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ["style"] });
    await new Promise(resolve => setTimeout(resolve, 2_000));
    observer.disconnect();
    return writes;
  });
  expect(styleWrites, "inline style writes in two idle seconds").toBeLessThan(20);
});
