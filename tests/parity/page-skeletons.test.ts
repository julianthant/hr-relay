
import { expect, type Locator } from "@playwright/test";
import { test } from "./helpers/fixtures.js";
import { PARITY_DIST_DIR } from "./helpers/bundle.js";
import { installTheme, PARITY_THEMES } from "./helpers/capture.js";
import { startFixtureServer } from "../support/helpers/dashboard/fixture-bff.js";
import { FIXTURE_INTAKE_IDS } from "../support/fixtures/dashboard/fixture-intake.js";

async function bounds(locator: Locator) {
  return locator.evaluateAll(nodes => nodes.map(node => {
    const rect = node.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  }));
}



for (const theme of PARITY_THEMES) for (const width of [1024, 1440]) {
  test(`Settings skeletons keep each page's groups and controls @ ${theme.attribute} ${width}`, async ({ page }) => {
    const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.setViewportSize({ width, height: width === 1024 ? 720 : 1000 });
    await installTheme(page, theme);
    await page.emulateMedia({ reducedMotion: "reduce" });
    try {
      for (const section of ["performance"]) {
        let release!: () => void;
        const pending = new Promise<void>(resolve => { release = resolve; });
        await page.route("**/api/v1/settings/editable", async route => { await pending; await route.continue(); });
        try {
          await page.goto(`${server.baseUrl}/?settings=${section}`);
          const body = page.locator(".settings-tab-body");
          const loading = body.locator(`[data-settings-loading="${section}"]`);
          await expect(loading).toBeVisible();
          await expect(loading.locator('[data-slot="skeleton"]').first()).toBeVisible();
          expect(await loading.locator('[data-slot="skeleton"]').evaluateAll(nodes => nodes.every(node => node.getAttribute("aria-hidden") === "true" && getComputedStyle(node).animationName === "none"))).toBe(true);
          expect(await loading.locator('[data-slot="skeleton"]').evaluateAll(nodes => nodes.every(node => node.getBoundingClientRect().width > 0))).toBe(true);
          const groupsBefore = await bounds(body.locator(".ds-body-section > .ds-form-group"));
          const titlesBefore = await body.locator(".ds-body-section-heading").allTextContents();
          const headingBefore = await bounds(body.locator(".ds-page-heading"));

          release();
          await expect(loading).toHaveCount(0);
          const groupsAfter = await bounds(body.locator(".ds-body-section > .ds-form-group"));
          expect(await body.locator(".ds-body-section-heading").allTextContents()).toEqual(titlesBefore);
          expect(await bounds(body.locator(".ds-page-heading"))).toEqual(headingBefore);
          expect(groupsAfter).toHaveLength(groupsBefore.length);
          groupsBefore.forEach((group, index) => {
            expect(Math.abs(group.x - groupsAfter[index].x)).toBeLessThanOrEqual(1);
            expect(Math.abs(group.width - groupsAfter[index].width)).toBeLessThanOrEqual(1);
          });
          groupsBefore.slice(0, 3).forEach((group, index) => {
            expect(Math.abs(group.height - groupsAfter[index].height), `${section} group ${index} height`).toBeLessThanOrEqual(2);
            expect(Math.abs(group.y - groupsAfter[index].y), `${section} group ${index} top`).toBeLessThanOrEqual(2);
          });
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        } finally { release(); await page.unroute("**/api/v1/settings/editable"); }
      }
      expect(errors).toEqual([]);
    } finally { await server.close(); }
  });

  test(`Notification and session skeletons use their rail and worker cards @ ${theme.attribute} ${width}`, async ({ page }, _info) => {
    const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
    try {
      await page.setViewportSize({ width, height: width === 1024 ? 720 : 1000 });
      await installTheme(page, theme);
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(`${server.baseUrl}/?day=2026-08-03&notificationsPreview=loading&sessionsPreview=loading&view=${encodeURIComponent(JSON.stringify({ notifications: true, sessions: true }))}`);
      const rail = page.getByRole("complementary", { name: "Workspace", exact: true });
      await expect(rail.getByRole("button", { name: /^Notifications/u })).toHaveAttribute("aria-pressed", "true");
      const inbox = rail.getByRole("region", { name: "Notifications", exact: true });
      await expect(inbox.getByRole("status", { name: "Loading notifications", exact: true })).toBeVisible();
      const listBefore = (await bounds(inbox.getByRole("status", { name: "Loading notifications", exact: true })))[0];
      await expect(page.getByRole("button", { name: /^Sessions\b/ })).toHaveAttribute("aria-expanded", "true");
      const sessions = page.getByRole("status", { name: "Loading sessions", exact: true });
      await expect(sessions).toBeVisible();
      const cardsBefore = await bounds(sessions.locator(":scope > div"));

      await page.goto(`${server.baseUrl}/?day=2026-08-03`);
      await rail.getByRole("button", { name: /^Notifications/u }).click();
      await expect(inbox.locator("button.notification-item").first()).toBeVisible();
      const listAfter = (await bounds(inbox.locator(".notification-group").first()))[0];
      expect(listBefore.x).toBe(listAfter.x);
      expect(listBefore.width).toBe(listAfter.width);
      await page.getByRole("button", { name: /^Sessions\b/ }).click();
      const cardsAfter = await bounds(page.locator("[data-session-strip] > article"));
      expect(cardsAfter.length).toBeGreaterThanOrEqual(cardsBefore.length);
      cardsBefore.forEach((card, index) => { expect(card.x).toBe(cardsAfter[index].x); expect(card.width).toBe(cardsAfter[index].width); });
      await page.goto(`${server.baseUrl}/?day=2026-08-03&notificationsPreview=unavailable&sessionsPreview=unavailable&view=${encodeURIComponent(JSON.stringify({ notifications: true, sessions: true }))}`);
      await expect(inbox.getByRole("alert")).toContainText("Notifications unavailable");
      await expect(page.getByRole("region", { name: "Session Panel", exact: true }).getByRole("alert")).toContainText("Sessions unavailable");
      await expect(page.locator('[data-slot="skeleton"]')).toHaveCount(0);
    } finally { await server.close(); }
  });
}

test("Initial bootstrap and queue loads remain distinct from errors and empty data", async ({ page }) => {
  const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
  let releaseBoot!: () => void, releaseDay!: () => void;
  const boot = new Promise<void>(resolve => { releaseBoot = resolve; });
  const day = new Promise<void>(resolve => { releaseDay = resolve; });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("**/api/v1/bootstrap", async route => { await boot; await route.continue(); });
  await page.route("**/events/v1?*", async route => { await day; await route.continue(); });
  try {
    await page.goto(`${server.baseUrl}/?day=2026-08-03`);
    await expect(page.getByRole("status", { name: "Starting dashboard", exact: true })).toBeVisible();
    await expect(page.locator('[data-slot="skeleton"]').first()).toBeVisible();
    releaseBoot();
    await expect(page.getByRole("status", { name: "Loading queue", exact: true })).toBeVisible();
    await expect(page.getByText("No workflows available", { exact: true })).toHaveCount(0);
    releaseDay();
    await expect(page.getByRole("status", { name: "Loading queue", exact: true })).toHaveCount(0);
    await page.unroute("**/events/v1?*");
    await page.route("**/events/v1?*", route => route.fulfill({ status: 503, json: { state: "error", code: "TEST_QUEUE_UNAVAILABLE", message: "Queue temporarily unavailable", retryable: true } }));
    await page.reload();
    await expect(page.getByText("Could not load queue", { exact: true })).toBeVisible();
    await expect(page.getByRole("status", { name: "Loading queue", exact: true })).toHaveCount(0);

  } finally { releaseBoot(); releaseDay(); await server.close(); }
});

test("OCR page skeleton fills the fixed PDF frame until its image arrives", async ({ page }, _info) => {
  const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const asset = "**/assets/multiple-oath-1-*.webp";
  await page.route(asset, async route => { await pending; await route.continue(); });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const logs = page.getByRole("region", { name: "Selected run logs", exact: true });
  const review = page.getByRole("dialog", { name: /^Review records/u });
  const record = review.getByRole("region", { name: "Record person-1", exact: true });
  const source = record.getByRole("region", { name: "Source PDF", exact: true });
  async function openReview() {
    await page.goto(`${server.baseUrl}/?day=2026-08-03`);
    await page.getByRole("navigation", { name: "Workflows", exact: true }).getByRole("button", { name: "Oath Upload", exact: true }).click();
    await logs.getByRole("button", { name: /^Records \d+$/u }).click();
  }
  try {
    await openReview();
    const loading = source.getByRole("status", { name: "Loading source PDF", exact: true });
    await expect(loading).toBeVisible();
    const before = await bounds(source.locator("[data-review-preview]"));
    const placeholder = (await bounds(loading))[0];
    expect(Math.abs(placeholder.width - before[0].width)).toBeLessThanOrEqual(2);
    expect(Math.abs(placeholder.height - before[0].height)).toBeLessThanOrEqual(2);
    await expect(source.getByRole("button", { name: "Zoom in", exact: true })).toBeDisabled();
    await expect(record.getByRole("textbox", { name: "Employee ID", exact: true })).toBeEnabled();

    release();
    await expect(loading).toHaveCount(0);
    await expect(source.getByRole("button", { name: "Zoom in", exact: true })).toBeEnabled();
    const after = await bounds(source.locator("[data-review-preview]"));
    expect(before[0].width).toBe(after[0].width);
    expect(Math.abs(before[0].height - after[0].height)).toBeLessThanOrEqual(2);
    await page.unroute(asset);
    await page.route(asset, route => route.fulfill({ status: 404, body: "Source missing" }));
    await openReview();
    await expect(source).toContainText("Source page unavailable");
    await expect(loading).toHaveCount(0);
    await expect(source.getByRole("button", { name: "Zoom in", exact: true })).toBeDisabled();
  } finally { release(); await server.close(); }
});

test("Intake loading preserves its source, mapping columns and bottom actions", async ({ page }, _info) => {
  const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const path = `**/api/v1/intake/${FIXTURE_INTAKE_IDS.mapping}`;
  await page.route(path, async route => { await pending; await route.continue(); });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  try {
    await page.goto(`${server.baseUrl}/?day=2026-08-03&intake=${FIXTURE_INTAKE_IDS.mapping}`);
    const frame = page.getByRole("region", { name: "Spreadsheet intake", exact: true });
    const loading = frame.getByRole("status", { name: "Loading intake session", exact: true });
    await expect(loading).toBeVisible();
    await expect(frame.getByRole("status", { name: "Loading intake actions", exact: true })).toBeVisible();
    const before = await bounds(loading.locator("table"));
    const headings = await loading.locator("th").allTextContents();
    expect(headings).toEqual(["Target field", "Bound column", "Suggestion"]);

    release();
    await expect(loading).toHaveCount(0);
    const mapping = frame.getByRole("table", { name: /^Column mapping for /u });
    await expect(mapping).toBeVisible();
    expect(await mapping.locator("th").allTextContents()).toEqual(headings);
    const after = await bounds(mapping);
    expect(after[0].x).toBe(before[0].x);
    expect(after[0].width).toBe(before[0].width);
    await expect(frame.getByRole("button", { name: "Validate", exact: true })).toBeVisible();
  } finally { release(); await server.close(); }
});
