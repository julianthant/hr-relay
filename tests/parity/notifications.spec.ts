import { createHash } from "node:crypto";
import { PARITY_THEMES, installTheme, assertThemeApplied } from "./helpers/capture.js";
import { expect, test, type Page } from "@playwright/test";
import { gotoAppState } from "./helpers/app-driver.js";
import { PARITY_DIST_DIR, ensureParityBundle } from "./helpers/bundle.js";
import { startFixtureServer, fixtureSnapshotEnvelope, type FixtureServer } from "./helpers/fixture-bff.js";
import { BACKFILL_GAP_DAY_WIRE } from "./helpers/fixture-queue.js";
import { FIXTURE_DAY, uuidOf } from "./helpers/fixture-identity.js";
import { NotificationWireSchema } from "../../src/domain/dashboard/projection.js";

let server: FixtureServer;
test.beforeAll(() => ensureParityBundle());
test.beforeEach(async () => { server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" }, dayWire: BACKFILL_GAP_DAY_WIRE }); });
test.afterEach(async () => { await server.close(); });
test.use({ viewport: { width: 1024, height: 720 } });
async function notifications(page: Page, permission: "granted" | "denied" | "default" = "granted") {
  await page.route("**/api/v1/notifications/status", route => route.fulfill({ json: { state: "ready", pending: 0 } }));
  await page.route("**/api/v1/notifications", route => route.fulfill({ json: BACKFILL_GAP_DAY_WIRE.notifications }));
  await page.addInitScript(value => {
    const scope = window as unknown as { deliveries: { title: string; silent: boolean }[]; failDelivery: boolean; deliveryError?: () => void };
    scope.deliveries = []; scope.failDelivery = false;
    class DesktopNotification {
      static permission = "default";
      static async requestPermission() { DesktopNotification.permission = value; return value; }
      onerror: (() => void) | null = null;
      constructor(title: string, options: { silent: boolean }) {
        if (scope.failDelivery) throw new Error("synthetic constructor failure");
        scope.deliveries.push({ title, silent: options.silent });
        scope.deliveryError = () => this.onerror?.();
      }
    }
    Object.defineProperty(window, "Notification", { configurable: true, value: DesktopNotification });
  }, permission);
}
const delivered = (page: Page) => page.evaluate(() => (window as unknown as { deliveries: unknown[] }).deliveries);
async function open(page: Page) { const bell = page.getByRole("button", { name: /Notifications/u }); await bell.focus(); await page.keyboard.press("Enter"); await expect(page.getByRole("dialog", { name: "Notifications" })).toBeVisible(); }
function publish(n: number, changes = {}) {
  const row = NotificationWireSchema.parse({ kind: "notification", notificationId: uuidOf(910), actorId: "local-operator", channel: "ping", count: n, publicationId: n.toString(16).repeat(64), trigger: "failed", readState: "unread", severity: "error", title: "Run failed", state: "unread", occurredAt: BACKFILL_GAP_DAY_WIRE.notifications[0].occurredAt, revision: n, ...changes });
  const envelope = fixtureSnapshotEnvelope({ ...BACKFILL_GAP_DAY_WIRE, notifications: [...BACKFILL_GAP_DAY_WIRE.notifications, row] });
  server.publish({ ...envelope, cursor: `pc:${100 + n}` } as typeof envelope);
}
for (const theme of PARITY_THEMES) {
  test(`inbox remains keyboard accessible, bounded and readable in ${theme.name}`, { annotation: [{ type: "required-a11y-evidence", description: `notifications-${theme.name}.a11y.yml` }] }, async ({ page }, info) => {
    await installTheme(page, theme);
    await notifications(page);
    await gotoAppState(page, server.baseUrl, { day: FIXTURE_DAY });
    await assertThemeApplied(page, theme);
    await open(page);
    const drawer = page.getByRole("dialog", { name: "Notifications" });
    for (const label of [/All 8/u, /Unread 7/u, /Pings 7/u, /Inbox 1/u, /Snoozed 0/u]) {
      await drawer.getByRole("button", { name: label }).click();
      await expect(drawer.locator("[data-backfill-gap='pinned']")).toHaveCount(6);
    }
    await drawer.getByRole("button", { name: "All 8" }).click();
    await drawer.getByRole("button", { name: "Enable desktop pings" }).click();
    await expect(drawer.getByText("Desktop pings enabled", { exact: true })).toBeVisible();
    expect(await delivered(page)).toEqual([]);
    await page.screenshot({ path: info.outputPath(`notifications-${theme.name}.png`) });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.evaluate(() => { document.documentElement.style.zoom = "1.25"; });
    expect(await drawer.locator("[data-notification-scroll]").evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
    await drawer.getByText("Onboarding cohort — July stragglers completed").scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath(`notifications-${theme.name}-zoom.png`) });
    const tree = await page.locator("body").ariaSnapshot();
    const evidence = `notifications-${theme.name}.a11y.yml`;
    info.annotations.push({ type: `a11y-attachment-sha256:${evidence}`, description: createHash("sha256").update(tree).digest("hex") });
    await info.attach(evidence, { body: tree, contentType: "text/yaml" });
    await page.keyboard.press("Escape"); await expect(drawer).toBeHidden();
    await expect(page.getByRole("button", { name: /Notifications/u })).toBeFocused();
  });
}
test("one real Web Locks owner delivers silent new Pings across two tabs and owner closure", async ({ page, context }) => {
  await notifications(page); await gotoAppState(page, server.baseUrl, { day: FIXTURE_DAY }); await open(page);
  await page.getByRole("button", { name: "Enable desktop pings" }).click();
  await expect(page.getByText("Desktop pings enabled", { exact: true })).toBeVisible();
  const second = await context.newPage(); await notifications(second); await gotoAppState(second, server.baseUrl, { day: FIXTURE_DAY }); await open(second);
  await second.getByRole("button", { name: "Enable desktop pings" }).click();
  await expect(second.getByText("Desktop pings enabled in another tab")).toBeVisible();
  publish(1); await expect.poll(async () => (await delivered(page)).length).toBe(1); expect(await delivered(second)).toEqual([]);
  expect(await delivered(page)).toEqual([{ title: "Run failed", silent: true }]);
  publish(1); publish(2, { state: "snoozed" }); publish(3, { channel: "inbox", trigger: "verified-done" });
  await expect(second.getByRole("button", { name: "All 9" })).toBeVisible();
  expect(await delivered(page)).toHaveLength(1);
  await page.close(); await expect(second.getByText("Desktop pings enabled", { exact: true })).toBeVisible();
  expect(await delivered(second)).toEqual([]);
  publish(4); await expect.poll(async () => (await delivered(second)).length).toBe(1);
  await second.evaluate(() => { (window as unknown as { deliveryError(): void }).deliveryError(); });
  await expect(second.getByText(/Desktop delivery failed/u)).toBeVisible();
  await second.evaluate(() => { (window as unknown as { failDelivery: boolean }).failDelivery = true; });
  publish(5); await expect(second.getByText(/Desktop delivery failed/u)).toBeVisible();
  await second.reload(); await open(second); await second.getByRole("button", { name: "Enable desktop pings" }).click();
  await expect(second.getByText("Desktop pings enabled", { exact: true })).toBeVisible(); expect(await delivered(second)).toEqual([]);
});
for (const permission of ["denied", "default"] as const) test(`shows ${permission} permission without changing durable rows`, async ({ page }) => {
  await notifications(page, permission); await gotoAppState(page, server.baseUrl, { day: FIXTURE_DAY }); await open(page);
  await page.getByRole("button", { name: "Enable desktop pings" }).click();
  await expect(page.getByText(permission === "denied" ? "Blocked in browser settings" : "Permission not granted")).toBeVisible();
  await expect(page.getByRole("button", { name: "All 8" })).toBeVisible(); expect(await delivered(page)).toEqual([]);
});

test("unsupported desktop APIs and notification observation failure remain explicit", async ({ page }) => {
  await notifications(page); await page.addInitScript(() => { Object.defineProperty(navigator, "locks", { configurable: true, value: undefined }); });
  await page.route("**/api/v1/notifications/status", route => route.fulfill({ json: { state: "failed", pending: 1, code: "NOTIFICATION_OBSERVATION_FAILED" } }));
  await gotoAppState(page, server.baseUrl, { day: FIXTURE_DAY }); await open(page);
  await page.getByRole("button", { name: "Enable desktop pings" }).click();
  await expect(page.getByText("Desktop pings unavailable in this browser")).toBeVisible();
  await expect(page.getByText("Some notifications could not be published. Observation will retry.")).toBeVisible();
});
test("notification navigation preserves a cancelled Settings draft and rechecks an accepted exit", async ({ page }) => {
  await notifications(page); await gotoAppState(page, server.baseUrl, { day: FIXTURE_DAY, settings: "display" });
  const width = page.getByRole("spinbutton").first(); await width.fill("1777");
  let targets = 0;
  await page.route("**/api/v1/notifications/*/target", route => { targets += 1; return route.fulfill({ json: { kind: "run", runId: uuidOf(5), day: "2026-07-03" } }); });
  publish(1, { link: { kind: "run", runId: uuidOf(5) } }); await open(page);
  const openRun = page.getByRole("button", { name: "Open run", exact: true }); await openRun.scrollIntoViewIfNeeded(); await openRun.click();
  await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  expect(targets).toBe(1); expect(new URL(page.url()).searchParams.get("settings")).toBe("display");
  await page.keyboard.press("Escape"); await expect(width).toHaveValue("1777"); await open(page);
  await openRun.scrollIntoViewIfNeeded(); await openRun.click(); await page.getByRole("button", { name: "Discard changes", exact: true }).click();
  await expect(page).toHaveURL(/day=2026-07-03/); expect(targets).toBe(3); expect(new URL(page.url()).searchParams.has("settings")).toBe(false);
});
