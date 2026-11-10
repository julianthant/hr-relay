
import { expect, type Locator } from "@playwright/test";
import { test } from "./helpers/fixtures.js";
import { PARITY_DIST_DIR } from "./helpers/bundle.js";
import { assertThemeApplied, installTheme, PARITY_THEMES } from "./helpers/capture.js";
import { startFixtureServer } from "../support/helpers/dashboard/fixture-bff.js";
import { attachShellA11y } from "./helpers/shell-proof.js";

async function markerError(tabs: Locator): Promise<number> {
  return tabs.evaluate(node => {
    const tab = node.querySelector('[role="tab"][aria-selected="true"]')!, marker = node.querySelector(".ds-tab-indicator")!;
    const active = tab.getBoundingClientRect(), indicator = marker.getBoundingClientRect();
    return Math.max(Math.abs(active.x - indicator.x), Math.abs(active.width - indicator.width));
  });
}

for (const theme of PARITY_THEMES) for (const width of [1024, 1440]) {
  const evidence = `dashboard-controls-${theme.attribute}-${width}.a11y.yml`;
  test(`Shared tabs, spreadsheet controls and Activity dates remain uniform @ ${theme.attribute}-${width}`, { annotation: [{ type: "required-a11y-evidence", description: evidence }] }, async ({ page }, info) => {
    const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
    const errors: string[] = [], writes: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("request", request => { if (request.method() !== "GET") writes.push(new URL(request.url()).pathname); });
    try {
      await page.setViewportSize({ width, height: 900 });
      await page.clock.setFixedTime(new Date("2026-09-26T12:00:00Z"));
      await installTheme(page, theme);
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await page.goto(`${server.baseUrl}/kit.html`);
      const tabs = page.getByRole("tablist", { name: "Run detail", exact: true });
      const first = tabs.getByRole("tab").first(), second = tabs.getByRole("tab").nth(1);
      const marker = tabs.locator(".ds-tab-indicator");
      await expect.poll(() => markerError(tabs)).toBeLessThanOrEqual(1);
      const listBounds = (await tabs.boundingBox())!, firstBounds = (await first.boundingBox())!;
      expect(firstBounds.x).toBeCloseTo(listBounds.x, 0);
      await second.click();
      await expect(second).toHaveAttribute("aria-selected", "true");
      await expect(marker).toHaveCSS("transition-property", "transform");
      await expect(marker).toHaveCSS("transition-duration", "0.22s");
      await expect.poll(() => markerError(tabs)).toBeLessThanOrEqual(1);
      await first.click(); await second.click(); await first.click();
      await expect(first).toHaveAttribute("aria-selected", "true");
      await expect.poll(() => markerError(tabs)).toBeLessThanOrEqual(1);
      await first.focus(); await page.keyboard.press("ArrowRight");
      await expect(second).toBeFocused(); await expect(second).toHaveAttribute("aria-selected", "true");
      await expect(marker).toHaveCSS("transition-duration", "0s");
      await expect.poll(() => markerError(tabs)).toBeLessThanOrEqual(1);
      await page.emulateMedia({ reducedMotion: "reduce" });
      await first.click();
      await expect(marker).toHaveCSS("transition-duration", "0s");
      await expect.poll(() => markerError(tabs)).toBeLessThanOrEqual(1);


      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await assertThemeApplied(page, theme);
      await attachShellA11y(page, info, evidence);
      expect(errors).toEqual([]); expect(writes).toEqual([]);
    } finally { await server.close(); }
  });
}
