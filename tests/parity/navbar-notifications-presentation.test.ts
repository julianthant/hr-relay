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
      const railWidth = Math.max(208, Math.min(264, width / 4 - 96));
      expect((await bar.boundingBox())!.width).toBe(railWidth);
      expect((await bar.locator(".workspace-rail-header").boundingBox())!.height).toBe(64);
      for (const label of ["Notifications, 3 unread", "Search runs"]) {
        const control = bar.getByRole("button", { name: label, exact: true });
        await expect(control).toBeVisible();
        const bounds = (await control.boundingBox())!;
        expect(bounds.x).toBeGreaterThanOrEqual(0);
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(railWidth);
      }
      const trigger = bar.getByRole("button", { name: "Search runs", exact: true });
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
      const search = page.getByRole('dialog', { name: 'Search runs', exact: true });
      const input = search.getByRole('combobox', { name: 'Search runs', exact: true });
      await expect(input).toBeFocused();
      await expect(input).toHaveAttribute('aria-expanded', 'true');
      await expect(search.locator('input')).toHaveCount(1);
      const modalBounds = (await search.boundingBox())!;
      expect(Math.abs(modalBounds.x + modalBounds.width / 2 - width / 2)).toBeLessThanOrEqual(1);
      expect(Math.abs(modalBounds.y + modalBounds.height / 2 - (width === 1024 ? 720 : 1000) / 2)).toBeLessThanOrEqual(1);
      await input.fill("MORROW review");
      await expect(search.getByRole("listbox", { name: "Search results" }).getByRole("option")).toHaveCount(2);
      const result = search.locator(`[role="option"][id$="-${FIXTURE_IDS.openGateRun}"]`);
      await expect(result).toContainText("Morrow, Bea");
      const resultIndex = await search.getByRole("option").evaluateAll((options, runId) => options.findIndex(option => option.id.endsWith(`-${runId}`)), FIXTURE_IDS.openGateRun);
      expect(resultIndex).toBeGreaterThanOrEqual(0);
      await input.press("Home");
      for (let index = 0; index < resultIndex; index += 1) await input.press("ArrowDown");
      await expect(result).toHaveAttribute('data-selected', 'true');
      await expect(input).toBeFocused();
      await expect(input).toHaveAttribute('aria-activedescendant', (await result.getAttribute('id'))!);
      await input.press("Enter");
      await expect(search).toHaveCount(0);
      expect(new URL(page.url()).searchParams.get("run")).toBe(FIXTURE_IDS.openGateRun);
      expect(page.url()).not.toBe(beforeSearch);
      await trigger.click();
      await input.fill("not in the sample");
      await expect(search).toContainText("No runs match your search.");
      await input.fill("");
      await expect(search.getByRole("listbox", { name: "Search results" }).getByRole("option")).toHaveCount(FIXTURE_DAY_WIRE.queueSurfaces.length + seedMockRuns().length);
      const options = search.getByRole('option');
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
      await input.fill('Morrow');
      await search.getByRole('button', { name: 'Clear search', exact: true }).click();
      await expect(input).toHaveValue('');
      await expect(input).toBeFocused();
      await expect(search.getByRole('option')).toHaveCount(FIXTURE_DAY_WIRE.queueSurfaces.length + seedMockRuns().length);
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
      const themeSwitch = page.getByRole("switch", { name: /^Dark theme/u });
      await expect(themeSwitch).toBeChecked({ checked: theme.attribute === "dark" });
      await themeSwitch.focus();
      await themeSwitch.press("Space");
      await expect(themeSwitch).toBeChecked({ checked: theme.attribute !== "dark" });
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
      const inbox = page.locator(".notification-rail");
      await expect(inbox).toHaveCSS("opacity", "1");
      await expect(page.locator(".workspace-rail")).toHaveCSS("background-color", theme.attribute === "dark" ? "rgb(34, 34, 34)" : "rgb(255, 255, 255)");
      await expect(bell()).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByRole("navigation", { name: "Settings sections" })).toBeHidden();
      const bounds = (await inbox.boundingBox())!;
      expect(bounds.width).toBe(Math.max(208, Math.min(264, width / 4 - 96)) - 1);
      expect(bounds.y).toBeGreaterThanOrEqual(0);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(width === 1024 ? 720 : 1000);
      await expect(inbox.getByRole("button", { name: /Snooze|Enable/u })).toHaveCount(0);
      const rows = inbox.locator(".notification-row");
      await expect(rows).toHaveCount(13);
      await expect(inbox.getByRole("tab")).toHaveCount(2);
      for (const tab of await inbox.getByRole("tab").all()) {
        expect((await tab.boundingBox())!.height).toBe(28);
        await expect(tab).toHaveCSS("font-size", "12px");
        await expect(tab).toHaveCSS("font-weight", "400");
      }
      await expect(inbox.getByRole("tablist")).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
      expect((await inbox.locator(".tabs__indicator").boundingBox())!.height).toBe(2);
      const categoryFilter = inbox.getByRole("button", { name: "Filter notifications by category", exact: true });
      const categoryFilterBounds = (await categoryFilter.boundingBox())!;
      expect(categoryFilterBounds.width).toBe(28); expect(categoryFilterBounds.height).toBe(28);
      await expect(categoryFilter.locator("svg")).toHaveCount(1);
      expect((await categoryFilter.locator("svg").boundingBox())!.width).toBe(14);
      await expect(categoryFilter).toHaveAttribute("data-filtered", "false");
      expect(await rows.first().evaluate(node => parseFloat(getComputedStyle(node).borderRadius))).toBeGreaterThan(0);
      await expect(inbox.getByText("Person Lookup", { exact: true }).first()).toBeVisible();

      await captureSemanticEvidence(page, info, `notifications-normal-${size}`);
      await expect(inbox.getByText("History gap", { exact: true })).toHaveCount(0);
      await inbox.getByRole("button", { name: "Mark read: Run failed", exact: true }).click();
      await expect(bell()).toHaveAccessibleName("Notifications, 2 unread");
      await expect(rows).toHaveCount(13);
      await inbox.getByRole("tab", { name: "Unread", exact: true }).click();
      await expect(rows).toHaveCount(2);
      await inbox.getByRole("tab", { name: "All", exact: true }).click();
      await inbox.getByRole("button", { name: "Filter notifications by category", exact: true }).click();
      await page.getByRole("menuitemradio", { name: "Failed", exact: true }).click();
      await expect(categoryFilter).toHaveAttribute("data-filtered", "true");
      await expect(categoryFilter).toHaveAttribute("title", "Failed");
      await expect(rows).toHaveCount(1);
      await expect(inbox).toContainText("Run failed");
      await inbox.getByRole("tab", { name: "All", exact: true }).focus(); await page.keyboard.press("ArrowRight");
      await expect(inbox.getByRole("tab", { name: "Unread", exact: true })).toBeFocused();
      await expect(rows).toHaveCount(0); await expect(inbox).toContainText("No failures");
      await inbox.getByRole("tab", { name: "All", exact: true }).click();
      await inbox.getByRole("button", { name: "Filter notifications by category", exact: true }).click();
      await page.getByRole("menuitemradio", { name: "All updates", exact: true }).click();
      await expect(categoryFilter).toHaveAttribute("data-filtered", "false");
      await inbox.getByRole("tab", { name: "All", exact: true }).click();
      await expect(rows).toHaveCount(13);
      await inbox.getByRole("button", { name: "Open log", exact: true }).first().click();
      await expect(inbox).toHaveCount(0);
      await expect(page.getByRole("region", { name: "Selected run logs", exact: true }).getByRole("heading", { level: 2 })).toHaveText("EID 10555001");
      expect(new URL(page.url()).searchParams.get("run")).toBe("00000000-0004-4000-8000-000000000004");
      await bell().click();
      await inbox.getByRole("tab", { name: "Unread", exact: true }).click();
      await inbox.getByRole("button", { name: "Mark read: Records ready for approval", exact: true }).click();
      await inbox.getByRole("button", { name: "Mark read: Run completed", exact: true }).click();
      await expect(inbox).toContainText("All caught up");
      await expect(inbox.getByRole("tab", { name: "Unread", exact: true })).toBeFocused();
      await expect(inbox.getByText("History gap", { exact: true })).toHaveCount(0);
      await expect(bell()).toHaveAccessibleName("Notifications, 0 unread");
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
        const inbox = page.locator(".notification-rail");
        if (scenario === "empty") await expect(inbox).toContainText("No notifications");
        else if (scenario === "loading") await expect(inbox.getByRole("status", { name: "Loading notifications", exact: true })).toHaveText("");
        else await expect(inbox.getByRole("alert")).toContainText("Notification data could not be loaded.");
        await expect(inbox.getByRole("button", { name: /^(?:Mark read:|Snooze:)/ })).toHaveCount(0);
        await captureSemanticEvidence(page, info, `notifications-${scenario}-${size}`);

      }
      await page.goto(`${server.baseUrl}/?notificationsPreview=ping`);
      const ping = page.locator('[data-slot="toast"]');
      await expect(ping).toBeVisible();
      await expect(ping).toHaveCSS("background-color", theme.attribute === "dark" ? "rgb(34, 34, 34)" : "rgb(255, 255, 255)");
      await expect(ping).toContainText("EID 10101010");

      await captureSemanticEvidence(page, info, `notification-ping-${size}`);
      await ping.getByRole("button", { name: "Open notifications", exact: true }).click();
      await expect(ping).toHaveCount(0);
      await expect(page.locator(".notification-rail")).toBeVisible();
      await page.goto(`${server.baseUrl}/?notificationsPreview=ping`);
      await ping.getByRole("button", { name: "Dismiss", exact: true }).click();
      await expect(ping).toHaveCount(0);
      await expect(page.locator(".notification-rail")).toHaveCount(0);
      expect(requests).toEqual([]);
    } finally { await server.close(); }
  });
}
