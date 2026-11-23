/** Analytics smoke: focus after navigation draws no ring, and frames of the drilldown and of a run that cannot load. */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DESKTOP_VIEWPORTS } from "../support/helpers/dashboard/smoke/dashboard-page.js";
import { expect, SEEDED_PREFERENCE_WRITE, test } from "../support/helpers/dashboard/smoke/smoke-fixtures.js";

const FRAMES = join(import.meta.dirname, ".output/analytics-frames");

for (const viewport of DESKTOP_VIEWPORTS) {
  test.describe(`analytics at ${String(viewport.width)}x${String(viewport.height)}`, () => {
    test.use({ viewport });

    test("the page takes focus on navigation with no ring on Analytics or Spreadsheets", async ({ dashboard, failures, page }) => {
      failures.allow(SEEDED_PREFERENCE_WRITE, "the seeded backend cannot save the chosen workflow");
      await dashboard.open();
      for (const label of ["Analytics", "Spreadsheets"]) {
        await dashboard.openDataPage(label);
        await page.keyboard.press("Shift+Tab");
        await page.keyboard.press("Tab");
        await page.evaluate(() => document.getElementById("dashboard-settings-content")?.focus());
        const ring = await page.evaluate(() => {
          const style = getComputedStyle(document.activeElement ?? document.body);
          return { id: document.activeElement?.id, style: style.outlineStyle, width: style.outlineWidth };
        });
        expect(ring.id, `${label} focus target`).toBe("dashboard-settings-content");
        expect(ring.style === "none" || ring.width === "0px", `${label} draws no focus ring`).toBe(true);
        await expect(dashboard.pageHeading(label)).toBeVisible();
        expect(await dashboard.pageHeading(label).evaluate(el => getComputedStyle(el).outlineStyle)).toBe("none");
      }
    });

    test("frames: the drilldown and a run that cannot load", async ({ dashboard, failures, page }) => {
      failures.allow(SEEDED_PREFERENCE_WRITE, "the seeded backend cannot save the chosen workflow");
      failures.allow(/^http 500: GET .*\/reports\/activity\/population\/selected/, "the run detail read is refused to show the failure frame");
      failures.allow(/^console: Failed to load resource/, "the refused run detail read");
      mkdirSync(FRAMES, { recursive: true });
      await dashboard.open();
      await dashboard.openDataPage("Analytics");
      await page.getByRole("button", { name: /^Show .* details$/ }).first().click();
      await page.getByRole("button", { name: "Open runs" }).first().click();
      const list = page.getByRole("region", { name: "Analytics runs" });
      await expect(list.getByRole("table")).toBeVisible();
      await page.screenshot({ path: join(FRAMES, `drilldown-${String(viewport.width)}.png`), animations: "disabled" });
      await page.route("**/reports/activity/population/selected*", route => {
        if (decodeURIComponent(route.request().url()).includes('"run"')) return route.fulfill({ status: 500, contentType: "application/json", body: "{}" });
        return route.continue();
      });
      await list.getByRole("link", { name: /^Open logs for/ }).first().click();
      await expect(list.getByRole("alert")).toBeVisible();
      expect(await list.getByRole("alert").count()).toBe(1);
      await expect(list.getByRole("button", { name: "Retry" })).toBeVisible();
      expect(await page.getByText(/could not load/i).count(), "the failure sentence appears once").toBe(1);
      await page.screenshot({ path: join(FRAMES, `run-unavailable-${String(viewport.width)}.png`), animations: "disabled" });
    });
  });
}
