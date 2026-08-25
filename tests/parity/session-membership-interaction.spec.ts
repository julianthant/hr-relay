/**
 * Rendered focus contract for P4's bounded Session Panel list.
 *
 * The hostile wire contains 1,240 members, so keyboard navigation and native
 * scrolling both cross real mount boundaries. Assertions stay on browser
 * focus, rendered rows, and the existing authority-details popover rather than
 * reading the component's virtualization refs.
 */
import { expect, test } from "@playwright/test";
import { DashboardDayWireSchema } from "../../src/domain/dashboard/projection.js";
import { PARITY_DIST_DIR, ensureParityBundle } from "./helpers/bundle.js";
import { gotoAppState } from "./helpers/app-driver.js";
import { startFixtureServer, type FixtureServer } from "./helpers/fixture-bff.js";
import { FIXTURE_DAY, FIXTURE_DAY_WIRE, uuidOf } from "./helpers/fixture-day.js";

const SESSION_ID = uuidOf(700);
const TOTAL_LAYOUT_ROWS = 1_241;

const HOSTILE_SESSION_DAY = DashboardDayWireSchema.parse({
  ...FIXTURE_DAY_WIRE,
  queueSurfaces: Array.from({ length: 1_240 }, (_, index) => ({
    ...FIXTURE_DAY_WIRE.queueSurfaces[0],
    runId: uuidOf(10_000 + index),
    title: `Long session subject ${String(index)} — Nguyễn, Thi — every authority member remains reachable`,
    session: { state: "present", sessionId: SESSION_ID },
  })),
});

let server: FixtureServer;

test.beforeAll(async () => {
  ensureParityBundle();
  server = await startFixtureServer({
    distDir: PARITY_DIST_DIR,
    bundle: { proof: "working-tree" },
    dayWire: HOSTILE_SESSION_DAY,
  });
});

test.afterAll(async () => {
  await server.close();
});

test("virtual membership keeps one coherent row focus through navigation, scroll, and details", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoAppState(page, server.baseUrl, { day: FIXTURE_DAY });
  await page.getByRole("button", { name: /^Sessions/u }).click();

  const membership = page.getByRole("list", { name: /Session membership/u });
  const mountedRows = membership.locator("[data-session-virtual-row]");
  const rowTabStops = membership.locator("[data-session-virtual-row][tabindex='0']");
  await expect(membership).toBeVisible();
  await expect(rowTabStops).toHaveCount(1);
  await expect(mountedRows).toHaveCount(8);

  await rowTabStops.focus();
  await page.keyboard.press("End");
  const farRow = membership.locator(`[data-session-row-index='${String(TOTAL_LAYOUT_ROWS - 1)}']`);
  await expect(farRow).toBeFocused();
  await expect(farRow).toHaveAttribute("data-session-active", "true");
  await expect(rowTabStops).toHaveCount(1);

  await membership.hover();
  await page.mouse.wheel(0, -100_000);
  await expect.poll(async () => membership.evaluate((node) => node.scrollTop)).toBe(0);
  const visibleRovingRow = membership.locator("[data-session-virtual-row][tabindex='0']");
  await expect(visibleRovingRow).toBeFocused();
  await expect(visibleRovingRow).toHaveAttribute("data-session-active", "true");
  await expect(visibleRovingRow).toBeInViewport();
  await expect(rowTabStops).toHaveCount(1);

  await page.keyboard.press("End");
  await expect(farRow).toBeFocused();
  await page.keyboard.press("End");
  await page.keyboard.press("Tab");
  const details = farRow.getByRole("button", { name: /^Show full details for Long session subject 1239/u });
  await expect(details).toBeFocused();
  await page.keyboard.press("Enter");
  const popover = page.getByRole("dialog", { name: "Session member" });
  const authorityFocus = page.locator(
    `[data-session-row-index='${String(TOTAL_LAYOUT_ROWS - 1)}'] button:focus, [role='dialog'][aria-label='Session member']:focus, [role='dialog'][aria-label='Session member'] :focus`,
  );
  await expect(popover).toBeVisible();
  await expect(authorityFocus).toHaveCount(1);

  await page.setViewportSize({ width: 1440, height: 720 });
  await expect(popover).toBeVisible();
  await expect(authorityFocus).toHaveCount(1);
  await expect(rowTabStops).toHaveCount(1);
});

test("focused authority trigger transfers to the visible row before its owner unmounts", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoAppState(page, server.baseUrl, { day: FIXTURE_DAY });
  await page.getByRole("button", { name: /^Sessions/u }).click();

  const membership = page.getByRole("list", { name: /Session membership/u });
  const firstRow = membership.locator("[data-session-row-index='0']");
  const details = firstRow.getByRole("button", { name: /^Show full details for session/u });
  await details.focus();
  await expect(details).toBeFocused();

  await membership.hover();
  await page.mouse.wheel(0, 100_000);
  await expect.poll(async () => membership.evaluate((node) =>
    Math.round(node.scrollHeight - node.clientHeight - node.scrollTop),
  )).toBe(0);
  await expect(firstRow).toHaveCount(0);

  const visibleRovingRow = membership.locator("[data-session-virtual-row][tabindex='0']");
  await expect(visibleRovingRow).toHaveCount(1);
  await expect(visibleRovingRow).toBeInViewport();
  await expect(visibleRovingRow).toBeFocused();
});

test("focused authority popover closes and transfers before its owner unmounts", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoAppState(page, server.baseUrl, { day: FIXTURE_DAY });
  await page.getByRole("button", { name: /^Sessions/u }).click();

  const membership = page.getByRole("list", { name: /Session membership/u });
  const rowTabStops = membership.locator("[data-session-virtual-row][tabindex='0']");
  await rowTabStops.focus();
  await page.keyboard.press("End");
  const farRow = membership.locator(`[data-session-row-index='${String(TOTAL_LAYOUT_ROWS - 1)}']`);
  await page.keyboard.press("Tab");
  await farRow.getByRole("button", { name: /^Show full details for Long session subject 1239/u }).press("Enter");

  const popover = page.getByRole("dialog", { name: "Session member" });
  const close = popover.getByRole("button", { name: "Close" });
  await expect(popover).toBeVisible();
  await expect(close).toBeFocused();

  await membership.hover();
  await page.mouse.wheel(0, -40);
  await expect(popover).toBeVisible();
  await expect(close).toBeFocused();

  await page.mouse.wheel(0, -100_000);
  await expect.poll(async () => membership.evaluate((node) => node.scrollTop)).toBe(0);
  await expect(farRow).toHaveCount(0);
  await expect(popover).toHaveCount(0);

  const visibleRovingRow = membership.locator("[data-session-virtual-row][tabindex='0']");
  await expect(visibleRovingRow).toHaveCount(1);
  await expect(visibleRovingRow).toBeInViewport();
  await expect(visibleRovingRow).toBeFocused();
});
