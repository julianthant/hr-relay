import { FIXTURE_DAY_WIRE, FIXTURE_IDS } from "./helpers/fixture-queue.js";
import { seedMockRuns } from "../../src/dashboard/surfaces/workflows/mocks/workflow-mock-model.js";
import { attachShellA11y } from "./helpers/shell-proof.js";


import { expect, type Page, type TestInfo } from "@playwright/test";
import { test } from "./helpers/fixtures.js";
import { PARITY_DIST_DIR } from "./helpers/bundle.js";
import { installTheme, PARITY_THEMES } from "./helpers/capture.js";
import { startFixtureServer } from "../support/helpers/dashboard/fixture-bff.js";
import { FIXTURE_DAY } from "./helpers/fixture-identity.js";

async function captureSemanticEvidence(page: Page, info: TestInfo, name: string) {
  await attachShellA11y(page, info, `${name}.a11y.yml`);
}

function contrastRatio(foreground: string, background: string): number {
  const luminance = (color: string) => {
    const channels = color.match(/^rgb\((\d+), (\d+), (\d+)\)$/u);
    if (!channels) throw new Error(`palette-color-not-opaque: ${color}`);
    const linear = channels.slice(1).map(value => {
      const channel = Number(value) / 255;
      return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
    });
    return linear[0] * .2126 + linear[1] * .7152 + linear[2] * .0722;
  };
  const values = [luminance(foreground), luminance(background)].sort((a, b) => a - b);
  return (values[1] + .05) / (values[0] + .05);
}

function disconnectedRequests(page: Page) {
  const requests: string[] = [];
  page.on("request", request => {
    const path = new URL(request.url()).pathname;
    if (request.method() !== "GET" || /\/api\/v1\/(?:notifications|search|calendar|doctor)(?:\/|$)/u.test(path)) requests.push(`${request.method()} ${path}`);
  });
  return requests;
}


for (const theme of PARITY_THEMES) for (const width of [1024, 1440]) {
  const size = `${theme.attribute}-${width}`;
  test(`permanent workspace rail and local controls @ ${size}`, { annotation: ["navbar", "navbar-search", "navbar-calendar"].map(name => ({ type: "required-a11y-evidence", description: `${name}-${size}.a11y.yml` })) }, async ({ page }, info) => {
    const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
    try {
      await page.setViewportSize({ width, height: width === 1024 ? 720 : 1000 });
      await installTheme(page, theme);
      const requests = disconnectedRequests(page);
      await page.goto(`${server.baseUrl}/?day=${FIXTURE_DAY}`);
      const bar = page.getByRole("complementary", { name: "Workspace" });
      await expect(page.locator(".navbar-shell")).toHaveCount(0);
      await expect(page.getByRole("button", { name: /^(Back|Forward)$/u })).toHaveCount(0);
      await expect(bar).not.toContainText("RRSS HR");
      await expect(bar.locator("svg.lucide-shield-check")).toHaveCount(0);
      const railWidth = 312;
      expect((await bar.boundingBox())!.width).toBe(railWidth);
      expect((await bar.locator(".workspace-rail-header").boundingBox())!.height).toBe(64);
      for (const label of ["Notifications, 3 unread", "Search"]) {
        const control = bar.getByRole("button", { name: label, exact: true });
        await expect(control).toBeVisible();
        const bounds = (await control.boundingBox())!;
        expect(bounds.x).toBeGreaterThanOrEqual(0);
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(railWidth);
      }
      const trigger = bar.getByRole("button", { name: "Search", exact: true });
      await expect(trigger).toHaveAttribute("aria-expanded", "false");
      const searchColors = await trigger.evaluate(node => ({ color: getComputedStyle(node).color, background: getComputedStyle(node.closest("header")!).backgroundColor }));
      expect(contrastRatio(searchColors.color, searchColors.background)).toBeGreaterThanOrEqual(3);
      await expect(bar.getByRole('navigation', { name: 'Main navigation' })).toHaveCount(0);
      await expect(bar.getByRole("button", { name: /preflight/iu })).toHaveCount(0);
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      await page.getByRole("link", { name: "Analytics", exact: true }).click();
      await expect(page.getByRole("link", { name: "Analytics", exact: true })).toHaveAttribute("aria-current", "page");

      await captureSemanticEvidence(page, info, `navbar-${size}`);
      await page.getByRole("link", { name: "Explorer", exact: true }).click();
      await expect(page.getByRole("region", { name: "Workflow explorer preview" })).toBeVisible();
      await page.getByRole("button", { name: "Back to dashboard", exact: true }).click();
      await page.locator("[data-demo-row-id]").first().click();
      const runUrl = page.url();
      await page.goBack();
      expect(page.url()).not.toBe(runUrl);
      await page.goForward();
      await expect(page).toHaveURL(runUrl);
      const beforeSearch = page.url();
      await page.keyboard.press("/");
      const search = page.getByRole('dialog', { name: 'Search Relay', exact: true });
      const input = search.getByRole('combobox', { name: 'Search Relay', exact: true });
      await expect(input).toBeFocused();
      await expect(input).toHaveAttribute('aria-expanded', 'true');
      await expect(search.locator('input')).toHaveCount(1);
      const modalBounds = (await search.boundingBox())!;
      expect(Math.abs(modalBounds.x + modalBounds.width / 2 - width / 2)).toBeLessThanOrEqual(1);
      expect(modalBounds.y).toBe(64);
      await input.fill("Morrow");
      const options = search.getByRole('option');
      const result = options.filter({ hasText: "Morrow, Bea" });
      await expect(result).toHaveCount(2);
      const resultIndex = await options.evaluateAll(list => list.findIndex(option => option.textContent?.includes("Morrow, Bea")));
      expect(resultIndex).toBeGreaterThanOrEqual(0);
      await input.press("Home");
      for (let index = 0; index < resultIndex; index += 1) await input.press("ArrowDown");
      await expect(result.first()).toHaveAttribute('data-selected', 'true');
      await expect(input).toBeFocused();
      await expect(input).toHaveAttribute('aria-activedescendant', (await result.first().getAttribute('id'))!);
      await input.press("Enter");
      await expect(search).toHaveCount(0);
      expect(new URL(page.url()).searchParams.get("run")).toBe(FIXTURE_IDS.openGateRun);
      expect(page.url()).not.toBe(beforeSearch);
      await trigger.click();
      await input.fill("not in the sample");
      await expect(search).toContainText("No matches");
      await input.fill("");
      await search.getByRole("group", { name: "Filter results", exact: true }).getByRole("button", { name: "Runs", exact: true }).click();
      await expect(options).toHaveCount(FIXTURE_DAY_WIRE.queueSurfaces.length + seedMockRuns().length);
      await input.press('End');
      await expect(options.last()).toHaveAttribute('aria-selected', 'true');
      await expect(input).toHaveAttribute('aria-activedescendant', (await options.last().getAttribute('id'))!);
      await input.press('ArrowDown');
      await expect(options.first()).toHaveAttribute('aria-selected', 'true');
      await input.press('ArrowUp');
      await expect(options.last()).toHaveAttribute('aria-selected', 'true');
      await input.press('Home');
      await expect(options.first()).toHaveAttribute('aria-selected', 'true');

      await captureSemanticEvidence(page, info, `navbar-search-${size}`);
      await page.keyboard.press("Escape");
      await expect(trigger).toBeFocused();
      await expect(trigger).toHaveAttribute('aria-expanded', 'false');
      await expect(search).toHaveCount(0);
      await trigger.click();
      await expect(input).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(trigger).toBeFocused();
      const date = page.locator(".dashboard-log-date").getByRole("button", { name: /^Choose date/u });
      const dateField = page.locator(".dashboard-log-date").getByRole("group", { name: /^Dashboard date/u });
      await expect(dateField.getByRole("spinbutton", { name: /^day/u })).toHaveText("03");
      await expect(bar.getByRole("button", { name: /^(Previous|Next) day$/u })).toHaveCount(0);
      await date.click();
      const calendar = page.getByRole("dialog", { name: "Choose date", exact: true });
      const selected = calendar.getByRole("button", { name: /Monday, August 3, 2026/u });
      await expect(selected).toBeFocused();
      await expect(calendar.getByRole("button", { name: /Tuesday, August 4, 2026/u })).toBeDisabled();
      await selected.press("ArrowLeft");
      await expect(calendar.getByRole("button", { name: /Sunday, August 2, 2026/u })).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(dateField.getByRole("spinbutton", { name: /^day/u })).toHaveText("02");
      await expect(page).toHaveURL(/day=2026-08-02/u);
      await date.click();
      await calendar.getByRole("button", { name: "Previous month", exact: true }).click();
      await expect(calendar.getByRole("button", { name: "July 2026, year selector", exact: true })).toBeVisible();
      expect(await calendar.locator("[data-slot='calendar-cell'][tabindex='0']").count()).toBe(1);

      await captureSemanticEvidence(page, info, `navbar-calendar-${size}`);
      await calendar.getByRole("button", { name: /Monday, July 20, 2026/u }).click();
      await expect(dateField.getByRole("spinbutton", { name: /^month/u })).toHaveText("07");
      await expect(dateField.getByRole("spinbutton", { name: /^day/u })).toHaveText("20");
      await expect(bar.getByTitle("Run count unavailable", { exact: true })).toHaveCount(0);
      await date.click();
      await calendar.getByRole("button", { name: "Today", exact: true }).click();
      await expect(dateField.getByRole("spinbutton", { name: /^month/u })).toHaveText("08");
      await expect(dateField.getByRole("spinbutton", { name: /^day/u })).toHaveText("03");
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      await page.getByRole("navigation", { name: "Settings sections" }).getByRole("link", { name: "General", exact: true }).click();
      const themeToggle = page.getByRole("button", { name: `Switch to ${theme.attribute === "dark" ? "light" : "dark"} theme`, exact: true });
      await expect(themeToggle).toHaveText(theme.attribute === "dark" ? "Dark" : "Light");
      await themeToggle.focus();
      await themeToggle.press("Space");
      await expect(page.getByRole("button", { name: `Switch to ${theme.attribute} theme`, exact: true })).toHaveText(theme.attribute === "dark" ? "Light" : "Dark");
      expect(requests).toEqual([]);
      await expect(page.getByRole("region", { name: "Settings", exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Back to dashboard", exact: true })).toBeVisible();
      await expect(bar).toBeHidden();
      await expect(bar.getByRole("button", { name: "Dashboard", exact: true })).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    } finally { await server.close(); }
  });

  test(`notification filters, retired history gaps and local actions @ ${size}`, { annotation: [{ type: "required-a11y-evidence", description: `notifications-normal-${size}.a11y.yml` }] }, async ({ page }, info) => {
    const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
    try {
      await page.setViewportSize({ width, height: width === 1024 ? 720 : 1000 });
      await installTheme(page, theme);
      const requests = disconnectedRequests(page);
      await page.goto(`${server.baseUrl}/`);
      const bell = () => page.getByRole("button", { name: /^Notifications, \d+ unread$/u });
      await bell().click();
      const inbox = page.getByRole("complementary", { name: "Workspace", exact: true }).getByRole("region", { name: "Notifications", exact: true });
      await expect(inbox).toBeVisible();
      await expect(page.getByRole("navigation", { name: "Workflows", exact: true })).toHaveCount(0);
      await expect(bell()).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByRole("navigation", { name: "Settings sections" })).toBeHidden();
      const headerBackground = await page.locator(".workspace-rail-header").evaluate(node => getComputedStyle(node).backgroundColor);
      await expect(page.locator(".workspace-rail")).toHaveCSS("background-color", headerBackground);
      const bounds = (await inbox.boundingBox())!;
      expect(bounds.width).toBe(311);
      expect(bounds.y).toBeGreaterThanOrEqual(0);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(width === 1024 ? 720 : 1000);
      await expect(inbox.getByRole("button", { name: /Snooze|Enable/u })).toHaveCount(0);
      const rows = inbox.locator("li.notification-row");
      await expect(rows).toHaveCount(13);
      await expect(inbox.getByRole("tab")).toHaveCount(0);
      const menuButton = inbox.getByRole("button", { name: "Notification actions", exact: true });
      const menuBounds = (await menuButton.boundingBox())!;
      expect(menuBounds.width).toBe(28); expect(menuBounds.height).toBe(28);
      await expect(menuButton.locator("svg")).toHaveCount(1);
      expect(await rows.first().locator("button.notification-item").evaluate(node => parseFloat(getComputedStyle(node).borderRadius))).toBeGreaterThan(0);
      await expect(inbox.getByText("Person Lookup", { exact: true }).first()).toBeVisible();

      await captureSemanticEvidence(page, info, `notifications-normal-${size}`);
      await expect(inbox.getByText("History gap", { exact: true })).toHaveCount(0);
      const failed = rows.filter({ has: page.locator("button.notification-item", { hasText: "Run failed" }) });
      await failed.hover();
      await failed.getByRole("button", { name: "Mark as read", exact: true }).click();
      await expect(bell()).toHaveAccessibleName("Notifications, 2 unread");
      await expect(rows).toHaveCount(13);
      await expect(inbox.locator(".notification-unread-dot")).toHaveCount(2);
      const priority = inbox.getByRole("region", { name: "Priority", exact: true });
      await expect(priority).toBeVisible();
      await menuButton.click();
      const priorityItem = page.getByRole("menuitemcheckbox", { name: "Priority section", exact: true });
      await expect(priorityItem).toHaveAttribute("aria-checked", "true");
      await priorityItem.click();
      await expect(priority).toHaveCount(0);
      await expect(rows).toHaveCount(13);
      await menuButton.click();
      await expect(priorityItem).toHaveAttribute("aria-checked", "false");
      await priorityItem.click();
      await expect(priority).toBeVisible();
      await rows.filter({ has: page.locator("button.notification-item", { hasText: "EID 10555001" }) }).locator("button.notification-item").click();
      await expect(inbox).toBeVisible();
      await expect(page.getByRole("region", { name: "Selected run logs", exact: true }).getByRole("heading", { level: 2 })).toHaveText("EID 10555001");
      expect(new URL(page.url()).searchParams.get("run")).toBe("00000000-0004-4000-8000-000000000004");
      await menuButton.click();
      await page.getByRole("menuitem", { name: "Mark all as read", exact: true }).click();
      await expect(inbox.locator(".notification-unread-dot")).toHaveCount(0);
      await expect(inbox.getByText("History gap", { exact: true })).toHaveCount(0);
      await expect(bell()).toHaveAccessibleName("Notifications, 0 unread");
      await expect(page.getByRole("menu")).toHaveCount(0);
      await page.keyboard.press("Escape");
      await expect(inbox).toHaveCount(0);
      await expect(bell()).toBeFocused();
      expect(requests).toEqual([]);
    } finally { await server.close(); }
  });

  test(`notification empty, loading, unavailable and ping states @ ${size}`, { annotation: ["notifications-empty", "notifications-loading", "notifications-unavailable", "notification-ping"].map(name => ({ type: "required-a11y-evidence", description: `${name}-${size}.a11y.yml` })) }, async ({ page }, info) => {
    const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
    try {
      await page.setViewportSize({ width, height: width === 1024 ? 720 : 1000 });
      await installTheme(page, theme);
      const requests = disconnectedRequests(page);
      for (const scenario of ["empty", "loading", "unavailable"] as const) {
        await page.goto(`${server.baseUrl}/?notificationsPreview=${scenario}&view=${encodeURIComponent(JSON.stringify({ notifications: true }))}`);
        const name = scenario === "empty" ? "Notifications, 0 unread" : scenario === "loading" ? "Notifications loading" : "Notifications unavailable";
        await expect(page.getByRole("button", { name, exact: true })).toHaveAttribute("aria-pressed", "true");
        const inbox = page.getByRole("complementary", { name: "Workspace", exact: true }).getByRole("region", { name: "Notifications", exact: true });
        if (scenario === "empty") await expect(inbox).toContainText("Nothing needs attention");
        else if (scenario === "loading") await expect(inbox.getByRole("status", { name: "Loading notifications", exact: true })).toHaveText("");
        else await expect(inbox.getByRole("alert")).toContainText("Notification data could not be loaded.");
        await expect(inbox.getByRole("button", { name: /^(?:Mark as (?:read|unread)|Snooze)$/ })).toHaveCount(0);
        await captureSemanticEvidence(page, info, `notifications-${scenario}-${size}`);

      }
      await page.goto(`${server.baseUrl}/?notificationsPreview=ping`);
      const ping = page.locator('[data-slot="toast"]');
      await expect(ping).toBeVisible();
      await expect(ping).toHaveCSS("background-color", theme.attribute === "dark" ? "rgb(24, 24, 27)" : "rgb(255, 255, 255)");
      await expect(ping).toContainText("EID 10101010");

      await captureSemanticEvidence(page, info, `notification-ping-${size}`);
      await expect(ping).toHaveAttribute("aria-label", "Dismiss notification");
      await page.getByRole("button", { name: /^Notifications/u }).click();
      await expect(ping).toHaveCount(0);
      const inbox = page.getByRole("complementary", { name: "Workspace", exact: true }).getByRole("region", { name: "Notifications", exact: true });
      await expect(inbox).toBeVisible();
      await page.goto(`${server.baseUrl}/?notificationsPreview=ping`);
      await expect(ping).toBeVisible();
      await ping.click();
      await expect(ping).toHaveCount(0);
      await expect(inbox).toHaveCount(0);
      expect(requests).toEqual([]);
    } finally { await server.close(); }
  });
}
