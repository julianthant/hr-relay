
import { expect } from "@playwright/test";
import { test } from "./helpers/fixtures.js";
import { PARITY_DIST_DIR } from "./helpers/bundle.js";
import { installTheme, PARITY_THEMES } from "./helpers/capture.js";
import { startFixtureServer } from "../support/helpers/dashboard/fixture-bff.js";
import { fixtureSettingsDocument } from "./helpers/fixture-settings.js";
import { buildSettingsNav } from "../../src/dashboard/surfaces/settings/settings-model.js";
import { settingsSearchIndex } from "../../src/dashboard/surfaces/settings/navigation/settings-search-model.js";

for (const theme of PARITY_THEMES) for (const width of [1024, 1440]) {
  test(`Settings search navigates and centers real controls @ ${theme.attribute}-${width}`, async ({ page }, _info) => {
    const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
    const errors: string[] = [], writes: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("request", request => { if (request.method() !== "GET") writes.push(new URL(request.url()).pathname); });
    try {
      await page.setViewportSize({ width, height: 900 });
      await installTheme(page, theme);
      await page.goto(`${server.baseUrl}/?settings=general`);
      const search = page.getByRole("searchbox", { name: "Search settings" });
      const clear = page.getByRole("button", { name: "Clear search", exact: true });
      await expect(clear).toHaveCount(0);
      await search.fill("backoff");
      await expect(clear).toBeVisible();
      await expect(page.locator(".settings-search-result")).toHaveCount(2);
      await expect(page.getByRole("link", { name: "Backoff base Performance" })).toBeVisible();
      await expect.poll(() => search.evaluate(element => getComputedStyle(element.parentElement!).boxShadow)).toBe("none");
      await search.press("ArrowDown");
      await expect(page.getByRole("link", { name: "Backoff base Performance" })).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(/settings=performance&settingsTarget=ocr.backoffBaseMs/u);
      const target = page.locator('[data-settings-path="ocr.backoffBaseMs"]');
      await expect(target).toBeVisible();
      await expect(target).toBeFocused();
      const centerDifference = () => target.evaluate(element => {
        const row = element.getBoundingClientRect(), container = document.querySelector("#dashboard-settings-content")!.getBoundingClientRect();
        return Math.abs(row.y + row.height / 2 - container.y - container.height / 2);
      });
      await expect.poll(centerDifference).toBeLessThanOrEqual(1);

      await expect(target).not.toHaveClass(/settings-search-arrival/u, { timeout: 3000 });
      await expect(search).toHaveValue("backoff");
      await page.getByRole("button", { name: /OCR processing/ }).click();
      await expect(target).toHaveCount(0);
      await page.getByRole("link", { name: "Backoff base Performance" }).click();
      await expect(target).toBeVisible();
      await expect.poll(centerDifference).toBeLessThanOrEqual(1);
      await page.reload();
      await expect(target).toBeFocused();
      await expect.poll(centerDifference).toBeLessThanOrEqual(1);

      await search.fill("CRM onboarding search");
      await page.getByRole("link", { name: "CRM · Onboarding search Routes" }).click();
      await expect(page.locator('[data-settings-path="urls.crm.prod.onboardingSearch"]')).toBeFocused();
      const routesSearch = page.getByRole("searchbox", { name: "Find a system or route" });
      await routesSearch.fill("UCPath");
      await page.getByRole("link", { name: "CRM · Onboarding search Routes" }).click();
      await expect(routesSearch).toHaveValue("");
      await expect(page.locator('[data-settings-path="urls.crm.prod.onboardingSearch"]')).toBeVisible();

      await search.fill("UCPath password");
      await page.getByRole("link", { name: "UCPath password Credentials" }).click();
      const password = page.locator('[data-settings-path="protected.ucpathPassword"]');
      await expect(password).toBeFocused();
      await expect(password.locator("input")).toHaveAttribute("type", "password");
      await search.fill("unknown setting name");
      await expect(page.getByText("No settings found", { exact: true })).toBeVisible();
      await clear.click();
      await expect(search).toHaveValue("");
      await expect(search).toBeFocused();
      await expect(page.locator('.settings-nav-group a')).toHaveCount(10);
      await expect(clear).toHaveCount(0);

      await search.fill("Dark theme");
      await page.getByRole("link", { name: "Dark theme General", exact: true }).click();
      const appearance = page.locator('[data-settings-path="appearance.theme"]');
      await expect(appearance).toBeFocused();
      await expect(appearance).toHaveClass(/settings-search-arrival/u);
      const cue = await appearance.evaluate(element => {
        const row = element.getBoundingClientRect(), group = element.closest(".ds-form-group")!, bounds = group.getBoundingClientRect();
        const style = getComputedStyle(element, "::before"), border = parseFloat(getComputedStyle(group).borderLeftWidth);
        return { left: row.left + parseFloat(style.left), right: row.right - parseFloat(style.right), groupLeft: bounds.left + border, groupRight: bounds.right - border };
      });
      expect(cue.left).toBeCloseTo(cue.groupLeft, 0);
      expect(cue.right).toBeCloseTo(cue.groupRight, 0);

      await expect(appearance).not.toHaveClass(/settings-search-arrival/u, { timeout: 3000 });
      expect(await appearance.evaluate(element => element.style.getPropertyValue("--settings-arrival-left"))).toBe("");
      await clear.click();

      for (const [section, label, value] of [
        ["routes", "Find a system or route", "CRM"], ["keyboard", "Search shortcuts", "search"],

      ]) {
        await page.goto(`${server.baseUrl}/?settings=${section}`);
        const field = page.getByLabel(label, { exact: true });
        await expect(field).toBeVisible();
        await field.fill(value);
        await expect.poll(() => field.evaluate(element => getComputedStyle(element.parentElement!).boxShadow)).toBe("none");
        const button = field.locator("xpath=../..").getByRole("button", { name: "Clear search" });
        await expect(button).toBeVisible();
        await expect(button.locator("svg")).toHaveCSS("width", "14px");
        await button.click();
        await expect(field).toHaveValue("");
        await expect(field).toBeFocused();
        await expect(button).toHaveCount(0);
      }
      await page.goto(`${server.baseUrl}/?settings=spreadsheets`);
      await expect(page.getByRole("searchbox", { name: "Find a spreadsheet", exact: true })).toHaveCount(0);
      const libraryOpen = page.getByRole("button", { name: "26–27 Student applicants.xlsx", exact: true });
      await libraryOpen.focus(); await libraryOpen.press("Enter");
      await expect(page.getByRole("region", { name: "Spreadsheet editor", exact: true })).toBeVisible();
      await page.getByRole("navigation", { name: "Breadcrumb", exact: true }).getByRole("button", { name: "Spreadsheets", exact: true }).click();
      await expect(libraryOpen).toBeFocused();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      expect(errors).toEqual([]);
      expect(writes).toEqual([]);
    } finally { await server.close(); }
  });
}

const indexedDocument = fixtureSettingsDocument();
const indexedTargets = settingsSearchIndex(buildSettingsNav([], indexedDocument), indexedDocument, true)
  .filter(result => result.target !== undefined);
for (const section of new Set(indexedTargets.map(result => result.entry.id))) {
test(`Every indexed setting in ${section} resolves to a visible destination, including folded groups`, async ({ page }) => {
  test.setTimeout(90000);
  const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
  try {
    await page.emulateMedia({ reducedMotion: "reduce" });
    for (const result of indexedTargets.filter(result => result.entry.id === section)) {
      await page.goto(`${server.baseUrl}/?${new URLSearchParams({ settings: result.entry.id, settingsTarget: result.target! })}`);
      const target = page.locator(`[data-settings-path="${result.target}"]`);
      await expect(target, result.label).toBeVisible();
      await expect(target, result.label).toBeFocused();
    }
  } finally { await server.close(); }
});
}

test("Setting targets retain reduced-motion and unavailable states", async ({ page }) => {
  test.setTimeout(90000);
  const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
  try {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`${server.baseUrl}/?settings=performance&settingsTarget=ocr.backoffBaseMs`);
    const row = page.locator('[data-settings-path="ocr.backoffBaseMs"]');
    await expect(row).toBeFocused();
    await expect.poll(() => row.evaluate(element => getComputedStyle(element, "::before").animationName)).toBe("none");
    await expect(row).not.toHaveClass(/settings-search-arrival/u, { timeout: 3000 });
    await page.goto(`${server.baseUrl}/?settings=general&settingsTarget=not-a-real-field`);
    await expect(page.getByText("Setting unavailable", { exact: true })).toBeVisible();
  } finally { await server.close(); }
});

void 0;

test("A path target waits for its verified authority without a false unavailable warning", async ({ page }) => {
  const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
  let release: (() => void) | undefined;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/v1/settings/storage-relocation", async route => { await pending; await route.continue(); });
  try {
    await page.goto(`${server.baseUrl}/?settings=paths&settingsTarget=paths.stateRoot`);
    await expect(page.getByRole("heading", { name: "Paths", exact: true })).toBeVisible();
    await expect(page.getByText("Reading app-data locations…", { exact: true })).toBeVisible();
    await expect(page.getByText("Setting unavailable", { exact: true })).toHaveCount(0);
    if (release === undefined) throw new Error("path read release unavailable");
    release();
    await expect(page.locator('[data-settings-path="paths.stateRoot"]')).toBeFocused();
  } finally { release?.(); await server.close(); }
});
