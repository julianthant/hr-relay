import { expect, test } from "@playwright/test";
import { ensureParityBundle, PARITY_DIST_DIR } from "./helpers/bundle.js";
import { installTheme, PARITY_THEMES } from "./helpers/capture.js";
import { startFixtureServer } from "./helpers/fixture-bff.js";
import { FIXTURE_DAY } from "./helpers/fixture-identity.js";
import { FIXTURE_IDS } from "./helpers/fixture-queue.js";

for (const theme of PARITY_THEMES) for (const width of [1024, 1440]) {
  test(`permanent rail with separate queue, Action panel and Logs @ ${theme.attribute}-${width}`, async ({ page }, info) => {
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
      const workspace = page.getByRole("complementary", { name: "Workspace" });
      const railBounds = (await workspace.boundingBox())!;
      expect(railBounds.x).toBe(0); expect(railBounds.y).toBe(0); expect(railBounds.width).toBe(264);
      await expect(rail.getByRole("button")).toHaveCount(15);
      const typeStyle = (node: Element) => ({ size: getComputedStyle(node).fontSize, weight: getComputedStyle(node).fontWeight });
      expect(await rail.getByRole("button", { name: "Person Lookup", exact: true }).evaluate(typeStyle)).toEqual(await rail.getByRole("button", { name: "I-9 Lookup · layout preview", exact: true }).evaluate(typeStyle));
      const bar = workspace.locator(".workspace-rail-header");
      expect((await bar.boundingBox())!.x).toBe(0);
      expect((await bar.boundingBox())!.height).toBe(64);
      await expect(page.locator(".navbar-shell")).toHaveCount(0);
      await expect(page.getByRole("group", { name: "Navigation history" })).toHaveCount(0);
      await expect(bar.getByRole("button", { name: "Search runs", exact: true })).toBeVisible();
      await expect(bar.getByRole("button", { name: /^Notifications,/u })).toBeVisible();
      await expect(bar.getByRole("button", { name: /^Choose date/u })).toHaveCount(0);
      await expect(bar.locator("kbd")).toHaveCount(0);
      expect(await rail.locator(".workflow-rail-groups").evaluate(node => getComputedStyle(node).scrollbarWidth)).toBe("none");
      await expect(page.getByRole("button", { name: /Workflow Panel|Float|Minimise/iu })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Start a run", exact: true })).toBeVisible();
      const queue = page.getByRole("region", { name: "Queue", exact: true }), logs = page.locator(".dashboard-log-column");
      const actions = logs.getByRole("region", { name: "Action panel", exact: true });
      const queueBounds = (await queue.boundingBox())!, logBounds = (await logs.boundingBox())!;
      expect(queueBounds.x).toBe(276); expect(queueBounds.y).toBe(12); expect(logBounds.y).toBe(12);
      expect(queueBounds.width).toBeGreaterThanOrEqual(244);
      expect(logBounds.x).toBeCloseTo(queueBounds.x + queueBounds.width + 12);
      expect(logBounds.x + logBounds.width).toBe(width - 12);
      const actionBounds = (await actions.boundingBox())!;
      expect(actionBounds.x).toBe(logBounds.x); expect(actionBounds.y).toBe(queueBounds.y); expect(actionBounds.height).toBe(48);
      const dateBar = actions.getByRole("group", { name: "Log date controls", exact: true });
      const dateBounds = (await dateBar.boundingBox())!;
      expect(dateBounds.x).toBeGreaterThan(actionBounds.x); expect(dateBounds.y).toBeGreaterThan(actionBounds.y); expect(dateBounds.height).toBe(32);
      const logPanel = logs.locator(":scope > section:not(.dashboard-action-panel)");
      await expect(logPanel).toContainText("No run open");
      const logPanelBounds = (await logPanel.boundingBox())!;
      expect(logPanelBounds.y).toBe(actionBounds.y + actionBounds.height + 12);
      expect(logPanelBounds.y + logPanelBounds.height).toBe(queueBounds.y + queueBounds.height);
      expect(queueBounds.y + queueBounds.height).toBe((await page.getByRole("region", { name: "Session Panel", exact: true }).boundingBox())!.y - 12);
      await expect(queue.getByRole("button", { name: "Start a run", exact: true })).toHaveCount(0);
      const controls = actions.getByRole("group", { name: "Action panel controls", exact: true });
      await expect(controls).toBeVisible();
      for (const control of [page.getByRole("button", { name: "Start a run", exact: true }), page.getByRole("button", { name: "Filter queue by status", exact: true }), page.getByRole("combobox", { name: "Sort the queue", exact: true })]) {
        const bounds = (await control.boundingBox())!;
        expect(await controls.locator(control).count()).toBe(1);
        expect(bounds.x).toBeGreaterThanOrEqual(actionBounds.x);
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(dateBounds.x);
        expect(bounds.y).toBeGreaterThan(actionBounds.y);
        expect(bounds.y + bounds.height).toBeLessThan(actionBounds.y + actionBounds.height);
      }
      await page.locator(`[data-demo-row-id="${FIXTURE_IDS.openGateRun}"]`).click();
      await expect(logs.getByRole("region", { name: "Selected run logs", exact: true })).toBeVisible();
      for (const id of [FIXTURE_IDS.openGateRun, FIXTURE_IDS.failedRun, FIXTURE_IDS.runningRun, FIXTURE_IDS.doneRun]) {
        const row = page.locator(`[data-demo-row-id="${id}"]`);
        await row.click();
        const badgeStyle = (node: Element) => {
          const style = getComputedStyle(node);
          return { color: style.color, background: style.backgroundColor, border: style.borderColor, font: style.fontSize, text: node.textContent, icon: node.querySelector("svg")?.innerHTML };
        };
        expect(await logPanel.locator("header [data-slot=badge]").first().evaluate(badgeStyle)).toEqual(await row.locator("[data-slot=badge]").first().evaluate(badgeStyle));
      }
      expect(await logPanel.locator(":scope > header").evaluate(node => getComputedStyle(node).backgroundColor)).not.toBe(await logPanel.evaluate(node => getComputedStyle(node).backgroundColor));
      for (const frame of [queue, actions, logPanel]) {
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
        expect(await filter.locator("span").first().evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
      }
      await expect(logs.getByRole("button", { name: /^Choose date/u })).toBeVisible();
      await page.keyboard.press("w"); await page.keyboard.press("Escape"); await expect(rail).toBeVisible();
      const status = page.getByRole("button", { name: "Filter queue by status", exact: true });
      await status.focus(); await page.keyboard.press("Enter");
      const menu = page.locator('[data-slot="dropdown-menu-content"][data-open]');
      await expect(menu.getByRole("menuitemcheckbox")).toHaveCount(11);
      await expect(menu.locator('[data-slot="dropdown-menu-label"]')).toHaveText(["Quick filters", "In progress", "Finished"]);
      expect(await menu.evaluate(node => getComputedStyle(node).paddingTop)).toBe("6px");
      expect(await menu.getByRole("menuitemcheckbox").first().evaluate(node => getComputedStyle(node).paddingLeft)).toBe("8px");
      await menu.getByRole("menuitemcheckbox", { name: /^Failed/u }).click();
      await page.keyboard.press("Escape"); await expect(status).toBeFocused();
      await status.click(); await menu.getByRole("menuitemcheckbox", { name: /^All\s/u }).click(); await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "Attention first", exact: true }).click();
      await page.getByRole("combobox", { name: "Sort the queue" }).click();
      const sortMenu = page.locator('[data-slot="select-content"][data-open]');
      await sortMenu.evaluate(async node => { await Promise.all(node.getAnimations({ subtree: true }).map(animation => animation.finished)); });
      expect(await sortMenu.locator('[data-slot="select-group"]').evaluate(node => getComputedStyle(node).paddingTop)).toBe("6px");
      const popupBounds = (await sortMenu.boundingBox())!, optionBounds = (await sortMenu.getByRole("option").first().boundingBox())!;
      expect(optionBounds.x - popupBounds.x).toBeGreaterThanOrEqual(6);
      await page.keyboard.press("Escape");
      await rail.getByRole("button", { name: "Onboarding · layout preview", exact: true }).click();
      const preview = page.getByRole("region", { name: "Onboarding preview queue", exact: true });
      await expect(preview).toContainText("fictional sample runs");
      await preview.getByRole("button").first().click();
      await expect(logs.getByRole("region", { name: "Selected run logs", exact: true }).locator(":scope > header h2")).toContainText("EID 10873698");
      await rail.getByRole("button", { name: "Person Lookup", exact: true }).click();
      await expect(preview).toHaveCount(0);
      const railFill = await bar.evaluate(node => getComputedStyle(node).backgroundColor);
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      const settings = page.getByRole("navigation", { name: "Settings sections", exact: true });
      await expect(settings).toBeVisible(); await expect(queue).toHaveCount(0); await expect(bar).toBeHidden();
      expect((await settings.boundingBox())!.x).toBe(0);
      expect((await settings.boundingBox())!.width).toBe(264);
      expect(await settings.evaluate(node => getComputedStyle(node).backgroundColor)).toBe(railFill);
      await expect(settings.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
      await expect(settings.getByRole("button", { name: /^Notifications,|^Search runs$/u })).toHaveCount(0);
      const choosePage = async (name: string) => { await settings.getByRole("link", { name, exact: true }).click(); };
      await choosePage("Keyboard");
      const shortcutSearch = page.getByRole("searchbox", { name: "Search shortcuts", exact: true });
      await shortcutSearch.fill("search runs");
      await expect(page.locator(".shortcut-reference-row")).toHaveCount(1); await expect(page.locator(".shortcut-reference-row kbd")).toHaveText("/");
      await shortcutSearch.fill("not a shortcut"); await expect(page.getByRole("status")).toHaveText("No shortcuts match your search.");
      await choosePage("Preflight");
      const capabilitySearch = page.getByRole("searchbox", { name: "Find workflow capabilities", exact: true });
      await capabilitySearch.fill("not a workflow"); await expect(page.getByText("No workflows match your search.", { exact: true })).toBeVisible();
      await capabilitySearch.fill("Person"); await expect(page.locator(".capabilities-summary")).toContainText("Person Lookup");
      await choosePage("Storage checks"); await expect(page.getByRole("button", { name: "Run the read-only storage doctor", exact: true })).toBeVisible();
      await expect(page.getByRole("region", { name: "Settings", exact: true })).not.toContainText("No completed checks in this server session");
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      expect(errors).toEqual([]); expect(writes).toEqual([]);
      await info.attach(`permanent-shell-${theme.attribute}-${width}.png`, { body: await page.screenshot(), contentType: "image/png" });
    } finally { await server.close(); }
  });
}
