import { expect, test } from "@playwright/test";
import { chromium } from "@playwright/test";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fixtureSettingsDocument } from "./helpers/fixture-settings.js";
import { gotoAppState } from "./helpers/app-driver.js";
import { assertThemeApplied, installTheme, PARITY_THEMES } from "./helpers/capture.js";
import { registerReferenceServers } from "./helpers/reference-harness.js";
import { FIXTURE_DAY } from "./helpers/fixture-identity.js";

const servers = registerReferenceServers(["server"]);
const SETTINGS = [
  ["general", "General"],
  ["display", "Display"],
  ["performance", "Performance"],
  ["paths", "Paths"],
  ["routes", "Test routes"],
  ["annual-dates", "Annual dates"],
  ["providers", "Provider budgets & models"],
  ["protected-store", "Credentials"],
  ["provider-env", "Provider availability"],
  ["derived-host", "Observed host"],
  ["runtime-isolation", "Deployment"],
  ["storage", "Storage health"],
  ["system-hosts", "System hosts"],
  ["workflow-capabilities", "Workflow capabilities"],
  ["keyboard", "Keyboard"],
  ["ui-catalog", "UI catalog"],
] as const;

for (const theme of PARITY_THEMES) {
  test(`UI-A Settings inventory after @ ${theme.name}`, {
    annotation: [{ type: "required-a11y-evidence", description: `ui-settings-records-${theme.name}.a11y.yml` }],
  }, async ({ page }, info) => {
    const settings = fixtureSettingsDocument({
      providers: { gemini: { models: ["model-second", "model-first"] } },
      annualDates: { FY2027: { jobEndDate: "6/30/2027", kronosDefaultEndDate: "6/30/2027", kronosDefaultStartDate: "7/1/2026" } },
    }, 2);
    await page.route("**/api/v1/settings/editable", route => route.fulfill({ json: settings }));
    await page.setViewportSize({ width: 1440, height: 900 });
    await installTheme(page, theme);
    let finalTree = "";
    for (const [section, title] of SETTINGS) {
      await gotoAppState(page, servers.server.baseUrl, { day: FIXTURE_DAY, settings: section });
      await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
      const screenshot = info.outputPath(`ui-settings-records-after/settings-${section}-${theme.name}.png`);
      mkdirSync(dirname(screenshot), { recursive: true });
      await page.screenshot({ path: screenshot });
      await info.attach(`settings-${section}-${theme.name}`, { path: screenshot, contentType: "image/png" });
      finalTree = await page.locator("body").ariaSnapshot();
      writeFileSync(info.outputPath(`ui-settings-records-after/settings-${section}-${theme.name}.a11y.yml`), finalTree);
    }
    const evidenceName = `ui-settings-records-${theme.name}.a11y.yml`;
    info.annotations.push({ type: `a11y-attachment-sha256:${evidenceName}`, description: createHash("sha256").update(finalTree).digest("hex") });
    await info.attach(evidenceName, { body: finalTree, contentType: "text/yaml" });
  });
}

const LAYOUT_SCENES = [
  ["paths", "Paths"], ["annual-dates", "Annual dates"], ["providers", "Provider budgets & models"],
  ["protected-store", "Credentials"], ["runtime-isolation", "Deployment"], ["storage", "Storage health"],
] as const;
for (const theme of PARITY_THEMES) test(`UI-A Settings desktop layout matrix @ ${theme.name}`, async ({ page }, info) => {
  const settings = fixtureSettingsDocument({
    providers: { gemini: { models: ["model-second", "model-first"] } },
    annualDates: { FY2027: { jobEndDate: "6/30/2027", kronosDefaultEndDate: "6/30/2027", kronosDefaultStartDate: "7/1/2026" } },
  }, 2);
  await page.route("**/api/v1/settings/editable", route => route.fulfill({ json: settings }));
  await installTheme(page, theme);
  for (const viewport of [
    { width: 1280, height: 720, name: "1280x720" },
    { width: 1024, height: 768, name: "1024x768" },
    { width: 1024, height: 720, name: "1024x720" },
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    for (const [section, title] of LAYOUT_SCENES) {
      await gotoAppState(page, servers.server.baseUrl, { day: FIXTURE_DAY, settings: section });
      await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
      await assertThemeApplied(page, theme);
      if (section === "providers") {
        const budget = await page.locator('[data-settings-path="providers.ocrExtract"]').boundingBox();
        expect(budget).not.toBeNull();
        expect(budget!.width).toBeGreaterThan(page.viewportSize()!.width * 0.6);
      }
      if (section === "runtime-isolation") {
        const identitySummary = page.getByText("Runtime state folder", { exact: true }).locator("xpath=..").locator("details > summary");
        await identitySummary.focus(); await expect(identitySummary).toBeFocused(); await page.keyboard.press("Enter");
        await expect(identitySummary.locator("xpath=..").locator("code")).toHaveText("paths.stateRoot");
      } else if (section === "storage") {
        const doctor = page.getByRole("button", { name: "Run the read-only storage doctor" });
        await doctor.focus(); await expect(doctor).toBeFocused();
      } else {
        await createSettingsDraft(page, section);
        const identitySummary = page.locator('details > summary').filter({ hasText: section === "protected-store" ? "Credential identifiers" : "Setting identity" }).first();
        await identitySummary.focus(); await expect(identitySummary).toBeFocused(); await page.keyboard.press("Enter");
        await expect(identitySummary.locator("xpath=..").locator("code").first()).toBeVisible();
      }
      const lastInput = page.locator('[data-settings-path] input:not([type=hidden]),[data-settings-path] textarea,[data-settings-path] select,[data-protected-name] input:not([type=hidden])').last();
      if (section !== "runtime-isolation" && section !== "storage") {
        const save = page.getByRole("button", { name: section === "protected-store" ? "Save credentials 1" : /^Save [1-9]\d*$/ });
        const discard = page.getByRole("button", { name: section === "protected-store" ? "Discard credentials" : "Discard all" });
        await expect(save).toBeVisible(); await expect(save).toBeEnabled();
        await expect(discard).toBeVisible(); await expect(discard).toBeEnabled();
        const disclosure = page.locator("details[open]").last();
        await disclosure.scrollIntoViewIfNeeded();
        const disclosureBounds = await disclosure.boundingBox(); const footerBounds = await save.locator("xpath=..").boundingBox();
        expect(disclosureBounds).not.toBeNull(); expect(footerBounds).not.toBeNull();
        expect(disclosureBounds!.y + disclosureBounds!.height).toBeLessThanOrEqual(footerBounds!.y + 1);
        if (await lastInput.count()) await lastInput.scrollIntoViewIfNeeded();
        const inputBounds = await lastInput.boundingBox();
        expect(inputBounds).not.toBeNull(); expect(footerBounds).not.toBeNull();
        expect(inputBounds!.y + inputBounds!.height).toBeLessThanOrEqual(footerBounds!.y + 1);
        await save.focus(); await expect(save).toBeFocused();
      }
      const stem = `ui-settings-records-after/${viewport.name}/settings-${section}-${theme.name}`;
      const screenshot = info.outputPath(`${stem}.png`); mkdirSync(dirname(screenshot), { recursive: true });
      await page.screenshot({ path: screenshot });
      await info.attach(`settings-${section}-${viewport.name}-${theme.name}`, { path: screenshot, contentType: "image/png" });
      const tree = await page.locator("body").ariaSnapshot();
      writeFileSync(info.outputPath(`${stem}.a11y.yml`), tree);
    }
  }
});

test("UI-A Settings survives real browser zoom with keyboard details and reachable Save", async ({ browserName }, info) => {
  expect(browserName).toBe("chromium");
  const root = join(tmpdir(), `settings-zoom-${process.pid}-${Date.now()}`);
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "manifest.json"), JSON.stringify({
    manifest_version: 3, name: "Settings zoom proof", version: "1.0", permissions: ["tabs"],
    background: { service_worker: "worker.js" },
  }));
  writeFileSync(join(root, "worker.js"), "chrome.runtime.onInstalled.addListener(() => {});\n");
  const context = await chromium.launchPersistentContext(join(root, "profile"), {
    channel: "chromium", headless: false,
    args: ["--headless=new", `--disable-extensions-except=${root}`, `--load-extension=${root}`],
    viewport: { width: 1280, height: 720 },
  }).catch((error: unknown) => { rmSync(root, { recursive: true, force: true }); throw error; });
  try {
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker", { timeout: 10_000 });
    const receipts: Array<Record<string, unknown>> = [];
    for (const theme of PARITY_THEMES) {
      const page = await context.newPage();
      await page.route("**/favicon.ico", route => route.fulfill({ status: 204 }));
      const settings = fixtureSettingsDocument({
        providers: { gemini: { models: ["model-second", "model-first"] } },
        annualDates: { FY2027: { jobEndDate: "6/30/2027", kronosDefaultEndDate: "6/30/2027", kronosDefaultStartDate: "7/1/2026" } },
      }, 2);
      await page.route("**/api/v1/settings/editable", route => route.fulfill({ json: settings }));
      await installTheme(page, theme);
      const samples = [
        { zoom: 1.25, viewport: { width: 1280, height: 720 }, css: { width: 1024, height: 576 }, section: "providers", title: "Provider budgets & models" },
        { zoom: 2, viewport: { width: 1440, height: 900 }, css: { width: 720, height: 450 }, section: "annual-dates", title: "Annual dates" },
      ] as const;
      for (const sample of samples) {
        await page.setViewportSize(sample.viewport);
        await gotoAppState(page, servers.server.baseUrl, { day: FIXTURE_DAY, settings: sample.section });
        await expect(page.getByRole("heading", { name: sample.title, exact: true })).toBeVisible();
        await assertThemeApplied(page, theme);
        const zoomResult = await setBrowserZoom(worker, page.url(), sample.zoom);
        expect(zoomResult.value).toBe(sample.zoom);
        await expect.poll(() => page.evaluate(() => ({ width: innerWidth, height: innerHeight }))).toEqual(sample.css);
        const geometry = await page.evaluate(() => ({ innerWidth, innerHeight, dpr: devicePixelRatio, cssZoom: document.documentElement.style.zoom, bodyCssZoom: document.body.style.zoom }));
        expect(geometry.cssZoom).toBe(""); expect(geometry.bodyCssZoom).toBe("");
        await createSettingsDraft(page, sample.section);
        const identity = page.locator("details > summary", { hasText: "Setting identity" }).first();
        await identity.focus(); await expect(identity).toBeFocused(); await page.keyboard.press("Enter");
        await expect(identity.locator("xpath=..").locator("code")).toBeVisible();
        const save = page.getByRole("button", { name: /^Save [1-9]\d*$/ });
        const discard = page.getByRole("button", { name: "Discard all" });
        const lastInput = page.locator('[data-settings-path] input:not([type=hidden]),[data-settings-path] textarea,[data-settings-path] select').last();
        const disclosure = page.locator("details[open]").last();
        await disclosure.scrollIntoViewIfNeeded();
        const disclosureBounds = await disclosure.boundingBox(); const footerBounds = await save.locator("xpath=..").boundingBox();
        expect(disclosureBounds).not.toBeNull(); expect(footerBounds).not.toBeNull();
        expect(disclosureBounds!.y + disclosureBounds!.height).toBeLessThanOrEqual(footerBounds!.y + 1);
        await lastInput.scrollIntoViewIfNeeded();
        const inputBounds = await lastInput.boundingBox();
        expect(inputBounds).not.toBeNull(); expect(footerBounds).not.toBeNull();
        expect(inputBounds!.y + inputBounds!.height).toBeLessThanOrEqual(footerBounds!.y + 1);
        await expect(save).toBeEnabled(); await save.focus(); await expect(save).toBeFocused();
        await expect(discard).toBeEnabled();
        const stem = `ui-settings-records-after/zoom-${String(sample.zoom)}-${theme.name}`;
        const screenshot = info.outputPath(`${stem}.png`); mkdirSync(dirname(screenshot), { recursive: true });
        await page.screenshot({ path: screenshot });
        await info.attach(`settings-zoom-${String(sample.zoom)}-${theme.name}`, { path: screenshot, contentType: "image/png" });
        const tree = await page.locator("body").ariaSnapshot(); writeFileSync(info.outputPath(`${stem}.a11y.yml`), tree);
        receipts.push({ theme: theme.name, ...sample, mechanism: "chrome.tabs.setZoom", zoomResult, geometry });
        expect((await setBrowserZoom(worker, page.url(), 1)).value).toBe(1);
      }
      await page.close();
    }
    const proof = info.outputPath("ui-settings-records-after/real-zoom-proof.json");
    mkdirSync(dirname(proof), { recursive: true }); writeFileSync(proof, JSON.stringify({ receipts }, null, 2));
    await info.attach("settings-real-zoom-proof", { path: proof, contentType: "application/json" });
  } finally {
    await context.close(); rmSync(root, { recursive: true, force: true });
  }
});

async function createSettingsDraft(page: import("@playwright/test").Page, section: string): Promise<void> {
  if (section === "protected-store") {
    await page.getByRole("textbox", { name: "UCPath password", exact: true }).fill("synthetic-settings-proof");
  } else if (section === "annual-dates") {
    await page.locator('[data-settings-path^="annualDates."] input').first().fill("6/30/2028");
  } else if (section === "providers") {
    const budget = page.locator('[data-settings-path^="providers."] input[type="number"]').first();
    const current = Number(await budget.inputValue());
    await budget.fill(String(Number.isFinite(current) && current > 0 ? current + 1 : 1));
  } else {
    const field = page.locator('[data-settings-path] input:not([type=hidden]),[data-settings-path] textarea,[data-settings-path] select').first();
    await field.fill("/tmp/settings-proof/reports");
  }
}

async function setBrowserZoom(worker: import("playwright").Worker, pageUrl: string, factor: number) {
  return worker.evaluate(async ({ pageUrl, factor }) => {
    const { chrome } = globalThis as unknown as { chrome: { tabs: {
      query: (query: Record<string, never>) => Promise<Array<{ id?: number; url?: string }>>;
      setZoomSettings: (id: number, settings: { mode: "automatic"; scope: "per-tab" }) => Promise<void>;
      setZoom: (id: number, factor: number) => Promise<void>;
      getZoom: (id: number) => Promise<number>;
      getZoomSettings: (id: number) => Promise<{ mode: string; scope: string }>;
    } } };
    const owned = (await chrome.tabs.query({})).filter(tab => tab.url === pageUrl);
    const tabId = owned[0]?.id;
    if (owned.length !== 1 || tabId === undefined) throw new Error(`Expected one owned zoom tab, found ${String(owned.length)}`);
    await chrome.tabs.setZoomSettings(tabId, { mode: "automatic", scope: "per-tab" });
    await chrome.tabs.setZoom(tabId, factor);
    return { tabId, value: await chrome.tabs.getZoom(tabId), settings: await chrome.tabs.getZoomSettings(tabId) };
  }, { pageUrl, factor });
}
