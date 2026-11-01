import { attachShellA11y } from "./helpers/shell-proof.js";
import { expect, type Page } from "@playwright/test";
import { test } from "./helpers/fixtures.js";
import { PARITY_DIST_DIR } from "./helpers/bundle.js";
import { startSeededServer, type SeededServer, SEEDED_COVERAGE_GAPS } from "./helpers/seeded-bff.js";
import { DATE_HISTORY, dateRunId, readDateSnapshot } from "./helpers/date-navigation-server.js";
import { gotoAppState, installFrozenMonotonic } from "./helpers/app-driver.js";
import { installTheme, PARITY_THEMES } from "./helpers/capture.js";
import { CalendarWireSchema } from "../../src/models/dashboard/calendar.js";
const calendarDay = (scope: Page | import("@playwright/test").Locator, day: string) => {
  const date = new Date(`${day}T12:00:00Z`);
  const label = date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
  return scope.getByRole("button", { name: new RegExp(label) });
};
let server: SeededServer;
test.beforeAll(async () => { server = await startSeededServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" }, dateNavigation: true }); });
test.afterAll(async () => { await server?.close(); });
const picker = (page: Page) => page.getByRole("button", { name: /^Choose date/ });
async function selectMonth(page: Page, month: string) {
  await expect(page.getByRole("grid", { name: "Choose date" })).toBeVisible();
  await expect(calendarDay(page, `${month}-15`)).toBeVisible();
}
for (const theme of PARITY_THEMES) {
  test(`dashboard calendar keeps the year grid idle and offers Today @ ${theme.name}`, async ({ page }) => {
    await installTheme(page, theme);
    await gotoAppState(page, server.baseUrl, { day: "2026-07-30" });
    await picker(page).click();
    const dialog = page.getByRole("dialog", { name: "Choose date" });
    const yearCells = dialog.locator('[data-slot="calendar-year-picker-grid"][data-open] [data-slot="calendar-year-picker-year-cell"]');
    await expect(yearCells).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: "Today", exact: true })).toBeVisible();
    await expect(dialog.getByText(/active days this month/)).toHaveCount(0);
    await dialog.getByRole("button", { name: /year selector/ }).click();
    await expect.poll(() => yearCells.count()).toBeGreaterThan(0);
    await dialog.getByRole("button", { name: /year selector/ }).click();
    await expect(yearCells).toHaveCount(0);
    await expect(calendarDay(dialog, "2026-07-15")).toBeEnabled();
    await dialog.getByRole("button", { name: /year selector/ }).click();
    await dialog.locator('[data-year="2024"]').click();
    await expect(yearCells).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: /2024, year selector/ })).toBeVisible();
    await expect(dialog.getByRole("button", { name: /August 15, 2024/ })).toBeEnabled();
  });
  test(`dashboard calendar opens a day without workflow rows @ ${theme.name}`, async ({ page }) => {
    await installTheme(page, theme);
    await gotoAppState(page, server.baseUrl, { day: "2026-07-30" });
    await picker(page).click();
    const emptyDay = calendarDay(page, "2026-07-15");
    await expect(emptyDay).toBeEnabled();
    await emptyDay.click();
    await expect(page).toHaveURL(/day=2026-07-15$/);
    await expect(page.getByText("No run open", { exact: true })).toBeVisible();
  });
  test(`canonical calendar, history, empty links, picker and desktop geometry @ ${theme.name}`, { annotation: [{ type: "required-a11y-evidence", description: `date-navigation-${theme.name}.a11y.yml` }] }, async ({ page }, info) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await installTheme(page, theme);
    await gotoAppState(page, server.baseUrl, { day: "2026-07-30", run: dateRunId(4) });
    await expect(page.locator(`[data-demo-row-id="${dateRunId(4)}"]`)).toBeVisible();
    await expect(picker(page)).toBeVisible();
    const calendar = CalendarWireSchema.parse(await (await page.request.get(`${server.baseUrl}/api/v1/calendar?month=2026-07&day=2026-07-30`)).json());
    expect(calendar.monthCounts).toEqual([{ day: "2026-07-01", count: 1 }, { day: "2026-07-30", count: 1 }]);
    const daySnapshot = await readDateSnapshot(server.baseUrl, "2026-07-30");
    expect(daySnapshot.day).toBe("2026-07-30");
    expect(daySnapshot.queueSurfaces.map(row => row.runId)).toEqual([dateRunId(4)]);
    expect(daySnapshot.monthCounts).toEqual(calendar.monthCounts);
    expect(daySnapshot.statusCounts.reduce((sum, row) => sum + row.count, 0)).toBe(1);
    expect(calendar.previousDay).toBe("2026-07-01"); expect(calendar.nextDay).toBe(server.day);
    await picker(page).click(); await calendarDay(page, "2026-07-29").click();
    await expect(page).toHaveURL(/day=2026-07-29$/); await expect(page.getByText("No run open", { exact: true })).toBeVisible();
    await page.goBack(); await expect(page).toHaveURL(/day=2026-07-30/);
    await page.goForward(); await expect(page).toHaveURL(/day=2026-07-29/);
    await page.reload(); await expect(page.getByText("No run open", { exact: true })).toBeVisible();
    await picker(page).click(); await calendarDay(page, "2026-07-28").click();
    await expect(page).toHaveURL(/day=2026-07-28$/);
    await page.goBack(); await expect(page).toHaveURL(/day=2026-07-29/);
    await page.goForward(); await expect(page).toHaveURL(/day=2026-07-28/);
    await picker(page).click(); await page.getByRole("button", { name: /^Previous month/ }).click();
    await page.getByRole("button", { name: /^Previous month/ }).click();
    await selectMonth(page, "2026-05");
    await expect(calendarDay(page, "2026-05-15")).toBeEnabled();
    await calendarDay(page, "2026-05-15").press("Enter");
    await expect(page).toHaveURL(/day=2026-05-15$/);
    await expect(page.getByText("No run open", { exact: true })).toBeVisible();
    await gotoAppState(page, server.baseUrl, { day: server.day });
    await picker(page).click();
    await expect(calendarDay(page, "2026-08-04")).toBeDisabled();
    await page.keyboard.press("Escape"); await expect(picker(page)).toBeFocused();
    await picker(page).click(); await page.getByRole("button", { name: "Today", exact: true }).click();
    await expect(page.getByRole("grid")).toHaveCount(0);
    await expect(picker(page)).toBeFocused();
    await gotoAppState(page, server.baseUrl, { day: "2025-01-01" });
    await expect(page.getByText("No run open", { exact: true })).toBeVisible();
    await picker(page).click(); await calendarDay(page, "2025-01-02").click(); await expect(page).toHaveURL(/day=2025-01-02/);
    await gotoAppState(page, server.baseUrl, { day: "2025-01-02", run: dateRunId(1) });
    for (const viewport of [{ width: 1440, height: 900 }, { width: 1280, height: 720 }, { width: 1024, height: 768 }, { width: 1024, height: 720 }, { width: 1024, height: 768 }]) {
      await page.setViewportSize(viewport);
      await expect(page.locator(`[data-demo-row-id="${dateRunId(1)}"]`)).toBeVisible();
      await expect(page.getByRole("region", { name: "Selected run logs" })).toBeVisible();
      await picker(page).click();
      await expect(page.getByRole("grid")).toBeVisible();
      await expect(page.getByRole("dialog", { name: "Choose date", exact: true })).toHaveCSS("opacity", "1");
      const hit = await page.getByRole("button", { name: /^Previous month/ }).evaluate(el => { const r = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); });
      expect(hit).toBe(true);
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
      await picker(page).click(); await page.getByRole("button", { name: "Today", exact: true }).click();
      await expect(page).toHaveURL(/day=2026-08-03/);
      await expect(page).not.toHaveURL(/run=/);
      await expect(picker(page)).toBeVisible();
    }
  });
}
