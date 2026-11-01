import { NativePathPickerRequestSchema } from "../../src/models/dashboard/native-path-picker.js";
import { expect } from "@playwright/test";
import { test } from "./helpers/fixtures.js";
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

for (const theme of PARITY_THEMES) test(`Settings body switch thumbs remain on their track @ ${theme.name}`, {
  annotation: [{ type: "required-a11y-evidence", description: `settings-switch-thumb-${theme.name}.a11y.yml` }],
}, async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await installTheme(page, theme);
  await gotoSettingsDiscardingDraft(page, "general");
  await expect(page.getByRole("heading", { name: "General", level: 1 })).toBeVisible();
  const switches = page.locator(".settings-tab-body .ds-switch-row");
  await expect(switches).toHaveCount(3);
  for (const name of ["Dark theme", "Animations", "Run without a browser window"]) await expect(switches.getByRole("switch", { name: new RegExp(`^${name} `, "u") })).toHaveCount(1);
  const positions = await switches.evaluateAll(rows => rows.map(row => {
    const track = row.querySelector(".ds-switch-control")?.getBoundingClientRect();
    const thumbElement = row.querySelector(".ds-switch-thumb");
    const thumb = thumbElement?.getBoundingClientRect();
    if (track === undefined || thumb === undefined || thumbElement === null) throw new Error("settings-switch-parts-missing");
    return { checked: row.getAttribute("data-selected") === "true", trackLeft: track.left, trackRight: track.right, thumbLeft: thumb.left, thumbRight: thumb.right, color: getComputedStyle(thumbElement).backgroundColor };
  }));
  for (const position of positions) {
    expect(position.thumbLeft).toBeGreaterThanOrEqual(position.trackLeft);
    expect(position.thumbRight).toBeLessThanOrEqual(position.trackRight);
    expect(position.color).toBe("rgb(255, 255, 255)");
  }
  expect(positions.filter(position => position.checked)).toHaveLength(3);
  const evidenceName = `settings-switch-thumb-${theme.name}.a11y.yml`;
  const tree = await page.locator("body").ariaSnapshot();
  info.annotations.push({ type: `a11y-attachment-sha256:${evidenceName}`, description: createHash("sha256").update(tree).digest("hex") });
  await info.attach(evidenceName, { body: tree, contentType: "text/yaml" });
});
const SETTINGS = [
  ["general", "General"],
  ["performance", "Performance"],
  ["paths", "Paths"],
  ["routes", "Routes"],
  ["protected-store", "Credentials"],
  ["storage", "Storage checks"],
  ["keyboard", "Keyboard shortcuts"],
] as const;

for (const theme of PARITY_THEMES) {

test(`UI-A Settings desktop layout matrix @ ${theme.name}`, async ({ page }, info) => {
  const settings = fixtureSettingsDocument({
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
      await gotoSettingsDiscardingDraft(page, section);
      await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
      await assertThemeApplied(page, theme);
      if (section === "storage") {
        const doctor = page.getByRole("button", { name: "Run storage checks" });
        await doctor.focus(); await expect(doctor).toBeFocused();
      } else {
        await createSettingsDraft(page, section);
        await expect(page.getByText("Setting identities", { exact: true })).toHaveCount(0);
        await expect(page.getByText("Credential identifiers", { exact: true })).toHaveCount(0);
      }
      const lastInput = section === "paths" ? page.getByRole("button", { name: "Change Reports", exact: true }) : page.locator('[data-settings-path] input:not([type=hidden]),[data-settings-path] textarea,[data-settings-path] select,[data-protected-name] input:not([type=hidden])').last();
      if (section !== "storage") {
        await expect(page.getByRole("button", { name: section === "protected-store" ? "Save credentials" : "Save changes", exact: true })).toHaveCount(0);
        await expect(lastInput).toHaveCount(1); await expect(lastInput).toBeEnabled();
        await lastInput.focus(); await expect(lastInput).toBeFocused();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      }
      const stem = `ui-settings-records-after/${viewport.name}/settings-${section}-${theme.name}`;
      const tree = await page.locator("body").ariaSnapshot();
      writeSettingsEvidence(info.outputPath(`${stem}.a11y.yml`), tree);
    }
  }
});

test(`UI-A Settings inventory after @ ${theme.name}`, {
    annotation: [{ type: "required-a11y-evidence", description: `ui-settings-records-${theme.name}.a11y.yml` }],
  }, async ({ page }, info) => {
    const settings = fixtureSettingsDocument({
      annualDates: { FY2027: { jobEndDate: "6/30/2027", kronosDefaultEndDate: "6/30/2027", kronosDefaultStartDate: "7/1/2026" } },
    }, 2);
    await page.route("**/api/v1/settings/editable", route => route.fulfill({ json: settings }));
    await page.setViewportSize({ width: 1440, height: 900 });
    await installTheme(page, theme);
    let finalTree = "";
    for (const [section, title] of SETTINGS) {
      await gotoSettingsDiscardingDraft(page, section);
      await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
      finalTree = await page.locator("body").ariaSnapshot();
      writeSettingsEvidence(info.outputPath(`ui-settings-records-after/settings-${section}-${theme.name}.a11y.yml`), finalTree);
    }
    const evidenceName = `ui-settings-records-${theme.name}.a11y.yml`;
    info.annotations.push({ type: `a11y-attachment-sha256:${evidenceName}`, description: createHash("sha256").update(finalTree).digest("hex") });
    await info.attach(evidenceName, { body: finalTree, contentType: "text/yaml" });
  });
}

const LAYOUT_SCENES = [
  ["paths", "Paths"],
  ["protected-store", "Credentials"], ["storage", "Storage checks"],
] as const;

async function gotoSettingsDiscardingDraft(page: import("@playwright/test").Page, section: string): Promise<readonly string[]> {
  const discardedDialogs: string[] = [];
  const acceptDraftNavigation = async (dialog: import("@playwright/test").Dialog) => {
    expect(dialog.type()).toBe("beforeunload");
    discardedDialogs.push(dialog.type());
    await dialog.accept();
  };
  page.on("dialog", acceptDraftNavigation);
  try {
    await gotoAppState(page, servers.server.baseUrl, { day: FIXTURE_DAY, settings: section });
  } finally {
    page.off("dialog", acceptDraftNavigation);
  }
  return discardedDialogs;
}

function writeSettingsEvidence(path: string, tree: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, tree);
}

async function createSettingsDraft(page: import("@playwright/test").Page, section: string): Promise<void> {
  if (section === "protected-store") {
    const password = page.getByRole("textbox", { name: "UCPath password", exact: true });
    await password.fill("synthetic-settings-proof");
    await password.fill("");
    await expect(page.getByText("Enter a valid value for this credential.", { exact: true })).toBeVisible();
  } else if (section === "annual-dates") {
    const date = page.getByRole("group", { name: "Job end date*", exact: true });
    await date.getByRole("spinbutton", { name: "year, Job end date*", exact: true }).focus();
    await page.keyboard.type("2028");
    await expect(date.getByRole("spinbutton", { name: "month, Job end date*", exact: true })).toHaveText("06");
    await expect(date.getByRole("spinbutton", { name: "day, Job end date*", exact: true })).toHaveText("30");
    await expect(date.getByRole("spinbutton", { name: "year, Job end date*", exact: true })).toHaveText("2028");
  } else if (section === "paths") {
    await page.route("**/api/v1/settings/path-picker", async route => {
      const request = NativePathPickerRequestSchema.parse(route.request().postDataJSON());
      expect(request.field).toBe("paths.reportsDir");
      await route.fulfill({ json: { state: "selected", field: request.field, path: "/tmp/settings-proof/reports" } });
    }, { times: 1 });
    await page.getByRole("button", { name: "Change Reports", exact: true }).click();
    await expect(page.getByText("/tmp/settings-proof/reports", { exact: true })).toBeVisible();
  } else {
    throw new Error(`settings-draft-section-unsupported:${section}`);
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

test("UI-A Settings survives real browser zoom with reachable controls", async ({ browserName }, info) => {
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
        annualDates: { FY2027: { jobEndDate: "6/30/2027", kronosDefaultEndDate: "6/30/2027", kronosDefaultStartDate: "7/1/2026" } },
      }, 2);
      await page.route("**/api/v1/settings/editable", route => route.fulfill({ json: settings }));
      await installTheme(page, theme);
      const samples = [
        { zoom: 1.25, viewport: { width: 1280, height: 720 }, css: { width: 1024, height: 576 }, section: "paths", title: "Paths" },
        { zoom: 2, viewport: { width: 1440, height: 900 }, css: { width: 720, height: 450 }, section: "annual-dates", title: "General" },
      ] as const;
      for (const sample of samples) {
        await page.setViewportSize(sample.viewport);
        const discardedNavigationDialogs = await gotoSettingsDiscardingDraft(page, sample.section);
        await expect(page.getByRole("heading", { name: sample.title, exact: true })).toBeVisible();
        await assertThemeApplied(page, theme);
        const zoomResult = await setBrowserZoom(worker, page.url(), sample.zoom);
        expect(zoomResult.value).toBe(sample.zoom);
        await expect.poll(() => page.evaluate(() => ({ width: innerWidth, height: innerHeight }))).toEqual(sample.css);
        const geometry = await page.evaluate(() => ({ innerWidth, innerHeight, dpr: devicePixelRatio, cssZoom: document.documentElement.style.zoom, bodyCssZoom: document.body.style.zoom }));
        expect(geometry.cssZoom).toBe(""); expect(geometry.bodyCssZoom).toBe("");
        await createSettingsDraft(page, sample.section);
        await expect(page.getByText("Setting identities", { exact: true })).toHaveCount(0);
        await expect(page.getByRole("button", { name: "Save changes", exact: true })).toHaveCount(0);
        const lastInput = sample.section === "paths" ? page.getByRole("button", { name: "Change Reports", exact: true }) : page.getByRole("spinbutton", { name: "year, Job end date*", exact: true });
        await lastInput.focus(); await expect(lastInput).toBeFocused();
        const stem = `ui-settings-records-after/zoom-${String(sample.zoom)}-${theme.name}`;
        const tree = await page.locator("body").ariaSnapshot(); writeSettingsEvidence(info.outputPath(`${stem}.a11y.yml`), tree);
        receipts.push({ theme: theme.name, ...sample, mechanism: "chrome.tabs.setZoom", zoomResult, geometry, discardedNavigationDialogs });
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
