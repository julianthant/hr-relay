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
import { H_REPORT } from "./helpers/fixture-archive-report.js";
import { SavedVersionIndexWireSchema } from "../../src/domain/dashboard/archive.js";
import { FIXTURE_ACTIVITY_RANGE, FIXTURE_SAVED_VERSIONS } from "./helpers/fixture-archive.js";
import { FIXTURE_DAY } from "./helpers/fixture-identity.js";

const servers = registerReferenceServers(["server"]);
const RECORDS_VERSION_CHANGE = {
  changeId: "00000000-0000-4000-8000-000000000098",
  state: "planned",
  targetVersion: "0.3.0",
  change: {
    kind: "major",
    what: "Synthetic major version review",
    why: "A terminal prior-version run still blocks the reviewed archive transfer.",
    commit: { state: "absent", reason: "No commit reference supplied." },
  },
  reviewFingerprint: "b".repeat(64),
  scope: { kind: "workflows", workflowIds: ["person-lookup"] },
  memberRunIds: [
    "00000000-0000-4000-8000-000000000011",
    "00000000-0000-4000-8000-000000000012",
  ],
  blockerRunIds: ["00000000-0000-4000-8000-000000000012"],
  completedRunIds: [],
} as const;
const RECORDS_SAVED_VERSIONS = SavedVersionIndexWireSchema.parse({
  ...FIXTURE_SAVED_VERSIONS,
  changes: [RECORDS_VERSION_CHANGE],
});
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
        const identitySummary = page.locator('details > summary').filter({ hasText: section === "protected-store" ? /Credential identifiers/u : /Setting identities/u }).first();
        await identitySummary.focus(); await expect(identitySummary).toBeFocused(); await page.keyboard.press("Enter");
        await expect(identitySummary.locator("xpath=..").locator("code").first()).toBeVisible();
      }
      const lastInput = page.locator('[data-settings-path] input:not([type=hidden]),[data-settings-path] textarea,[data-settings-path] select,[data-protected-name] input:not([type=hidden])').last();
      if (section !== "runtime-isolation" && section !== "storage") {
        const save = page.getByRole("button", { name: section === "protected-store" ? "Save credentials" : "Save changes", exact: true });
        const discard = page.getByRole("button", { name: "Discard", exact: true });
        await expect(save).toBeVisible(); await expect(save).toBeEnabled();
        await expect(discard).toBeVisible(); await expect(discard).toBeEnabled();
        const disclosure = page.locator("details[open]").last();
        await disclosure.scrollIntoViewIfNeeded();
        await expect(disclosure).toBeInViewport();
        if (await lastInput.count()) { await lastInput.focus(); await expect(lastInput).toBeFocused(); }
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
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
        const identity = page.locator("details > summary", { hasText: "Setting identities" }).first();
        await identity.focus(); await expect(identity).toBeFocused(); await page.keyboard.press("Enter");
        await expect(identity.locator("xpath=..").locator("code").first()).toBeVisible();
        const save = page.getByRole("button", { name: "Save changes", exact: true });
        const discard = page.getByRole("button", { name: "Discard", exact: true });
        const lastInput = page.locator('[data-settings-path] input:not([type=hidden]),[data-settings-path] textarea,[data-settings-path] select').last();
        const disclosure = page.locator("details[open]").last();
        await disclosure.scrollIntoViewIfNeeded();
        await expect(disclosure).toBeInViewport();
        await lastInput.focus(); await expect(lastInput).toBeFocused();
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

const RECORD_VIEWPORTS = [
  { width: 1440, height: 900, name: "1440x900" },
  { width: 1280, height: 720, name: "1280x720" },
  { width: 1024, height: 768, name: "1024x768" },
  { width: 1024, height: 720, name: "1024x720" },
] as const;

for (const theme of PARITY_THEMES) {
  test(`UI-A Records desktop capture matrix @ ${theme.name}`, {
    annotation: [{ type: "required-a11y-evidence", description: `ui-settings-records-records-${theme.name}.a11y.yml` }],
  }, async ({ page }, info) => {
    const second = { ...H_REPORT, runId: "00000000-0000-4000-8000-000000000083", title: "Second saved report" };
    const digest = H_REPORT.files[0]?.digest;
    if (digest === undefined) throw new Error("The saved report fixture requires a retained attachment.");
    const downloadUrl = `/artifacts/v1/archive/${H_REPORT.runId}/files/${digest}`;
    await page.route("**/api/v1/archive/reports/*", route => route.fulfill({
      json: route.request().url().endsWith(second.runId) ? second : H_REPORT,
    }));
    await page.route("**/api/v1/archive/reports/*/files/*", route => route.fulfill({ json: {
      runId: H_REPORT.runId,
      digest,
      resource: { state: "available", downloadUrl },
    } }));
    await page.route("**/api/v1/archive/versions", route => route.fulfill({ json: RECORDS_SAVED_VERSIONS }));
    await page.route("**/api/v1/archive/reports?*", route => route.fulfill({ json: { items: [H_REPORT, second], next: null } }));
    await installTheme(page, theme);

    let finalTree = "";
    for (const viewport of RECORD_VIEWPORTS) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await gotoAppState(page, servers.server.baseUrl, { day: FIXTURE_DAY, archive: H_REPORT.runId });
      await assertThemeApplied(page, theme);
      await expect(page.getByRole("main").getByText("Archive", { exact: true })).toBeVisible();
      const selectedButton = page.getByRole("button", { name: H_REPORT.title, exact: true });
      await expect(selectedButton).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByRole("row", { name: new RegExp(H_REPORT.title, "u") })).toHaveAttribute("aria-selected", "true");
      const report = page.getByRole("article", { name: "Saved archive report" });
      await expect(report).toContainText(H_REPORT.workflow);
      await expect(report.getByText("Saved record · read-only", { exact: true })).toBeVisible();
      await expect(page.getByRole("link", { name: H_REPORT.files[0]?.name ?? "Retained attachment" })).toBeVisible();
      let stem = `ui-settings-records-records-matrix/${viewport.name}/archive-${theme.name}`;
      let screenshot = info.outputPath(`${stem}.png`);
      mkdirSync(dirname(screenshot), { recursive: true });
      await page.screenshot({ path: screenshot });
      await info.attach(`records-archive-${viewport.name}-${theme.name}`, { path: screenshot, contentType: "image/png" });
      finalTree = await page.locator("body").ariaSnapshot();
      writeFileSync(info.outputPath(`${stem}.a11y.yml`), finalTree);

      if (viewport.name === "1440x900") {
        const dateFilters = page.locator("details").filter({ hasText: "Date filters" });
        await dateFilters.locator("summary").click();
        const completedFrom = dateFilters.getByRole("group", { name: "Completed from (UTC)" });
        await completedFrom.locator('[data-type="month"]').fill("08");
        await completedFrom.locator('[data-type="day"]').fill("01");
        await completedFrom.locator('[data-type="year"]').fill("2026");
        await expect(dateFilters).toContainText("Active: Completed from 2026-08-01");
        await expect(selectedButton).toHaveAttribute("aria-pressed", "false");
        await expect(page.getByText("Select a saved report.", { exact: true })).toBeVisible();
        await dateFilters.locator("summary").click();
        await expect(dateFilters).not.toHaveAttribute("open");
        await page.getByRole("button", { name: "Clear filters", exact: true }).click();
        await page.getByRole("button", { name: H_REPORT.title, exact: true }).click();
        await expect(page.getByRole("button", { name: H_REPORT.title, exact: true })).toHaveAttribute("aria-pressed", "true");
      }

      if (viewport.name === "1024x720") {
        const trigger = page.getByRole("button", { name: "Delete saved report", exact: true });
        await trigger.focus();
        await trigger.click();
        const dialog = page.getByRole("dialog", { name: `Delete ${H_REPORT.title}?` });
        await expect(dialog).toBeVisible();
        await expect(dialog).toHaveCSS("opacity", "1");
        await expect(dialog).toContainText(H_REPORT.title);
        await expect(dialog).toContainText("transaction evidence");
        await expect(dialog).toContainText("permanent idempotency keys");
        await expect(dialog).toContainText("submit the same write again");
        const dialogStem = `ui-settings-records-records-matrix/${viewport.name}/archive-delete-${theme.name}`;
        const dialogScreenshot = info.outputPath(`${dialogStem}.png`);
        mkdirSync(dirname(dialogScreenshot), { recursive: true });
        await page.screenshot({ path: dialogScreenshot });
        await info.attach(`records-archive-delete-${viewport.name}-${theme.name}`, { path: dialogScreenshot, contentType: "image/png" });
        const dialogTree = await page.locator("body").ariaSnapshot();
        writeFileSync(info.outputPath(`${dialogStem}.a11y.yml`), dialogTree);
        await page.keyboard.press("Escape");
        await expect(dialog).toHaveCount(0);
        await expect(trigger).toBeFocused();
        await trigger.click();
        await page.getByRole("button", { name: "Cancel", exact: true }).click();
        await expect(dialog).toHaveCount(0);
        await expect(trigger).toBeFocused();
      }

      if (viewport.name === "1440x900") {
        await page.getByRole("button", { name: "Versions & bumps", exact: true }).click();
        const versions = page.getByRole("region", { name: "Versions and saved changes" });
        await expect(versions).toBeVisible();
        await expect(versions.getByRole("heading", { name: "Review a version change", exact: true })).toBeVisible();
        await expect(versions).toContainText("A major change archives reviewed terminal prior-version runs. A minor change archives none.");
        await expect(versions).toContainText("1 historical version record retained.");
        const planned = versions.getByRole("region", { name: `Version change ${RECORDS_VERSION_CHANGE.changeId}` });
        await expect(planned).toContainText("Synthetic major version review");
        await expect(planned).toContainText("planned");
        await expect(planned).toContainText("Target version");
        await expect(planned).toContainText(RECORDS_VERSION_CHANGE.memberRunIds.join(", "));
        await expect(planned.locator("dt", { hasText: "Blockers" })).toBeVisible();
        await expect(planned).toContainText(RECORDS_VERSION_CHANGE.blockerRunIds.join(", "));
        await expect(planned.getByRole("button", { name: "Apply reviewed change", exact: true })).toBeDisabled();
        const versionStem = `ui-settings-records-records-matrix/${viewport.name}/archive-versions-${theme.name}`;
        const versionScreenshot = info.outputPath(`${versionStem}.png`);
        mkdirSync(dirname(versionScreenshot), { recursive: true });
        await page.screenshot({ path: versionScreenshot });
        await info.attach(`records-archive-versions-${viewport.name}-${theme.name}`, { path: versionScreenshot, contentType: "image/png" });
        const versionTree = await page.locator("body").ariaSnapshot();
        writeFileSync(info.outputPath(`${versionStem}.a11y.yml`), versionTree);
        await planned.scrollIntoViewIfNeeded();
        await expect(planned).toBeInViewport();
        const activeVersionStem = `ui-settings-records-records-matrix/${viewport.name}/archive-versions-active-${theme.name}`;
        const activeVersionScreenshot = info.outputPath(`${activeVersionStem}.png`);
        mkdirSync(dirname(activeVersionScreenshot), { recursive: true });
        await page.screenshot({ path: activeVersionScreenshot });
        await info.attach(`records-archive-versions-active-${viewport.name}-${theme.name}`, { path: activeVersionScreenshot, contentType: "image/png" });
        await page.getByRole("button", { name: "Saved reports", exact: true }).click();
        await expect(page.getByRole("region", { name: "Versions and saved changes" })).toHaveCount(0);
        await expect(page.getByRole("article", { name: "Saved archive report" })).toBeVisible();
      }

      await gotoAppState(page, servers.server.baseUrl, {
        day: FIXTURE_DAY,
        activity: `${FIXTURE_ACTIVITY_RANGE.from}..${FIXTURE_ACTIVITY_RANGE.to}`,
      });
      await assertThemeApplied(page, theme);
      const activity = page.getByRole("region", { name: "Activity report" });
      await expect(activity).toBeVisible();
      await expect(activity.getByRole("heading", { name: "Activity results", exact: true })).toBeVisible();
      await expect(activity.getByRole("button", { name: /^Select report dates:/u })).toHaveCount(1);
      await expect(activity.getByRole("group", { name: "Export activity report" })).toBeVisible();
      await expect(page.getByRole("button", { name: /Export CSV/u })).toBeVisible();
      await expect(page.getByRole("button", { name: /XLSX/u })).toBeVisible();
      stem = `ui-settings-records-records-matrix/${viewport.name}/activity-${theme.name}`;
      screenshot = info.outputPath(`${stem}.png`);
      mkdirSync(dirname(screenshot), { recursive: true });
      await page.screenshot({ path: screenshot });
      await info.attach(`records-activity-${viewport.name}-${theme.name}`, { path: screenshot, contentType: "image/png" });
      finalTree = await page.locator("body").ariaSnapshot();
      writeFileSync(info.outputPath(`${stem}.a11y.yml`), finalTree);
    }

    const evidenceName = `ui-settings-records-records-${theme.name}.a11y.yml`;
    info.annotations.push({ type: `a11y-attachment-sha256:${evidenceName}`, description: createHash("sha256").update(finalTree).digest("hex") });
    await info.attach(evidenceName, { body: finalTree, contentType: "text/yaml" });
  });
}

for (const theme of PARITY_THEMES) {
  test(`UI-A Records real browser zoom @ ${theme.name}`, {
    annotation: [{ type: "required-a11y-evidence", description: `ui-settings-records-records-zoom-${theme.name}.a11y.yml` }],
  }, async ({ browserName }, info) => {
    expect(browserName).toBe("chromium");
    const root = join(tmpdir(), `records-zoom-${process.pid}-${Date.now()}`);
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "manifest.json"), JSON.stringify({
      manifest_version: 3, name: "Records zoom proof", version: "1.0", permissions: ["tabs"],
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
      const page = await context.newPage();
      await page.route("**/api/v1/archive/reports/*", route => route.fulfill({ json: H_REPORT }));
      await page.route("**/api/v1/archive/versions", route => route.fulfill({ json: RECORDS_SAVED_VERSIONS }));
      const digest = H_REPORT.files[0]?.digest;
      if (digest === undefined) throw new Error("The saved report fixture requires a retained attachment.");
      const downloadUrl = `/artifacts/v1/archive/${H_REPORT.runId}/files/${digest}`;
      await page.route("**/api/v1/archive/reports/*/files/*", route => route.fulfill({ json: {
        runId: H_REPORT.runId, digest, resource: { state: "available", downloadUrl },
      } }));
      await page.route("**/api/v1/archive/reports?*", route => route.fulfill({ json: { items: [H_REPORT], next: null } }));
      await installTheme(page, theme);

      const receipts: Array<Record<string, unknown>> = [];
      let finalTree = "";
      for (const sample of [
        { zoom: 1.25, viewport: { width: 1280, height: 720 }, css: { width: 1024, height: 576 } },
        { zoom: 2, viewport: { width: 1440, height: 900 }, css: { width: 720, height: 450 } },
      ] as const) {
        await page.setViewportSize(sample.viewport);
        for (const surface of ["archive", "activity", "versions"] as const) {
          await gotoAppState(page, servers.server.baseUrl, surface === "archive"
            ? { day: FIXTURE_DAY, archive: H_REPORT.runId }
            : surface === "activity"
              ? { day: FIXTURE_DAY, activity: `${FIXTURE_ACTIVITY_RANGE.from}..${FIXTURE_ACTIVITY_RANGE.to}` }
              : { day: FIXTURE_DAY, archive: "", archiveView: "versions" });
          await assertThemeApplied(page, theme);
          const zoomResult = await setBrowserZoom(worker, page.url(), sample.zoom);
          expect(zoomResult.value).toBe(sample.zoom);
          await expect.poll(() => page.evaluate(() => ({ width: innerWidth, height: innerHeight }))).toEqual(sample.css);
          if (surface === "archive") {
            await expect(page.getByRole("button", { name: H_REPORT.title, exact: true })).toHaveAttribute("aria-pressed", "true");
            await expect(page.getByRole("article", { name: "Saved archive report" }).getByText("Saved record · read-only", { exact: true })).toBeVisible();
          } else if (surface === "activity") {
            const activity = page.getByRole("region", { name: "Activity report" });
            await expect(activity.getByRole("heading", { name: "Activity results", exact: true })).toBeVisible();
            await expect(activity.getByRole("button", { name: /^Select report dates:/u })).toBeVisible();
            await expect(activity.getByRole("group", { name: "Export activity report" })).toBeVisible();
          } else {
            const versions = page.getByRole("region", { name: "Versions and saved changes" });
            await expect(versions.getByRole("heading", { name: "Review a version change", exact: true })).toBeVisible();
            await expect(versions).toContainText("A major change archives reviewed terminal prior-version runs. A minor change archives none.");
            await expect(versions.getByRole("region", { name: `Version change ${RECORDS_VERSION_CHANGE.changeId}` })).toContainText("planned");
          }
          const geometry = await page.evaluate(() => ({
            width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
            cssZoom: document.documentElement.style.zoom,
            bodyCssZoom: document.body.style.zoom,
            documentWidth: document.documentElement.scrollWidth,
          }));
          expect(geometry.width).toBe(sample.css.width);
          expect(geometry.height).toBe(sample.css.height);
          expect(geometry.cssZoom).toBe("");
          expect(geometry.bodyCssZoom).toBe("");
          if (sample.zoom === 1.25) expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.width);
          else expect(geometry.documentWidth, "the desktop canvas preserves D340 and remains horizontally scrollable at 200% zoom").toBeGreaterThanOrEqual(1024);
          const scrollRange = await page.evaluate(() => ({
            horizontal: document.documentElement.scrollWidth - innerWidth,
            vertical: document.documentElement.scrollHeight - innerHeight,
          }));
          if (sample.zoom === 2) expect(scrollRange.horizontal).toBeGreaterThan(0);

          await page.evaluate(() => window.scrollTo(0, 0));
          const stem = `ui-settings-records-records-zoom/${theme.name}/${String(sample.zoom)}-${surface}`;
          const screenshot = info.outputPath(`${stem}.png`);
          mkdirSync(dirname(screenshot), { recursive: true });
          await page.screenshot({ path: screenshot });
          await info.attach(`records-zoom-${String(sample.zoom)}-${surface}-${theme.name}`, { path: screenshot, contentType: "image/png" });

          if (surface === "archive") {
            const exportLink = page.getByRole("link", { name: "Export report", exact: true });
            const deleteTrigger = page.getByRole("button", { name: "Delete saved report", exact: true });
            for (const action of [exportLink, deleteTrigger]) {
              await action.scrollIntoViewIfNeeded();
              await expect(action).toBeInViewport();
              await action.focus();
              await expect(action).toBeFocused();
            }
            await deleteTrigger.click();
            const dialog = page.getByRole("dialog", { name: `Delete ${H_REPORT.title}?` });
            await expect(dialog).toBeVisible();
            await expect(dialog).toHaveCSS("opacity", "1");
            const confirm = dialog.getByRole("button", { name: "Delete this report", exact: true });
            await confirm.scrollIntoViewIfNeeded();
            await expect(confirm).toBeInViewport();
            const cancel = dialog.getByRole("button", { name: "Cancel", exact: true });
            await cancel.focus();
            await expect(cancel).toBeFocused();
            await cancel.click();
            await expect(dialog).toHaveCount(0);
            await expect(deleteTrigger).toBeFocused();
          } else {
            if (surface === "versions") {
              const versions = page.getByRole("region", { name: "Versions and saved changes" });
              for (const field of ["Scope", "Change kind", "What changed", "Why"]) {
                const control = field === "Scope" || field === "Change kind"
                  ? versions.getByRole("combobox", { name: field, exact: true })
                  : versions.getByRole("textbox", { name: field, exact: true });
                await expect(control).toHaveCount(1);
                await control.scrollIntoViewIfNeeded();
                await expect(control).toBeInViewport();
                await control.focus();
                await expect(control).toBeFocused();
              }
              const createReview = versions.getByRole("button", { name: "Create review", exact: true });
              await createReview.scrollIntoViewIfNeeded();
              await expect(createReview).toBeInViewport();
              await createReview.focus();
              await expect(createReview).toBeFocused();
              const planned = versions.getByRole("region", { name: `Version change ${RECORDS_VERSION_CHANGE.changeId}` });
              const applyBlocked = planned.getByRole("button", { name: "Apply reviewed change", exact: true });
              await applyBlocked.scrollIntoViewIfNeeded();
              await expect(applyBlocked).toBeInViewport();
              await expect(applyBlocked).toBeDisabled();
            } else {
              const activity = page.getByRole("region", { name: "Activity report" });
              const dateControl = activity.getByRole("button", { name: /^Select report dates:/u });
              await dateControl.scrollIntoViewIfNeeded();
              await expect(dateControl).toBeInViewport();
              await dateControl.focus();
              await expect(dateControl).toBeFocused();
              const exportActions = activity.getByRole("group", { name: "Export activity report" });
              for (const action of await exportActions.getByRole("button").all()) {
                await action.scrollIntoViewIfNeeded();
                await expect(action).toBeInViewport();
                await action.focus();
                await expect(action).toBeFocused();
              }
            }
          }
          const actionScreenshot = info.outputPath(`${stem}-actions.png`);
          mkdirSync(dirname(actionScreenshot), { recursive: true });
          await page.screenshot({ path: actionScreenshot });
          await info.attach(`records-zoom-actions-${String(sample.zoom)}-${surface}-${theme.name}`, { path: actionScreenshot, contentType: "image/png" });
          const tree = await page.locator("body").ariaSnapshot();
          writeFileSync(info.outputPath(`${stem}.a11y.yml`), tree);
          finalTree = tree;
          receipts.push({ theme: theme.name, surface, ...sample, mechanism: "chrome.tabs.setZoom", zoomResult, geometry });
        }
        const restored = await setBrowserZoom(worker, page.url(), 1);
        expect(restored.value).toBe(1);
      }
      const proof = info.outputPath(`ui-settings-records-records-zoom/${theme.name}/real-zoom-proof.json`);
      mkdirSync(dirname(proof), { recursive: true });
      writeFileSync(proof, JSON.stringify({ receipts }, null, 2));
      await info.attach(`records-zoom-proof-${theme.name}`, { path: proof, contentType: "application/json" });
      const evidenceName = `ui-settings-records-records-zoom-${theme.name}.a11y.yml`;
      info.annotations.push({ type: `a11y-attachment-sha256:${evidenceName}`, description: createHash("sha256").update(finalTree).digest("hex") });
      await info.attach(evidenceName, { body: finalTree, contentType: "text/yaml" });
    } finally {
      await context.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
}
