import { expect, test } from "@playwright/test";
import { PROVIDER_KEYS_SCHEMA_HASH } from "../../src/domain/config/provider-keys.js";
import { EditableSettingsWireSchema } from "../../src/domain/dashboard/settings-editor.js";
import { ensureParityBundle, PARITY_DIST_DIR } from "./helpers/bundle.js";
import { installTheme, PARITY_THEMES } from "./helpers/capture.js";
import { startFixtureServer } from "./helpers/fixture-bff.js";
import { fixtureSettingsDocument } from "./helpers/fixture-settings.js";
import { buildSettingsNav } from "../../src/dashboard/surfaces/settings-model.js";
import { settingsSearchIndex } from "../../src/dashboard/surfaces/settings-search-model.js";

for (const theme of PARITY_THEMES) for (const width of [1024, 1440]) {
  test(`Settings search navigates and centers real controls @ ${theme.attribute}-${width}`, async ({ page }, info) => {
    ensureParityBundle();
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
      await info.attach(`settings-result-${theme.attribute}-${width}.png`, { body: await page.screenshot(), contentType: "image/png" });
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

      await search.fill("Census daily request limit");
      await page.getByRole("link", { name: "Census geocoding · Daily request limit Provider budgets & models" }).click();
      await expect(page.locator('[data-settings-path="providers.geocodeCensus.dailyRequestLimit"]')).toBeFocused();
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
      await expect(page.locator('.settings-nav-group a')).toHaveCount(14);
      await expect(clear).toHaveCount(0);

      for (const [section, label, value] of [
        ["routes", "Find a system or route", "CRM"], ["keyboard", "Search shortcuts", "search"],
        ["spreadsheets", "Find a spreadsheet", "student"], ["archive", "Search saved reports", "Jordan"],
        ["ui-catalog", "Search the UI catalog by id, label, system or search term", "UCPath"],
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
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      expect(errors).toEqual([]);
      expect(writes).toEqual([]);
    } finally { await server.close(); }
  });
}

test("Every indexed setting resolves to a visible destination, including folded groups", async ({ page }) => {
  test.setTimeout(90000);
  ensureParityBundle();
  const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
  try {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const document = fixtureSettingsDocument();
    const index = settingsSearchIndex(buildSettingsNav([], document), document, true);
    for (const result of index.filter(result => result.target !== undefined)) {
      await page.goto(`${server.baseUrl}/?${new URLSearchParams({ settings: result.entry.id, settingsTarget: result.target! })}`);
      const target = page.locator(`[data-settings-path="${result.target}"]`);
      await expect(target, result.label).toBeVisible();
      await expect(target, result.label).toBeFocused();
    }
    await page.goto(`${server.baseUrl}/?settings=performance&settingsTarget=ocr.backoffBaseMs`);
    const row = page.locator('[data-settings-path="ocr.backoffBaseMs"]');
    await expect(row).toBeFocused();
    await expect.poll(() => row.evaluate(element => getComputedStyle(element, "::before").animationName)).toBe("none");
    await expect(row).not.toHaveClass(/settings-search-arrival/u, { timeout: 3000 });
    await page.goto(`${server.baseUrl}/?settings=general&settingsTarget=not-a-real-field`);
    await expect(page.getByText("Setting unavailable", { exact: true })).toBeVisible();
  } finally { await server.close(); }
});

test("Search navigation preserves invalid drafts and the Settings exit guard", async ({ page }) => {
  ensureParityBundle();
  const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
  const writes: string[] = [];
  page.on("request", request => { if (request.method() !== "GET") writes.push(new URL(request.url()).pathname); });
  try {
    await page.goto(`${server.baseUrl}/?settings=general`);
    const width = page.getByRole("spinbutton", { name: "Browser viewport width" });
    await width.fill("0");
    await expect(width).toHaveAttribute("aria-invalid", "true");
    const search = page.getByRole("searchbox", { name: "Search settings" });
    await search.fill("Reports directory");
    await page.getByRole("link", { name: "Reports directory Paths" }).click();
    await expect(page.locator('[data-settings-path="paths.reportsDir"]')).toBeFocused();
    await search.fill("Browser viewport width");
    await page.getByRole("link", { name: "Browser viewport width General" }).click();
    await expect(width).toHaveValue("0");
    await page.getByRole("button", { name: "Back to dashboard" }).click();
    await expect(page.getByRole("dialog", { name: "Discard unsaved settings?" })).toBeVisible();
    await page.getByRole("button", { name: "Keep editing" }).click();
    await expect(width).toHaveValue("0");
    await page.getByRole("button", { name: "Back to dashboard" }).click();
    await page.getByRole("button", { name: "Discard changes" }).click();
    await expect(page).not.toHaveURL(/settings=/u);
    await page.getByRole("button", { name: "Search runs", exact: true }).click();
    const runs = page.getByRole("combobox", { name: "Search runs", exact: true });
    await expect(runs).toBeVisible();
    await runs.fill("Jordan");
    await page.getByRole("button", { name: "Clear search", exact: true }).click();
    await expect(runs).toHaveValue("");
    await expect(runs).toBeFocused();
    expect(writes).toEqual([]);
  } finally { await server.close(); }
});

test("A path target waits for its verified authority without a false unavailable warning", async ({ page }) => {
  ensureParityBundle();
  const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
  let release: (() => void) | undefined;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/v1/settings/storage-relocation", async route => { await pending; await route.continue(); });
  try {
    await page.goto(`${server.baseUrl}/?settings=paths&settingsTarget=paths.stateRoot`);
    await expect(page.getByRole("heading", { name: "Paths", exact: true })).toBeVisible();
    await expect(page.getByRole("status", { name: "Reading runtime locations" })).toBeVisible();
    await expect(page.getByText("Setting unavailable", { exact: true })).toHaveCount(0);
    if (release === undefined) throw new Error("path read release unavailable");
    release();
    await expect(page.locator('[data-settings-path="paths.stateRoot"]')).toBeFocused();
  } finally { release?.(); await server.close(); }
});


test("Provider key results open folded families while values stay masked and unsearchable", async ({ page }) => {
  ensureParityBundle();
  const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
  const document = EditableSettingsWireSchema.parse({ ...fixtureSettingsDocument(), providerKeys: {
    state: "available", providerSchemaHash: PROVIDER_KEYS_SCHEMA_HASH, revision: 1,
    sourceVersionToken: "a".repeat(64), slots: { GROQ_API_KEY: "synthetic-private-index-sentinel" },
    activeSlots: { GROQ_API_KEY: "synthetic-private-index-sentinel" }, parentSlotNames: [],
    fileSlotNamesAtBoot: ["GROQ_API_KEY"], bootFileRevision: 1, bootFileSourceVersionToken: "a".repeat(64),
    overriddenSlots: [], restartRequired: false,
  } });
  await page.route("**/api/v1/settings/editable", route => route.fulfill({ json: document }));
  try {
    await page.goto(`${server.baseUrl}/?settings=general`);
    const search = page.getByRole("searchbox", { name: "Search settings" });
    await search.fill("Groq API keys");
    await page.getByRole("link", { name: "Groq API keys Credentials" }).click();
    const family = page.locator('[data-settings-path="provider-keys.groqApiKeys"]');
    await expect(family).toBeFocused();
    await expect(family.getByLabel("Key 1", { exact: true })).toHaveAttribute("type", "password");
    await search.fill("synthetic-private-index-sentinel");
    await expect(page.getByText("No settings found", { exact: true })).toBeVisible();
    await expect(page.locator(".settings-search-result")).toHaveCount(0);
  } finally { await server.close(); }
});
