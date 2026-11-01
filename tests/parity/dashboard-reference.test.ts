import { expect } from "@playwright/test";
import { test } from "./helpers/fixtures.js";
import { gotoAppState } from "./helpers/app-driver.js";
import { PARITY_THEMES, assertThemeApplied, installTheme } from "./helpers/capture.js";
import { FIXTURE_DAY } from "./helpers/fixture-identity.js";
import { FIXTURE_IDS } from "./helpers/fixture-queue.js";

import { dismissWorkflowWindow, failOnPageErrors, registerReferenceServers } from "./helpers/reference-harness.js";
import { registerReferenceScenes } from "./helpers/reference-scenes.js";
import { ANCHORS, SCENES } from "./helpers/reference-shell-scenes.js";
const servers = registerReferenceServers(["server"]);
registerReferenceScenes(SCENES, () => servers.server, ANCHORS);


// Dismiss the floating Workflow Panel before capturing the unoccluded queue.



test.describe("access variants", () => {
  test("keyboard-only skip link lands on the workspace", async ({ page }) => {
    const errors = failOnPageErrors(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await installTheme(page, PARITY_THEMES[0]);
    await gotoAppState(page, servers.server.baseUrl, { day: FIXTURE_DAY });
    await assertThemeApplied(page, PARITY_THEMES[0]);
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Skip to content", exact: true })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("#dashboard-main-region")).toBeFocused();
    expect(errors).toEqual([]);


  });

  test("reduced motion renders the resting state", async ({ page }) => {
    const errors = failOnPageErrors(page);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 1440, height: 900 });
    await installTheme(page, PARITY_THEMES[0]);
    await gotoAppState(page, servers.server.baseUrl, { day: FIXTURE_DAY });
    await assertThemeApplied(page, PARITY_THEMES[0]);
    const reducedMotion = await page.evaluate(() => {
      const styles = getComputedStyle(document.documentElement);
      return {
        matches: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
        durations: [
          "--ds-dur-1",
          "--ds-dur-2",
          "--ds-dur-3",
          "--ds-dur-4",
          "--ds-dur-enter",
          "--ds-dur-exit",
          "--ds-dur-move",
        ].map((token) => styles.getPropertyValue(token).trim()),
        travel: ["--ds-travel-sm", "--ds-travel-md"]
          .map((token) => styles.getPropertyValue(token).trim()),
        scale: styles.getPropertyValue("--ds-scale-enter").trim(),
      };
    });
    expect(reducedMotion).toEqual({
      matches: true,
      durations: ["0s", "0s", "0s", "0s", "0s", "0s", "0s"],
      travel: ["0px", "0px"],
      scale: "1",
    });
    expect(errors).toEqual([]);


  });
});



for (const theme of PARITY_THEMES) {
  test(`desktop canvas holds its side-by-side floor — ${theme.name}`, async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 720 });
    await installTheme(page, theme);
    await gotoAppState(page, servers.server.baseUrl, { day: FIXTURE_DAY, run: FIXTURE_IDS.failedRun });
    await dismissWorkflowWindow(page);
    const geometry = async () => page.evaluate(() => {
      const root = document.querySelector("[data-app-root]");
      const queue = document.querySelector('[aria-label="Queue"]');
      const detail = document.querySelector(".dashboard-log-column");
      const header = document.querySelector(".workspace-rail-header");
      if (!root || !queue || !detail || !header) throw new Error("Desktop shell is incomplete");
      const box = (element: Element) => {
        const rect = element.getBoundingClientRect();
        return { x: rect.x + scrollX, y: rect.y + scrollY, width: rect.width, height: rect.height };
      };
      return { root: box(root), queue: box(queue), detail: box(detail), header: box(header) };
    });
    const minimum = await geometry();
    expect(minimum.root.width).toBe(1024);
    expect(minimum.root.height).toBe(720);
    expect(minimum.queue.y).toBe(minimum.detail.y);
    expect(minimum.detail.x).toBeGreaterThanOrEqual(minimum.queue.x + minimum.queue.width);
    expect(minimum.detail.width).toBeGreaterThan(400);
    expect(minimum.queue.height).toBeGreaterThan(400);
    for (const viewport of [{ width: 800, height: 600 }, { width: 600, height: 400 }]) {
      await page.setViewportSize(viewport);
      await expect.poll(geometry).toEqual(minimum);
      const scroll = await page.evaluate(() => {
        window.scrollTo(document.documentElement.scrollWidth, document.documentElement.scrollHeight);
        return { x: scrollX, y: scrollY };
      });
      expect(scroll.x).toBeGreaterThan(0);
      expect(scroll.y).toBeGreaterThan(0);
      await expect.poll(geometry).toEqual(minimum);
      await page.evaluate(() => window.scrollTo(0, 0));
    }
    await page.setViewportSize({ width: 1280, height: 720 });
    await expect.poll(async () => (await geometry()).detail.width).toBeGreaterThan(minimum.detail.width);
  });
}
