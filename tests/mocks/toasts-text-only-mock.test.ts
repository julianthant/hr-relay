import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page } from "@playwright/test";
import { test } from "./helpers/fixtures.js";
import { mockOutDir } from "./helpers/out-dir.js";

// A toast is text only, one per event, and covers no toolbar or title. Frames are evidence, never test references.
const OUT = mockOutDir(process.env.TOASTS_TEXT_ONLY_MOCK_OUT, "toasts-text-only");
const WIDTHS = [1280, 1024] as const;
const toasts = (page: Page) => page.locator('[data-slot="toast"]');
const loseReplies = (page: Page) => page.route("**/commands", route => route.request().method() === "POST" ? route.abort("connectionreset") : route.continue());

test.beforeAll(() => { mkdirSync(OUT, { recursive: true }); });

for (const width of WIDTHS) test(`one Settings failure is one text-only toast clear of the title @ dark ${width}`, async ({ page, hubServer }) => {
  await page.setViewportSize({ width, height: 720 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`${hubServer.baseUrl}/?fixture=product-workflows&settings=general`);
  await page.getByRole("radio", { name: "Dark" }).check({ force: true });
  const control = page.getByRole("switch", { name: "Prevent sleep while running" });
  await expect(control).toBeEnabled();
  await loseReplies(page);
  await control.click();
  await expect(toasts(page).first()).toBeVisible({ timeout: 8000 });
  await expect(toasts(page)).toHaveCount(1);
  await expect(toasts(page).locator("button")).toHaveCount(0);
  const toast = await toasts(page).first().boundingBox();
  const title = await page.getByRole("heading", { level: 1 }).first().boundingBox();
  expect(toast && title && (toast.y >= title.y + title.height || toast.y + toast.height <= title.y)).toBeTruthy();
  await page.screenshot({ path: join(OUT, `settings-dark-${width}.png`) });
});

for (const width of WIDTHS) test(`a toast over the queue leaves Start run and Status visible @ dark ${width}`, async ({ page, hubServer }) => {
  await page.setViewportSize({ width, height: 720 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`${hubServer.baseUrl}/?fixture=product-workflows&settings=general`);
  await page.getByRole("radio", { name: "Dark" }).check({ force: true });
  await page.goto(`${hubServer.baseUrl}/?fixture=product-workflows`);
  const start = page.getByRole("button", { name: "Start run" }).first();
  await expect(start).toBeVisible();
  await loseReplies(page);
  const panel = page.getByRole("region", { name: "Session Panel" });
  await panel.getByRole("button", { name: /Sessions/u, expanded: false }).click();
  await panel.getByRole("button", { name: /^(Pause|Remove worker)$/u }).first().click();
  await expect(toasts(page).first()).toBeVisible({ timeout: 8000 });
  await expect(toasts(page).locator("button")).toHaveCount(0);
  const box = (await toasts(page).first().boundingBox())!;
  for (const control of [start, page.locator("button", { hasText: /^Status/u }).first()]) {
    const target = await control.boundingBox();
    expect(target === null || target.y + target.height <= box.y || target.y >= box.y + box.height).toBeTruthy();
  }
  await page.screenshot({ path: join(OUT, `queue-dark-${width}.png`) });
});

test("a worker Pause the server accepts raises no toast", async ({ page, hubServer }) => {
  await page.goto(`${hubServer.baseUrl}/?fixture=product-workflows`);
  const panel = page.getByRole("region", { name: "Session Panel" });
  await panel.getByRole("button", { name: /Sessions/u, expanded: false }).click();
  const control = panel.getByRole("button", { name: /^Pause$/u }).first();
  await expect(control).toBeEnabled();
  await control.click();
  await page.waitForTimeout(2500);
  await expect(toasts(page)).toHaveCount(0);
});
