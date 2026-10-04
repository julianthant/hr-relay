import { expect, test } from "@playwright/test";
import { ensureParityBundle, PARITY_DIST_DIR } from "./helpers/bundle.js";
import { installTheme, PARITY_THEMES } from "./helpers/capture.js";
import { startFixtureServer } from "./helpers/fixture-bff.js";
import { FIXTURE_DAY } from "./helpers/fixture-identity.js";
import { FIXTURE_IDS } from "./helpers/fixture-queue.js";
import { chooseSelect } from "./helpers/select-choice.js";

for (const theme of PARITY_THEMES) for (const width of [1024, 1440]) {
  test(`permanent rail with Action panel and separate log containers @ ${theme.attribute}-${width}`, async ({ page }, info) => {
    ensureParityBundle();
    const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
    try {
      await page.setViewportSize({ width, height: width === 1024 ? 720 : 1000 });
      await installTheme(page, theme);
      const writes: string[] = [], errors: string[] = [];
      page.on("request", request => { if (request.method() !== "GET") writes.push(request.url()); });
      page.on("pageerror", error => errors.push(error.message));
      await page.goto(`${server.baseUrl}/?day=${FIXTURE_DAY}`);
      const rail = page.getByRole("navigation", { name: "Workflows", exact: true });
      await expect(rail).toBeVisible();
      const railBounds = (await rail.boundingBox())!;
      expect(railBounds.x).toBe(0); expect(railBounds.y).toBe(0); expect(railBounds.width).toBe(288);
      await expect(rail.getByRole("button")).toHaveCount(15);
      const bar = page.getByRole("banner");
      expect((await bar.boundingBox())!.x).toBe(288);
      expect((await bar.boundingBox())!.height).toBe(48);
      await expect(bar.getByRole("group", { name: "Navigation history" })).toBeVisible();
      await expect(bar.getByRole("button", { name: /^Choose date/u })).toHaveCount(0);
      await expect(page.getByRole("button", { name: /Workflow Panel|Float|Minimise/iu })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Start a run", exact: true })).toBeVisible();
      const queue = page.getByRole("region", { name: "Action panel", exact: true }), logs = page.locator(".dashboard-log-column");
      const queueBounds = (await queue.boundingBox())!, logBounds = (await logs.boundingBox())!;
      expect(queueBounds.x).toBe(300); expect(queueBounds.y).toBe(60); expect(logBounds.y).toBe(60);
      expect(queueBounds.width).toBeGreaterThanOrEqual(260);
      expect(logBounds.x).toBeCloseTo(queueBounds.x + queueBounds.width + 12);
      expect(logBounds.x + logBounds.width).toBe(width - 12);
      const dateBar = logs.getByRole("group", { name: "Log date controls", exact: true });
      const dateBounds = (await dateBar.boundingBox())!;
      expect(dateBounds.x).toBe(logBounds.x); expect(dateBounds.y).toBe(queueBounds.y); expect(dateBounds.height).toBe(48);
      const logPanel = logs.locator(":scope > section");
      await expect(logPanel).toContainText("No run open");
      const logPanelBounds = (await logPanel.boundingBox())!;
      expect(logPanelBounds.y).toBe(dateBounds.y + dateBounds.height + 12);
      expect(logPanelBounds.y + logPanelBounds.height).toBe(queueBounds.y + queueBounds.height);
      expect(queueBounds.y + queueBounds.height).toBe((await page.getByRole("region", { name: "Session Panel", exact: true }).boundingBox())!.y - 12);
      const controls = queue.getByRole("group", { name: "Action panel controls", exact: true });
      await expect(controls).toBeVisible();
      for (const control of [page.getByRole("button", { name: "Start a run", exact: true }), page.getByRole("button", { name: "All statuses", exact: true }), page.getByRole("combobox", { name: "Sort the queue", exact: true })]) {
        const bounds = (await control.boundingBox())!;
        expect(await controls.locator(control).count()).toBe(1);
        expect(bounds.x).toBeGreaterThanOrEqual(queueBounds.x);
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(queueBounds.x + queueBounds.width);
        expect(bounds.y).toBeGreaterThan(queueBounds.y);
        expect(bounds.y + bounds.height).toBeLessThan((await queue.getByRole("group", { name: "Frequent queue filters", exact: true }).boundingBox())!.y);
      }
      await page.locator(`[data-demo-row-id="${FIXTURE_IDS.openGateRun}"]`).click();
      await expect(logs.getByRole("region", { name: "Selected run logs", exact: true })).toBeVisible();
      for (const frame of [queue, dateBar, logPanel]) {
        expect(await frame.evaluate(node => {
          const style = getComputedStyle(node);
          return {
            bordered: [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth].every(value => value === "1px"),
            rounded: parseFloat(style.borderTopLeftRadius) > 0,
            opaque: style.backgroundColor !== "transparent" && !style.backgroundColor.endsWith(", 0)"),
          };
        })).toEqual({ bordered: true, rounded: true, opaque: true });
      }
      await info.attach(`action-panel-${theme.attribute}-${width}.png`, { body: await page.screenshot(), contentType: "image/png" });
      for (const filter of await page.getByRole("group", { name: "Frequent queue filters", exact: true }).getByRole("button").all()) {
        expect(await filter.evaluate(node => {
          const range = document.createRange(); range.selectNodeContents(node);
          return range.getBoundingClientRect().width <= node.getBoundingClientRect().width;
        })).toBe(true);
      }
      await expect(logs.getByRole("button", { name: /^Choose date/u })).toBeVisible();
      await page.keyboard.press("w"); await page.keyboard.press("Escape"); await expect(rail).toBeVisible();
      const status = page.getByRole("button", { name: "All statuses", exact: true });
      await status.focus(); await page.keyboard.press("Enter");
      const menu = page.locator('[data-slot="dropdown-menu-content"][data-open]');
      await expect(menu.getByRole("menuitemradio")).toHaveCount(11);
      await menu.getByRole("menuitemradio", { name: /^Failed/u }).click();
      await expect(status).toBeFocused();
      await status.click(); await menu.getByRole("menuitemradio", { name: /^All\s/u }).click();
      await chooseSelect(page.getByRole("combobox", { name: "Sort the queue" }), "attention");
      await rail.getByRole("button", { name: "Onboarding · layout preview", exact: true }).click();
      const preview = page.getByRole("region", { name: "Onboarding preview queue", exact: true });
      await expect(preview).toContainText("fictional sample runs");
      await preview.getByRole("button").first().click();
      await expect(logs).toContainText("Onboarding");
      await rail.getByRole("button", { name: "Person Lookup", exact: true }).click();
      await expect(preview).toHaveCount(0);
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      const settings = page.getByRole("navigation", { name: "Settings sections", exact: true });
      const settingsBounds = (await settings.boundingBox())!;
      expect(settingsBounds.x).toBe(0); expect(settingsBounds.y).toBe(0); expect(settingsBounds.width).toBe(288);
      await settings.getByRole("link", { name: "Keyboard", exact: true }).click();
      const shortcutSearch = page.getByRole("searchbox", { name: "Search shortcuts", exact: true });
      await shortcutSearch.fill("search runs");
      await expect(page.locator(".shortcut-setting-row")).toHaveCount(1);
      await expect(page.locator(".shortcut-setting-row kbd")).toHaveText("/");
      await shortcutSearch.fill("not a shortcut");
      await expect(page.getByRole("status")).toHaveText("No shortcuts match your search.");
      await settings.getByRole("link", { name: "Workflow capabilities", exact: true }).click();
      const capabilitySearch = page.getByRole("searchbox", { name: "Find workflow capabilities", exact: true });
      await capabilitySearch.fill("not a workflow");
      await expect(page.getByRole("status")).toHaveText("No workflows match your search.");
      await capabilitySearch.fill("Person");
      await expect(page.locator(".capabilities-summary")).toContainText("Person Lookup");
      await settings.getByRole("link", { name: "Storage checks", exact: true }).click();
      await expect(page.getByRole("button", { name: "Run the read-only storage doctor", exact: true })).toBeVisible();
      await expect(page.getByRole("region", { name: "Settings", exact: true })).not.toContainText("No completed checks in this server session");
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      expect(errors).toEqual([]); expect(writes).toEqual([]);
      await info.attach(`permanent-shell-${theme.attribute}-${width}.png`, { body: await page.screenshot(), contentType: "image/png" });
    } finally { await server.close(); }
  });
}
