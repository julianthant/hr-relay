/** Speed smoke: the built bundle's size, a cold load, and what the dashboard does while nobody touches it. */
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { MOCK_DIST_DIR } from "../support/helpers/dashboard/served-fixtures/bundle.js";
import { expect, test } from "../support/helpers/dashboard/smoke/smoke-fixtures.js";

/** Bytes before compression. Raise a budget only with the reason in the same change; split the bundle instead where possible. */
const SCRIPT_BUDGET_BYTES = 2_925_000;
const STYLE_BUDGET_BYTES = 767_000;
const IDLE_STYLE_WRITE_LIMIT = 20;

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
  // Local runs measure about 0.1 s; the budget only catches an order-of-magnitude regression on a shared runner.
  await expect.poll(() => page.evaluate(() => {
    const [navigation] = performance.getEntriesByType("navigation");
    return navigation instanceof PerformanceNavigationTiming && navigation.domContentLoadedEventEnd > 0
      ? navigation.domContentLoadedEventEnd : Infinity;
  }), { message: "DOMContentLoaded in ms" }).toBeLessThan(3_000);
  await expect.poll(() => page.evaluate(() => {
    const [paint] = performance.getEntriesByName("first-contentful-paint", "paint");
    return paint?.startTime ?? Infinity;
  }), { message: "first contentful paint in ms" }).toBeLessThan(3_000);
});

test("idle style writes stay within budget", async ({ dashboard, page }) => {
  await dashboard.open();
  await expect(dashboard.queue).toBeVisible();
  const writes = await page.evaluate(async () => {
    let count = 0;
    const observer = new MutationObserver(records => { count += records.length; });
    observer.observe(document.body, { subtree: true, attributeFilter: ["style"] });
    const end = performance.now() + 2_000;
    await new Promise<void>(resolve => {
      const sample = (frameTime: number): void => {
        if (frameTime >= end) resolve();
        else requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    observer.disconnect();
    return count;
  });
  expect(writes, "inline style writes in two idle seconds").toBeLessThan(IDLE_STYLE_WRITE_LIMIT);
});
