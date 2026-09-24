import { attachShellA11y } from "./helpers/shell-proof.js";
import { expect, test, type Page } from "@playwright/test";
import { ensureParityBundle, PARITY_DIST_DIR } from "./helpers/bundle.js";
import { startSeededServer, type SeededServer, SEEDED_COVERAGE_GAPS } from "./helpers/seeded-bff.js";
import { DATE_HISTORY, dateRunId, readDateSnapshot } from "./helpers/date-navigation-server.js";
import { gotoAppState, installFrozenMonotonic } from "./helpers/app-driver.js";
import { installTheme, PARITY_THEMES } from "./helpers/capture.js";
import { CalendarWireSchema } from "../../src/domain/dashboard/calendar.js";
let server: SeededServer;
test.beforeAll(async () => { ensureParityBundle(); server = await startSeededServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" }, dateNavigation: true }); });
test.afterAll(async () => { await server?.close(); });
const picker = (page: Page) => page.getByRole("button", { name: /^Pick a day/ });
async function selectMonth(page: Page, month: string) {
  await expect(page.getByRole("grid", { name: "Pick a day" })).toBeVisible();
  await expect(page.locator(`[data-demo-day="${month}-15"]`)).toBeVisible();
}
for (const theme of PARITY_THEMES) {
  test(`canonical calendar, history, empty links, picker and desktop geometry @ ${theme.name}`, { annotation: [{ type: "required-a11y-evidence", description: `date-navigation-${theme.name}.a11y.yml` }] }, async ({ page }, info) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await installTheme(page, theme);
    await gotoAppState(page, server.baseUrl, { day: "2026-07-30", run: dateRunId(4) });
    await expect(page.locator(`[data-demo-row-id="${dateRunId(4)}"]`)).toBeVisible();
    await expect(picker(page)).toHaveAccessibleName(/1 row/);
    const calendar = CalendarWireSchema.parse(await (await page.request.get(`${server.baseUrl}/api/v1/calendar?month=2026-07&day=2026-07-30`)).json());
    expect(calendar.monthCounts).toEqual([{ day: "2026-07-01", count: 1 }, { day: "2026-07-30", count: 1 }]);
    const daySnapshot = await readDateSnapshot(server.baseUrl, "2026-07-30");
    expect(daySnapshot.day).toBe("2026-07-30");
    expect(daySnapshot.queueSurfaces.map(row => row.runId)).toEqual([dateRunId(4)]);
    expect(daySnapshot.monthCounts).toEqual(calendar.monthCounts);
    expect(daySnapshot.statusCounts.reduce((sum, row) => sum + row.count, 0)).toBe(1);
    expect(calendar.previousDay).toBe("2026-07-01"); expect(calendar.nextDay).toBe(server.day);
    await page.getByRole("button", { name: /^Previous day/ }).click();
    await expect(page).toHaveURL(/day=2026-07-01$/); await expect(page.locator(`[data-demo-row-id="${dateRunId(3)}"]`)).toBeVisible();
    await page.goBack(); await expect(page).toHaveURL(/day=2026-07-30/);
    await page.goForward(); await expect(page).toHaveURL(/day=2026-07-01/);
    await page.reload(); await expect(picker(page)).toHaveAccessibleName(/1 row/);
    await page.getByRole("button", { name: /^Previous day/ }).click();
    await expect(page).toHaveURL(/day=2026-06-15$/);
    await page.getByRole("button", { name: "Back", exact: true }).click(); await expect(page).toHaveURL(/day=2026-07-01/);
    await page.getByRole("button", { name: "Forward", exact: true }).click(); await expect(page).toHaveURL(/day=2026-06-15/);
    await picker(page).click(); await page.getByRole("button", { name: /^Previous month/ }).click();
    await selectMonth(page, "2026-05");
    await expect(page.locator('[data-demo-day^="2026-05-"]:not([aria-disabled="true"])')).toHaveCount(0);
    await page.locator('[role="grid"] [tabindex="0"]').press("Enter");
    expect(new URL(page.url()).searchParams.get("day")).toBe("2026-06-15");
    await page.getByRole("button", { name: "Today", exact: true }).click();
    await expect(page).not.toHaveURL(/day=/); await expect(picker(page)).toBeFocused();
    await picker(page).click();
    await expect(page.locator('[data-demo-day="2026-08-04"]')).toBeDisabled();
    await page.keyboard.press("Escape"); await expect(picker(page)).toBeFocused();
    await picker(page).click(); await page.getByRole("button", { name: "Dashboard", exact: true }).click();
    await expect(page.getByRole("grid")).toHaveCount(0);
    await expect(picker(page)).toBeFocused();
    await gotoAppState(page, server.baseUrl, { day: "2025-01-01" });
    await expect(picker(page)).toHaveAccessibleName(/0 rows/);
    await expect(page.getByRole("button", { name: /^Previous day/ })).toHaveAccessibleName(/Dec 31/);
    await page.getByRole("button", { name: /^Next day/ }).click(); await expect(page).toHaveURL(/day=2025-01-02/);
    await gotoAppState(page, server.baseUrl, { day: "2025-01-02", run: dateRunId(1) });
    for (const viewport of [{ width: 1440, height: 900 }, { width: 1280, height: 720 }, { width: 1024, height: 768 }, { width: 1024, height: 720 }, { width: 1024, height: 768 }]) {
      await page.setViewportSize(viewport);
      await expect(page.locator(`[data-demo-row-id="${dateRunId(1)}"]`)).toBeVisible();
      await expect(page.getByRole("tab", { name: "Logs", exact: true })).toHaveAttribute("aria-selected", "true");
      await picker(page).click();
      await expect(page.getByRole("grid")).toBeVisible();
      await expect(page.getByRole("dialog", { name: "Pick a day", exact: true })).toHaveCSS("opacity", "1");
      const hit = await page.getByRole("button", { name: "Today", exact: true }).evaluate(el => { const r = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); });
      expect(hit).toBe(true);
      await page.screenshot({ path: info.outputPath(`${theme.name}-${viewport.width}x${viewport.height}-calendar.png`) });
      await info.attach(`a11y-${viewport.width}x${viewport.height}`, { body: await page.locator("body").ariaSnapshot(), contentType: "text/plain" });
      await page.keyboard.press("Escape"); await expect(picker(page)).toBeFocused();
    }
    await attachShellA11y(page, info, `date-navigation-${theme.name}.a11y.yml`);
    expect(errors).toEqual([]);
    await info.attach("calendar-authority", { body: JSON.stringify({ calendar, daySnapshot, history: DATE_HISTORY, gaps: SEEDED_COVERAGE_GAPS,
      real: ["SQLite summary calendar", "summary day projection", "SSE subscription", "route/history"],
      fakes: ["synthetic run authorities", "fixed server/monotonic clocks", "unwired HR services", "seeded static adapter"] }, null, 2), contentType: "application/json" });
  });
  test(`invalid and future links refuse streams and run reads, recover visibly @ ${theme.name}`, async ({ page }) => {
    await installTheme(page, theme); await installFrozenMonotonic(page);
    const requests: string[] = []; page.on("request", request => requests.push(request.url()));
    for (const day of ["2026-02-30", "2025-02-29", "2026-08-04", "wrong"]) {
      requests.length = 0;
      await page.goto(`${server.baseUrl}/?day=${day}&run=${dateRunId(0)}&section=receipt`);
      await expect(page.getByText("Choose a valid date", { exact: true })).toBeVisible();
      expect(requests.filter(url => url.includes("/events/") || url.includes("/api/v1/runs/") || url.includes("/api/v1/calendar"))).toEqual([]);
      expect(new URL(page.url()).searchParams.get("day")).toBe(day);
      await page.getByRole("button", { name: "Today", exact: true }).click();
      await expect(page).not.toHaveURL(/day=|run=|section=/);
      await expect(picker(page)).toBeVisible();
    }
  });
}

for (const theme of PARITY_THEMES) test(`late month responses and explicit calendar failure recovery @ ${theme.name}`, async ({ page }) => {
  await installTheme(page, theme);
  await gotoAppState(page, server.baseUrl, { day: "2026-07-30", run: dateRunId(4) });
  await expect(page.getByRole("button", { name: /^Previous day/ })).toBeEnabled();
  await picker(page).click();
  for (const outcome of ["success", "failure"]) {
    let release: (() => void) | undefined;
    let completed: Promise<void> | undefined;
    const pattern = "**/api/v1/calendar?month=2026-06&day=2026-07-30";
    await page.route(pattern, async route => {
      const response = await route.fetch();
      await new Promise<void>(resolve => { release = resolve; });
      completed = outcome === "success" ? route.fulfill({ response }) : route.fulfill({ status: 503, json: { state: "error", code: "CALENDAR_UNAVAILABLE", message: "Delayed old month failure", retryable: true } });
      await completed;
    });
    await page.getByRole("button", { name: /^Previous month/ }).click();
    await expect(page.getByText("Loading calendar…", { exact: true })).toBeVisible();
    await expect.poll(() => release !== undefined).toBe(true);
    await page.getByRole("button", { name: /^Next month/ }).click();
    await expect(page.locator('[data-demo-day="2026-07-30"]')).toBeEnabled();
    if (release === undefined) throw new Error("held calendar request was not reached");
    release(); await expect.poll(() => completed !== undefined).toBe(true); await completed;
    await expect(page.locator('[data-demo-day="2026-07-30"]')).toBeEnabled();
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(page).toHaveURL(/day=2026-07-30&run=/);
    await page.unroute(pattern);
  }
  const pattern = "**/api/v1/calendar?month=2026-06&day=2026-07-30";
  await page.route(pattern, route => route.fulfill({ status: 503, json: { state: "error", code: "CALENDAR_UNAVAILABLE", message: "Calendar read failed", retryable: true } }));
  await page.getByRole("button", { name: /^Previous month/ }).click();
  await expect(page.getByRole("alert")).toContainText("Calendar read failed");
  await expect(picker(page)).toHaveAccessibleName(/1 row/);
  await page.unroute(pattern);
  await page.getByRole("button", { name: "Retry calendar", exact: true }).click();
  await expect(page.locator('[data-demo-day="2026-06-15"]')).toBeEnabled();
  await page.locator('[data-demo-day="2026-06-15"]').press("Enter");
  await expect(page).toHaveURL(/day=2026-06-15$/); await expect(picker(page)).toBeFocused();
  await picker(page).click();
  const length = await page.evaluate(() => history.length);
  await page.locator('[data-demo-day="2026-06-15"]').press("Space");
  await expect(picker(page)).toBeFocused(); expect(await page.evaluate(() => history.length)).toBe(length);
});
