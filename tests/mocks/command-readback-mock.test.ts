import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page } from "@playwright/test";
import { test } from "./helpers/fixtures.js";
import { mockOutDir } from "./helpers/out-dir.js";

// A command whose reply is lost: Relay reads the result back itself and shows only the result. Frames are evidence, never test references.
const OUT = mockOutDir(process.env.COMMAND_READBACK_MOCK_OUT, "command-readback");
const WIDTHS = [1280, 1024] as const;
const UNCERTAIN = /outcome is uncertain|Check outcome|Retry exact attempt|unconfirmed/u;

/** Every command the page sends from here on reaches no server and gets no reply. */
const loseReplies = (page: Page) => page.route("**/commands", route => route.request().method() === "POST" ? route.abort("connectionreset") : route.continue());
const toast = (page: Page, text: RegExp) => page.locator('[data-slot="toast"]').filter({ hasText: text });

test.beforeAll(() => { mkdirSync(OUT, { recursive: true }); });

for (const width of WIDTHS) test(`a lost Settings save settles from its read-back @ dark ${width}`, async ({ page, hubServer }) => {
  await page.setViewportSize({ width, height: 720 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`${hubServer.baseUrl}/?fixture=product-workflows&settings=general`);
  await page.getByRole("radio", { name: "Dark" }).check({ force: true });
  const control = page.getByRole("switch", { name: "Prevent sleep while running" });
  await expect(control).toBeEnabled();
  const before = await control.isChecked();
  await loseReplies(page);
  await control.click();
  await expect(toast(page, /weren't saved/u)).toBeVisible({ timeout: 8000 });
  await page.screenshot({ path: join(OUT, `settings-general-dark-${width}.png`) });
  await expect(page.getByText(UNCERTAIN)).toHaveCount(0);
  await expect(control).toBeEnabled();
  expect(await control.isChecked()).toBe(before);
});

for (const width of WIDTHS) test(`a lost worker control settles from its read-back @ dark ${width}`, async ({ page, hubServer }) => {
  await page.setViewportSize({ width, height: 720 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`${hubServer.baseUrl}/?fixture=product-workflows&settings=general`);
  await page.getByRole("radio", { name: "Dark" }).check({ force: true });
  await page.goto(`${hubServer.baseUrl}/?fixture=product-workflows`);
  const panel = page.getByRole("region", { name: "Session Panel" });
  await panel.getByRole("button", { name: /Sessions/u, expanded: false }).click();
  const control = panel.getByRole("button", { name: /^(Pause|Remove worker)$/u }).first();
  await expect(control).toBeEnabled();
  await loseReplies(page);
  await control.click();
  await expect(toast(page, /^Couldn't/u)).toBeVisible({ timeout: 8000 });
  await page.screenshot({ path: join(OUT, `sessions-panel-dark-${width}.png`) });
  await expect(page.getByText(UNCERTAIN)).toHaveCount(0);
  await expect(control).toBeEnabled();
});
