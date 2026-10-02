import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { ensureParityBundle, PARITY_DIST_DIR } from "./helpers/bundle.js";
import { installTheme, PARITY_THEMES } from "./helpers/capture.js";
import { startFixtureServer } from "./helpers/fixture-bff.js";
import { FIXTURE_DAY } from "./helpers/fixture-identity.js";

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
    if (request.method() !== "GET" || /\/api\/v1\/(?:notifications|search|calendar|preflight|doctor)(?:\/|$)/u.test(path)) requests.push(`${request.method()} ${path}`);
  });
  return requests;
}
async function capture(page: Page, info: TestInfo, name: string) {
  await info.attach(`${name}.png`, { body: await page.screenshot(), contentType: "image/png" });
  await info.attach(`${name}.a11y.yml`, { body: await page.locator("body").ariaSnapshot(), contentType: "text/yaml" });
}

for (const theme of PARITY_THEMES) for (const width of [1024, 1440]) {
  const size = `${theme.attribute}-${width}`;
  test(`compact canonical navbar and local controls @ ${size}`, async ({ page }, info) => {
    ensureParityBundle();
    const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
    try {
      await page.setViewportSize({ width, height: width === 1024 ? 720 : 1000 });
      await installTheme(page, theme);
      const requests = disconnectedRequests(page);
      await page.goto(`${server.baseUrl}/?day=${FIXTURE_DAY}&activity=`);
      const bar = page.getByRole("banner");
      await expect(bar.getByRole("heading", { name: "RRSS HR", exact: true })).toBeVisible();
      await expect(bar.locator("svg.lucide-shield-check")).toHaveCount(0);
      expect((await bar.boundingBox())!.height).toBe(54);
      for (const label of ["Back", "Forward", "Dashboard", "Archive", "Explorer", "Activity", "Search runs", "Choose date", "Notifications, 4 unread", "Settings"]) {
        const control = bar.getByRole("button", { name: label, exact: true });
        await expect(control).toBeVisible();
        const bounds = (await control.boundingBox())!;
        expect(bounds.x).toBeGreaterThanOrEqual(0);
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
      }
      await expect(bar.getByRole("button", { name: /preflight/iu })).toHaveCount(0);
      await expect(bar.getByRole("button", { name: "Activity", exact: true })).toHaveAttribute("aria-pressed", "true");
      await capture(page, info, `navbar-${size}`);
      await bar.getByRole("button", { name: "Explorer", exact: true }).click();
      await expect(page.getByRole("region", { name: "Workflow explorer preview" })).toBeVisible();
      await bar.getByRole("button", { name: "Dashboard", exact: true }).click();
      await bar.getByRole("heading", { name: "RRSS HR", exact: true }).click();
      await page.locator("[data-demo-row-id]").first().click();
      const runUrl = page.url();
      await expect(bar.getByRole("button", { name: "Back", exact: true })).toBeEnabled();
      await bar.getByRole("button", { name: "Back", exact: true }).click();
      await expect(bar.getByRole("button", { name: "Forward", exact: true })).toBeEnabled();
      expect(page.url()).not.toBe(runUrl);
      await bar.getByRole("button", { name: "Forward", exact: true }).click();
      await expect(page).toHaveURL(runUrl);
      const beforeSearch = page.url();
      await page.keyboard.press("/");
      const search = page.getByRole("dialog", { name: "Search runs", exact: true });
      const input = search.getByRole("searchbox", { name: "Find a run" });
      await expect(input).toBeFocused();
      await input.fill("JORDAN waiting");
      await expect(search.getByRole("list", { name: "Search results" }).getByRole("button")).toHaveCount(1);
      await input.press("ArrowDown");
      const result = search.getByRole("button", { name: /Jordan Lee/ });
      await expect(result).toBeFocused();
      await result.press("Enter");
      await expect(search.getByRole("status")).toHaveText("Run navigation is not connected yet.");
      expect(page.url()).toBe(beforeSearch);
      await input.fill("not in the sample");
      await expect(search).toContainText("No runs match your search.");
      await input.fill("");
      await expect(search.getByRole("list", { name: "Search results" }).getByRole("button")).toHaveCount(3);
      await capture(page, info, `navbar-search-${size}`);
      await page.keyboard.press("Escape");
      await expect(bar.getByRole("button", { name: "Search runs", exact: true })).toBeFocused();
      const date = bar.getByRole("button", { name: "Choose date", exact: true });
      await expect(date).toContainText("Sat, Sep 26");
      await expect(bar.getByRole("button", { name: "Next day", exact: true })).toBeDisabled();
      await date.click();
      const calendar = page.getByRole("dialog", { name: "Choose date", exact: true });
      const selected = calendar.getByRole("button", { name: "Sat, Sep 26", exact: true });
      await expect(selected).toBeFocused();
      await expect(calendar.getByRole("button", { name: "Sun, Sep 27", exact: true })).toBeDisabled();
      await selected.press("ArrowLeft");
      await expect(calendar.getByRole("button", { name: "Fri, Sep 25", exact: true })).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(date).toContainText("Fri, Sep 25");
      expect(page.url()).toBe(beforeSearch);
      await date.click();
      await calendar.getByRole("button", { name: "Previous month", exact: true }).click();
      await expect(calendar.getByRole("heading")).toHaveText("August 2026");
      expect(await calendar.locator("[data-calendar-day][tabindex='0']").count()).toBe(1);
      await capture(page, info, `navbar-calendar-${size}`);
      await calendar.getByRole("button", { name: "Thu, Aug 20", exact: true }).click();
      await expect(date).toContainText("Thu, Aug 20—");
      await date.click();
      await calendar.getByRole("button", { name: "Today", exact: true }).click();
      await expect(date).toContainText("Sat, Sep 26");
      await bar.getByRole("button", { name: theme.attribute === "dark" ? "Switch to light theme" : "Switch to dark theme", exact: true }).click();
      await expect(bar.getByRole("button", { name: theme.attribute === "dark" ? "Switch to dark theme" : "Switch to light theme", exact: true })).toBeVisible();
      expect(requests).toEqual([]);
      await bar.getByRole("button", { name: "Settings", exact: true }).click();
      await expect(page.getByRole("region", { name: "Settings", exact: true })).toBeVisible();
      await expect(bar.getByRole("button", { name: "Settings", exact: true })).toHaveAttribute("aria-pressed", "true");
      await expect(bar.getByRole("button", { name: "Dashboard", exact: true })).toHaveAttribute("aria-pressed", "false");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    } finally { await server.close(); }
  });

  test(`notification filters, pinned gaps and local actions @ ${size}`, async ({ page }, info) => {
    ensureParityBundle();
    const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
    try {
      await page.setViewportSize({ width, height: width === 1024 ? 720 : 1000 });
      await installTheme(page, theme);
      const requests = disconnectedRequests(page);
      await page.goto(`${server.baseUrl}/?activity=`);
      const bell = () => page.getByRole("button", { name: /^Notifications, \d+ unread$/u });
      await bell().click();
      const inbox = page.getByRole("dialog", { name: "Notifications", exact: true });
      await expect(inbox).toHaveCSS("opacity", "1");
      await expect(inbox).toHaveCSS("background-color", theme.attribute === "dark" ? "rgb(34, 34, 34)" : "rgb(255, 255, 255)");
      const bounds = (await inbox.boundingBox())!;
      expect(bounds.width).toBe(370);
      expect(bounds.y).toBeGreaterThanOrEqual(0);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(width === 1024 ? 720 : 1000);
      const enable = inbox.getByRole("button", { name: "Enable", exact: true });
      await expect(enable).toBeInViewport();
      const colors = await enable.evaluate(node => { const css = getComputedStyle(node); return { color: css.color, background: css.backgroundColor, border: css.borderTopColor }; });
      expect(contrastRatio(colors.color, colors.background)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(colors.border, colors.background)).toBeGreaterThanOrEqual(3);
      const rows = inbox.getByRole("list", { name: "Notifications", exact: true }).getByRole("listitem");
      await expect(rows).toHaveCount(5);
      await capture(page, info, `notifications-normal-${size}`);
      await inbox.getByText("History gap", { exact: true }).click();
      await expect(inbox).toContainText("This notice cannot be dismissed, snoozed or marked read.");
      await expect(inbox.locator("details").first().getByRole("button")).toHaveCount(0);
      await inbox.getByRole("button", { name: "Mark read: Document verification failed", exact: true }).click();
      await expect(bell()).toHaveAccessibleName("Notifications, 3 unread");
      await inbox.getByRole("button", { name: "Unread", exact: true }).click();
      await expect(rows).toHaveCount(2);
      await expect(inbox.getByText("History gap", { exact: true })).toBeVisible();
      await inbox.getByRole("button", { name: "Needs attention", exact: true }).click();
      await expect(rows).toHaveCount(3);
      await inbox.getByRole("button", { name: "Snooze: Approval waiting", exact: true }).click();
      await expect(bell()).toHaveAccessibleName("Notifications, 3 unread");
      await inbox.getByRole("button", { name: "Snoozed", exact: true }).click();
      await expect(rows).toHaveCount(2);
      await expect(inbox.getByRole("button", { name: "Mark read: Approval waiting", exact: true })).toBeVisible();
      await inbox.getByRole("button", { name: "Unsnooze: Approval waiting", exact: true }).click();
      await expect(rows).toHaveCount(1);
      await expect(inbox.getByRole("button", { name: "Snoozed", exact: true })).toBeFocused();
      await inbox.getByRole("button", { name: "All", exact: true }).click();
      await inbox.getByText("Document verification failed", { exact: true }).click();
      await expect(inbox).toContainText("The saved Kuali document did not match the staged values.");
      const before = page.url();
      await inbox.getByRole("button", { name: "Open log", exact: true }).first().click();
      await expect(inbox.getByRole("status")).toHaveText("Run navigation is not connected yet.");
      expect(page.url()).toBe(before);
      await enable.click();
      await expect(inbox.getByRole("status")).toHaveText("Desktop delivery is not connected yet.");
      await expect(enable).toBeInViewport();
      await inbox.getByRole("button", { name: "Close notifications", exact: true }).click();
      await expect(bell()).toBeFocused();
      await bell().press("Enter");
      await inbox.getByRole("button", { name: "Unread", exact: true }).click();
      await inbox.getByRole("button", { name: "Mark read: Approval waiting", exact: true }).click();
      await inbox.getByRole("button", { name: "Mark read: Separation completed", exact: true }).click();
      await expect(inbox).toContainText("All caught up");
      await expect(inbox.getByRole("button", { name: "Unread", exact: true })).toBeFocused();
      await expect(inbox.getByText("History gap", { exact: true })).toBeVisible();
      await expect(bell()).toHaveAccessibleName("Notifications, 1 unread");
      await page.keyboard.press("Escape");
      await expect(inbox).toHaveCount(0);
      await expect(bell()).toBeFocused();
      expect(requests).toEqual([]);
    } finally { await server.close(); }
  });

  test(`notification empty, loading, unavailable and ping states @ ${size}`, async ({ page }, info) => {
    ensureParityBundle();
    const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
    try {
      await page.setViewportSize({ width, height: width === 1024 ? 720 : 1000 });
      await installTheme(page, theme);
      const requests = disconnectedRequests(page);
      for (const scenario of ["empty", "loading", "unavailable"] as const) {
        await page.goto(`${server.baseUrl}/?activity=&notificationsPreview=${scenario}`);
        const name = scenario === "empty" ? "Notifications, 0 unread" : scenario === "loading" ? "Notifications loading" : "Notifications unavailable";
        await page.getByRole("button", { name, exact: true }).click();
        const inbox = page.getByRole("dialog", { name: "Notifications", exact: true });
        if (scenario === "empty") await expect(inbox).toContainText("No notifications");
        else if (scenario === "loading") await expect(inbox.getByRole("status", { name: "Loading notifications", exact: true })).toHaveText("");
        else await expect(inbox.getByRole("alert")).toContainText("Notification data could not be loaded.");
        await expect(inbox.getByRole("button", { name: /^(?:Mark read:|Snooze:)/ })).toHaveCount(0);
        await capture(page, info, `notifications-${scenario}-${size}`);
      }
      await page.goto(`${server.baseUrl}/?activity=&notificationsPreview=ping`);
      const ping = page.getByRole("status", { name: "Notification ping", exact: true });
      await expect(ping).toBeVisible();
      await expect(ping).toHaveCSS("background-color", theme.attribute === "dark" ? "rgb(34, 34, 34)" : "rgb(255, 255, 255)");
      await expect(ping).toContainText("Alex Morgan");
      await capture(page, info, `notification-ping-${size}`);
      await ping.getByRole("button", { name: "Open notifications", exact: true }).click();
      await expect(ping).toHaveCount(0);
      await expect(page.getByRole("dialog", { name: "Notifications", exact: true })).toBeVisible();
      await page.goto(`${server.baseUrl}/?activity=&notificationsPreview=ping`);
      await ping.getByRole("button", { name: "Dismiss notification ping", exact: true }).click();
      await expect(ping).toHaveCount(0);
      await expect(page.getByRole("dialog", { name: "Notifications", exact: true })).toHaveCount(0);
      expect(requests).toEqual([]);
    } finally { await server.close(); }
  });
}
