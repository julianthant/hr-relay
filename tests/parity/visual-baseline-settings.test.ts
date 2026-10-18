import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { mergeSettingsPatch } from "../../src/models/config/settings.js";
import { ProtectedSettingsCommandRequestSchema, SettingsCommandRequestSchema } from "../../src/rules/commands/commands.js";
import { ensureParityBundle, PARITY_DIST_DIR } from "./helpers/bundle.js";
import { assertThemeApplied, captureParityPair, installTheme, PARITY_THEMES, type ParityTheme } from "./helpers/capture.js";
import { gotoAppState } from "./helpers/app-driver.js";
import { startFixtureServer } from "../support/helpers/dashboard/fixture-bff.js";
import { EditableSettingsWireSchema } from "../../src/models/dashboard/settings-editor.js";
import { startSetupPreflightServer } from "./helpers/fixture-setup-preflight.js";
import { fixtureSettingsDocument } from "./helpers/fixture-settings.js";
import { FIXTURE_APP_VERSION, FIXTURE_DAY, FIXTURE_DESCRIPTOR_HASH, FIXTURE_NOW } from "./helpers/fixture-identity.js";

const references = resolve(import.meta.dirname, "references");
const evidence = (group: string, theme: ParityTheme, width: number) => `baseline-settings-${group}-${theme.attribute}-${width}.a11y.yml`;

async function attachTree(page: Page, info: TestInfo, name: string) {
  const body = await page.locator("body").ariaSnapshot();
  info.annotations.push({ type: `a11y-attachment-sha256:${name}`, description: createHash("sha256").update(body).digest("hex") });
  await info.attach(name, { body, contentType: "text/yaml" });
}

async function capture(page: Page, info: TestInfo, theme: ParityTheme, width: number, state: string) {
  await page.evaluate(() => document.fonts.ready);
  await assertThemeApplied(page, theme);
  const stateId = `baseline-settings-${state}`;
  const name = `${stateId}-${theme.attribute}-${width}.a11y.yml`;
  info.annotations.push({ type: "required-a11y-evidence", description: name });
  await attachTree(page, info, name);
  await captureParityPair(page, references, {
    stateId, viewport: `${width}x${720}`, theme: theme.name,
    adapter: "fixture-bff", fixtureId: "current-mounted-settings", descriptorHash: FIXTURE_DESCRIPTOR_HASH,
    appVersion: FIXTURE_APP_VERSION, capturedAt: FIXTURE_DAY, variant: "default",
  });
}

async function setup(page: Page, theme: ParityTheme, width: number) {
  ensureParityBundle();
  const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
  await page.setViewportSize({ width, height: 720 });
  await page.clock.setFixedTime(new Date(FIXTURE_NOW));
  await installTheme(page, theme);
  return server;
}

for (const theme of PARITY_THEMES) for (const width of [1280]) {
  for (const section of ["general", "credentials", "performance", "paths", "routes"] as const) {
    test(`baseline mounted ${section} reads ${theme.attribute} ${width}`, {
      annotation: [{ type: "required-a11y-evidence", description: evidence(`${section}-reads`, theme, width) }],
    }, async ({ page }, info) => {
      const server = await setup(page, theme, width);
      const gate = Promise.withResolvers<void>();
      await page.route("**/api/v1/settings/editable", async route => { await gate.promise; await route.fulfill({ status: 503, json: { state: "error", code: "fixture-unavailable", message: "Synthetic settings read unavailable", retryable: true } }); });
      try {
        await gotoAppState(page, server.baseUrl, { day: FIXTURE_DAY, settings: section });
        await expect(page.getByRole("searchbox", { name: "Search settings", exact: true })).toBeVisible();
        await expect(page.getByRole("textbox", { name: "Task", exact: true })).toHaveCount(0);

        const search = page.getByRole("searchbox", { name: "Search settings", exact: true });
        await search.fill("zz-unmatched-setting");
        await expect(page.getByText("Reading settings…", { exact: true })).toBeVisible();

        gate.resolve();
        await expect(page.getByText("Settings fields unavailable", { exact: true })).toBeVisible();
        await capture(page, info, theme, width, `${section}-read-failure`);
        await attachTree(page, info, evidence(`${section}-reads`, theme, width));
      } finally { gate.resolve(); await server.close(); }
    });
  }

  test(`baseline Settings navigation and keyboard ${theme.attribute} ${width}`, {
    annotation: [{ type: "required-a11y-evidence", description: evidence("navigation", theme, width) }],
  }, async ({ page }, info) => {
    const server = await setup(page, theme, width);
    try {
      await gotoAppState(page, server.baseUrl, { day: FIXTURE_DAY, settings: "general" });
      await expect(page.getByRole("button", { name: "Continue with ChatGPT", exact: true })).toBeVisible();
      await capture(page, info, theme, width, "general-signed-out");
      await page.getByRole("button", { name: "Continue with ChatGPT", exact: true }).click();
      await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();

      const search = page.getByRole("searchbox", { name: "Search settings", exact: true });
      await search.fill("zz-no-setting");
      await expect(page.getByText("No settings found", { exact: true })).toBeVisible();

      await search.fill("backoff");
      await expect(page.getByRole("link", { name: "Backoff base Performance", exact: true })).toBeVisible();

      await page.getByRole("link", { name: "Backoff base Performance", exact: true }).click();
      await expect(page.locator('[data-settings-path="ocr.backoffBaseMs"]')).toBeFocused();

      await page.goto(`${server.baseUrl}/?settings=general&settingsTarget=not-a-real-field`);
      await expect(page.getByText("Setting unavailable", { exact: true })).toBeVisible();

      await page.goto(`${server.baseUrl}/?settings=keyboard`);
      await expect(page.getByRole("heading", { name: "Keyboard shortcuts", exact: true })).toBeVisible();
      await capture(page, info, theme, width, "keyboard-default");
      await page.getByRole("searchbox", { name: "Search shortcuts", exact: true }).fill("zz-no-shortcut");
      await expect(page.getByText("No shortcuts match your search.", { exact: true })).toBeVisible();
      await capture(page, info, theme, width, "keyboard-empty-search");
      await page.getByRole("searchbox", { name: "Search shortcuts", exact: true }).fill("");
      await page.getByRole("button", { name: "Edit Search runs shortcut 1", exact: true }).click();
      await expect(page.getByRole("dialog", { name: "Edit shortcut", exact: true })).toBeVisible();
      await capture(page, info, theme, width, "keyboard-edit");
      await page.getByRole("textbox", { name: "Shortcut keys", exact: true }).press("r");
      await page.getByRole("button", { name: "Save shortcut", exact: true }).click();
      await expect(page.getByText("Shortcut unavailable", { exact: true })).toBeVisible();

      await page.getByRole("textbox", { name: "Shortcut keys", exact: true }).press("g");
      await page.getByRole("button", { name: "Save shortcut", exact: true }).click();
      await expect(page.locator('[data-slot="toast"]').filter({ hasText: "Saved Search runs shortcut" })).toBeVisible();

      await attachTree(page, info, evidence("navigation", theme, width));
    } finally { await server.close(); }
  });

  test(`baseline Settings autosave outcomes ${theme.attribute} ${width}`, {
    annotation: [{ type: "required-a11y-evidence", description: evidence("autosave", theme, width) }],
  }, async ({ page }, info) => {
    const server = await setup(page, theme, width);
    let settings: Parameters<typeof mergeSettingsPatch>[0] = {};
    let document = fixtureSettingsDocument();
    await page.route("**/api/v1/settings/editable", route => route.fulfill({ json: document }));
    await page.route("**/api/v1/commands", route => {
      const command = SettingsCommandRequestSchema.parse(route.request().postDataJSON());
      settings = mergeSettingsPatch(settings, command.payload.patch);
      document = fixtureSettingsDocument(settings, document.revision + 1);
      return route.fulfill({ json: { state: "applied", commandId: command.commandId, affectedTargets: [{ family: "settings", revision: document.revision }], restartRequired: false, settingsRevision: document.revision, settingsFingerprint: document.settingsFingerprint } });
    });
    const gate = Promise.withResolvers<void>();
    try {
      await gotoAppState(page, server.baseUrl, { day: FIXTURE_DAY, settings: "performance" });
      const task = page.getByRole("textbox", { name: "Task", exact: true });
      await expect(task).toBeVisible();
      await capture(page, info, theme, width, "performance-default");
      await task.fill("0");
      await expect(task).toHaveAttribute("aria-invalid", "true");

      await page.getByRole("button", { name: "Back to dashboard", exact: true }).click();
      await expect(page.getByRole("dialog", { name: "Discard unsaved settings?", exact: true })).toBeVisible();
      await capture(page, info, theme, width, "dirty-exit");
      await page.getByRole("button", { name: "Keep editing", exact: true }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await page.waitForTimeout(250);
      await page.route("**/api/v1/commands", async route => { await gate.promise; await route.fallback(); }, { times: 1 });
      await task.fill("210");
      await expect(page.getByText("Saving…", { exact: true })).toBeVisible();

      gate.resolve();
      await expect(page.locator('[data-slot="toast"]').filter({ hasText: "Saved Task" })).toBeVisible();

      await page.keyboard.press("F6");
      await expect(page.locator('[data-slot="toast-viewport"]')).toBeFocused();
      await expect(page.locator('[data-slot="toast-close"]')).toHaveAttribute("aria-hidden", "false");
      const dismiss = page.locator('[data-slot="toast"]').getByRole("button", { name: "Dismiss", exact: true });
      await expect(dismiss).toBeVisible();
      await page.keyboard.press("Tab");
      await expect(page.locator('[data-slot="toast"]')).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(dismiss).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(page.locator('[data-slot="toast"]')).toHaveCount(0);
      await expect(page.getByText("Saved", { exact: true })).toBeVisible();

      await page.route("**/api/v1/commands", route => route.abort("failed"), { times: 1 });
      await task.fill("240");
      await expect(page.getByText("Settings write unconfirmed", { exact: true })).toBeVisible();

      await page.reload(); await expect(task).toBeVisible();
      await page.route("**/api/v1/commands", route => route.fulfill({ status: 403, json: { state: "error", code: "OPERATOR_MUTATION_ORIGIN_REFUSED", message: "Synthetic refusal", retryable: false } }), { times: 1 });
      await task.fill("270");
      await expect(page.getByText("Settings were not applied", { exact: true })).toBeVisible();

      await attachTree(page, info, evidence("autosave", theme, width));
    } finally { gate.resolve(); await server.close(); }
  });

  test(`baseline Settings paths and credential removal ${theme.attribute} ${width}`, {
    annotation: [{ type: "required-a11y-evidence", description: evidence("paths-credentials", theme, width) }],
  }, async ({ page }, info) => {
    const server = await setup(page, theme, width);
    const gate = Promise.withResolvers<void>();
    try {
      await gotoAppState(page, server.baseUrl, { day: FIXTURE_DAY, settings: "credentials" });
      const username = page.getByRole("textbox", { name: "UCPath username", exact: true });
      await expect(username).toBeVisible();
      await capture(page, info, theme, width, "credentials-default");
      await username.fill("synthetic-removal-user");
      const removal = page.locator('[data-settings-path="protected.ucpathUserId"]').getByRole("button", { name: /Remove/ });
      await removal.click();
      await expect(page.getByRole("dialog", { name: "Remove UCPath username?", exact: true })).toBeVisible();
      await capture(page, info, theme, width, "credential-removal");
      await page.getByRole("button", { name: "Remove credential", exact: true }).click();
      await expect(username).toHaveValue("");

      await page.goto(`${server.baseUrl}/?settings=paths`);
      const picker = page.getByRole("button", { name: "Change Runtime state folder", exact: true });
      await expect(picker).toBeVisible();
      await capture(page, info, theme, width, "paths-default");
      await page.route("**/api/v1/settings/path-picker", async route => { await gate.promise; await route.fulfill({ json: { state: "unavailable", field: "paths.stateRoot", reason: "dialog-failed" } }); }, { times: 1 });
      await picker.click();
      await expect(picker).toBeDisabled();

      gate.resolve();
      await expect(page.getByText("The path picker could not be opened. Try again.", { exact: true })).toBeVisible();

      await page.route("**/api/v1/settings/path-picker", route => route.fulfill({ json: { state: "selected", field: "paths.stateRoot", path: "/tmp/settings-fixture/new-state" } }), { times: 1 });
      await page.route("**/api/v1/commands", route => route.abort("failed"));
      await picker.click();
      await expect(page.getByText("Plan write unconfirmed", { exact: true })).toBeVisible();
      const warning = page.locator('[data-slot="toast"]').filter({ hasText: "Command result" });
      await expect(warning).toHaveCount(1);
      await expect(warning).toContainText("The command outcome is uncertain. Check its result before taking further action.");
      await warning.locator('[data-slot="toast-close"]').hover();
      await warning.getByRole("button", { name: "Dismiss", exact: true }).click();
      await expect(warning).toHaveCount(0);
      await expect(page.getByText("Plan write unconfirmed", { exact: true })).toBeVisible();

      await page.getByRole("button", { name: "Back to dashboard", exact: true }).click();
      await expect(page.getByRole("dialog", { name: "Leave with an unconfirmed plan?", exact: true })).toBeVisible();
      await capture(page, info, theme, width, "relocation-unconfirmed-exit");
      await attachTree(page, info, evidence("paths-credentials", theme, width));
    } finally { gate.resolve(); await server.close(); }
  });

  test(`baseline spreadsheet library and dialogs ${theme.attribute} ${width}`, {
    annotation: [{ type: "required-a11y-evidence", description: evidence("spreadsheet-library-coverage", theme, width) }],
  }, async ({ page }, info) => {
    const server = await setup(page, theme, width);
    const open = (view: Record<string, unknown> = {}, suffix = "") => page.goto(`${server.baseUrl}/?settings=spreadsheets&view=${encodeURIComponent(JSON.stringify(view))}${suffix}`);
    try {
      await open();
      await expect(page.getByRole("table", { name: "Registered spreadsheets", exact: true }).locator("tbody tr")).toHaveCount(3);
      await capture(page, info, theme, width, "spreadsheet-library");
      await page.getByRole("searchbox", { name: "Find a spreadsheet", exact: true }).fill("zz-unmatched-file");
      await expect(page.getByText("No spreadsheets match your search.", { exact: true })).toBeVisible();
      await capture(page, info, theme, width, "spreadsheet-library-empty-search");
      await open({ spreadsheet: "missing-baseline-file" });
      await expect(page.getByText("This file is no longer registered.", { exact: true })).toBeVisible();
      await capture(page, info, theme, width, "spreadsheet-missing-file");
      await open({ spreadsheetImport: true, spreadsheetImportView: "columns" });
      await expect(page.getByRole("dialog", { name: "Import unavailable", exact: true })).toBeVisible();
      await capture(page, info, theme, width, "spreadsheet-lost-import");
      await open({ spreadsheetTab: "types" });
      await expect(page.getByRole("button", { name: "Add spreadsheet type", exact: true })).toBeVisible();
      await capture(page, info, theme, width, "spreadsheet-types");
      await page.getByRole("button", { name: "View fields", exact: true }).first().click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await capture(page, info, theme, width, "spreadsheet-type-fields");
      await page.getByRole("dialog").locator("footer").getByRole("button", { name: "Close", exact: true }).click();
      await page.getByRole("button", { name: "Add spreadsheet type", exact: true }).click();
      await expect(page.getByRole("dialog", { name: "Add spreadsheet type", exact: true })).toBeVisible();
      await capture(page, info, theme, width, "spreadsheet-type-add");
      await page.getByRole("button", { name: "Add type", exact: true }).click();
      await expect(page.getByText("Check spreadsheet type", { exact: true })).toBeVisible();

      await open({ spreadsheetImport: true, spreadsheetImportView: "mapping" }, "&spreadsheetPreviewOutcome=failure");
      await page.evaluate(() => {
        const target = window as Window & { restoreSpreadsheetFault?: () => void };
        const replace = Reflect.get(history, "replaceState");
        const push = Reflect.get(history, "pushState");
        const preserve = (url?: string | URL | null) => {
          const next = new URL(url ?? location.href, location.href);
          next.searchParams.set("spreadsheetPreviewOutcome", "failure");
          return next;
        };
        history.replaceState = function (data, title, url) { replace.call(this, data, title, preserve(url)); };
        history.pushState = function (data, title, url) { push.call(this, data, title, preserve(url)); };
        target.restoreSpreadsheetFault = () => {
          history.replaceState = replace; history.pushState = push;
          const next = new URL(location.href); next.searchParams.delete("spreadsheetPreviewOutcome");
          history.replaceState(history.state, "", next);
          delete target.restoreSpreadsheetFault;
        };
      });
      const dialog = page.getByRole("dialog", { name: "Import spreadsheet", exact: true });
      await expect(dialog).toBeVisible();
      await capture(page, info, theme, width, "spreadsheet-mock-mapping");
      await dialog.getByRole("button", { name: "Preview", exact: true }).click();
      await expect(dialog.getByRole("button", { name: "Preview", exact: true })).toHaveAttribute("aria-pressed", "true");
      await capture(page, info, theme, width, "spreadsheet-mock-preview");
      await dialog.getByRole("button", { name: /^Import / }).click();
      await expect(page).toHaveURL(/spreadsheetPreviewOutcome=failure/u);
      await expect(dialog).toHaveCount(0);
      const failedImport = page.locator('[data-slot="toast"]').filter({ hasText: "couldn’t be imported" });
      await expect(failedImport).toBeVisible();
      await expect(page.getByRole("table", { name: "Registered spreadsheets", exact: true }).locator("tbody tr")).toHaveCount(3);
      await page.evaluate(() => (window as Window & { restoreSpreadsheetFault?: () => void }).restoreSpreadsheetFault?.());
      await expect(page).not.toHaveURL(/spreadsheetPreviewOutcome/u);
      await failedImport.hover();
      await page.getByRole("button", { name: "Try again", exact: true }).click();
      await expect(dialog).toBeVisible();
      await dialog.getByRole("button", { name: /^Import / }).click();
      await expect(page.locator('[data-slot="toast"]').filter({ hasText: "Roster imported" })).toBeVisible();
      await expect(dialog).toHaveCount(0);
      await expect(page.getByRole("table", { name: "Registered spreadsheets", exact: true }).locator("tbody tr")).toHaveCount(4);

      await attachTree(page, info, evidence("spreadsheet-library-coverage", theme, width));
    } finally {
      await page.evaluate(() => (window as Window & { restoreSpreadsheetFault?: () => void }).restoreSpreadsheetFault?.());
      await server.close();
    }
  });

  test(`baseline typed spreadsheet import and editor ${theme.attribute} ${width}`, {
    annotation: [{ type: "required-a11y-evidence", description: evidence("spreadsheet-typed", theme, width) }],
  }, async ({ page }, info) => {
    const server = await setup(page, theme, width);
    try {
      await gotoAppState(page, server.baseUrl, { day: FIXTURE_DAY, settings: "spreadsheets" });
      await page.getByLabel("Open XLSX or CSV", { exact: true }).setInputFiles({ name: "Baseline typed.csv", mimeType: "text/csv", buffer: Buffer.from("Legal Name,Employee ID,Personal Email,Private note\nJordan Lee,10000001,jordan@example.com,Excluded\nTaylor Chen,10000002,taylor@example.com,Excluded\n") });
      const dialog = page.getByRole("dialog", { name: "Choose spreadsheet columns", exact: true });
      await expect(dialog).toBeVisible();
      const submit = dialog.getByRole("button", { name: "Import selected columns", exact: true });
      await expect(dialog.getByRole("combobox", { name: "Dashboard field for B", exact: true })).toHaveAttribute("data-value", "eid");
      await expect(submit).toBeDisabled();

      await dialog.getByRole("checkbox", { name: "D · Private note", exact: true }).uncheck();
      await expect(submit).toBeEnabled();

      const eid = dialog.getByRole("combobox", { name: "Dashboard field for B", exact: true });
      await eid.click(); await page.getByRole("option", { name: "Legal name", exact: true }).click();
      await expect(submit).toBeDisabled();
      await expect(dialog.getByRole("status")).toContainText("mapped more than once");

      await eid.click(); await page.getByRole("option", { name: "Employee ID", exact: true }).click();
      await dialog.getByRole("checkbox", { name: "Keep all columns in this sheet", exact: true }).check();
      await dialog.getByRole("checkbox", { name: "Keep all columns in this sheet", exact: true }).uncheck();
      await expect(submit).toBeDisabled();

      await dialog.getByRole("checkbox", { name: "Keep all columns in this sheet", exact: true }).check();
      await dialog.getByRole("checkbox", { name: "D · Private note", exact: true }).uncheck();
      await expect(submit).toBeEnabled();

      await submit.click();
      const editor = page.getByRole("region", { name: "Spreadsheet editor", exact: true });
      await expect(editor).toBeVisible();
      await expect(page.locator('[data-slot="toast"]').filter({ hasText: "Spreadsheet imported" })).toBeVisible();

      await page.locator('[data-slot="toast-close"]').hover();
      await expect(page.locator('[data-slot="toast-close"]')).toHaveAttribute("aria-hidden", "false");
      await expect(page.locator('[data-slot="toast"]').getByRole("button", { name: "Dismiss", exact: true })).toBeVisible();
      await page.locator('[data-slot="toast"]').getByRole("button", { name: "Dismiss", exact: true }).click();
      await expect(page.locator('[data-slot="toast"]')).toHaveCount(0);
      await editor.getByRole("textbox", { name: "B2", exact: true }).fill("bad-id");
      await expect(editor.getByRole("textbox", { name: "B2", exact: true })).toHaveAttribute("aria-invalid", "true");
      await expect(editor.locator(".spreadsheet-cell-problem")).toBeVisible();

      await capture(page, info, theme, width, "spreadsheet-editor");
      await editor.getByRole("button", { name: "Columns", exact: true }).click();
      await expect(page.getByRole("menu", { name: "Columns", exact: true })).toBeVisible();
      await capture(page, info, theme, width, "spreadsheet-columns-menu");
      await page.keyboard.press("Escape");
      await editor.getByRole("button", { name: "Insert", exact: true }).click();
      await expect(page.getByRole("menu", { name: "Insert", exact: true })).toBeVisible();
      await capture(page, info, theme, width, "spreadsheet-insert-menu");
      await page.getByRole("menuitem", { name: "Add row", exact: true }).click();
      await expect(editor.locator(".spreadsheet-grid tbody tr")).toHaveCount(3);

      await editor.getByRole("button", { name: "Insert", exact: true }).click();
      await page.getByRole("menuitem", { name: "Add column", exact: true }).click();
      const columnDialog = page.getByRole("dialog", { name: "Add column", exact: true });
      await expect(columnDialog).toBeVisible();
      await expect(columnDialog.getByRole("button", { name: "Add column", exact: true })).toBeDisabled();
      await capture(page, info, theme, width, "spreadsheet-add-column-empty");
      await columnDialog.getByRole("textbox", { name: "Column title", exact: true }).fill("Baseline extra");
      await expect(columnDialog.getByRole("button", { name: "Add column", exact: true })).toBeEnabled();

      await columnDialog.getByRole("button", { name: "Cancel", exact: true }).click();
      await editor.getByRole("button", { name: "Export copy", exact: true }).click();
      await expect(page.getByRole("menu", { name: "Export copy", exact: true })).toBeVisible();
      await capture(page, info, theme, width, "spreadsheet-export-menu");
      await page.keyboard.press("Escape");
      await editor.getByRole("button", { name: "Spreadsheets", exact: true }).click();
      await expect(page.getByRole("dialog", { name: "Close edited spreadsheet?", exact: true })).toBeVisible();
      await capture(page, info, theme, width, "spreadsheet-close-edited");
      await page.getByRole("button", { name: "Keep editing", exact: true }).click();
      await editor.getByRole("button", { name: "Export copy", exact: true }).click();
      const download = page.waitForEvent("download");
      await page.getByRole("menuitem", { name: "Excel workbook (.xlsx)", exact: true }).click();
      expect((await download).suggestedFilename()).toBe("Baseline typed-edited.xlsx");
      await expect(page.locator('[data-slot="toast"]').filter({ hasText: "Spreadsheet copy exported" })).toBeVisible();

      await attachTree(page, info, evidence("spreadsheet-typed", theme, width));
    } finally { await server.close(); }
  });
  test(`baseline Routes filtering and validation ${theme.attribute} ${width}`, {
    annotation: [{ type: "required-a11y-evidence", description: evidence("routes", theme, width) }],
  }, async ({ page }, info) => {
    const server = await setup(page, theme, width);
    try {
      await gotoAppState(page, server.baseUrl, { day: FIXTURE_DAY, settings: "routes" });
      const search = page.getByRole("searchbox", { name: "Find a system or route", exact: true });
      await expect(search).toBeVisible();
      await capture(page, info, theme, width, "routes-default");
      await search.fill("CRM");
      await expect(page.locator('[data-settings-path="urls.crm.prod"]')).toBeVisible();
      await expect(page.locator('[data-settings-path="urls.kuali.prod"]')).toHaveCount(0);

      await search.fill("zz-no-system");
      await expect(page.getByText('No routes match “zz-no-system”.', { exact: true })).toBeVisible();
      await capture(page, info, theme, width, "routes-no-results");
      await search.fill("CRM");
      const entry = page.locator('[data-settings-path="urls.crm.prod"] input').first();
      await entry.fill("not-a-url");
      await expect(entry).toHaveAttribute("aria-invalid", "true");
      await expect(page.locator(".routes-page-error")).toBeVisible();

      await attachTree(page, info, evidence("routes", theme, width));
    } finally { await server.close(); }
  });

  for (const scene of ["healthy", "stale"] as const) {
    test(`baseline Preflight refresh ${scene} ${theme.attribute} ${width}`, {
      annotation: [{ type: "required-a11y-evidence", description: evidence(`preflight-${scene}-coverage`, theme, width) }],
    }, async ({ page }, info) => {
      ensureParityBundle();
      const server = await startSetupPreflightServer(scene);
      const gate = Promise.withResolvers<void>();
      try {
        await page.setViewportSize({ width, height: 720 });
        await page.clock.setFixedTime(new Date(server.now));
        await installTheme(page, theme);
        await gotoAppState(page, server.baseUrl, { day: FIXTURE_DAY, settings: "preflight" });
        const setupRegion = page.getByRole("region", { name: "Preflight", exact: true });
        await expect(setupRegion).toContainText(scene === "healthy" ? "Ready to run" : "Previous check");
        await capture(page, info, theme, width, `preflight-${scene}`);

        const disclosure = setupRegion.locator(".workflow-operations-card").first().getByRole("button").first();
        await expect(disclosure).toHaveAttribute("aria-expanded", "true");
        await disclosure.click();
        await expect(disclosure).toHaveAttribute("aria-expanded", "false");

        await page.route("**/api/v1/preflight/rerun", async route => { await gate.promise; await route.abort("failed"); });
        await setupRegion.getByRole("button", { name: "Run preflight", exact: true }).click();
        await expect(setupRegion.getByRole("group", { name: "Readiness summary", exact: true })).toContainText("Checking readiness");

        gate.resolve();
        await expect(setupRegion.getByText("Previous result", { exact: true })).toBeVisible();
        await expect(setupRegion.getByRole("button", { name: "Run preflight", exact: true })).toBeEnabled();

        await attachTree(page, info, evidence(`preflight-${scene}-coverage`, theme, width));
      } finally { gate.resolve(); await server.close(); }
    });
  }

  test(`baseline spreadsheet reading and failure ${theme.attribute} ${width}`, {
    annotation: [{ type: "required-a11y-evidence", description: evidence("spreadsheet-reading", theme, width) }],
  }, async ({ page }, info) => {
    const server = await setup(page, theme, width);
    const gate = Promise.withResolvers<void>();
    await page.route("**/assets/spreadsheet-import-worker-*.js", async route => { await gate.promise; await route.abort("failed"); });
    try {
      await gotoAppState(page, server.baseUrl, { day: FIXTURE_DAY, settings: "spreadsheets" });
      await page.getByLabel("Open XLSX or CSV", { exact: true }).setInputFiles({ name: "Baseline reading.csv", mimeType: "text/csv", buffer: Buffer.from("Employee ID\n10000001\n") });
      await expect(page.getByRole("button", { name: "Importing…", exact: true })).toBeDisabled();

      gate.resolve();
      await expect(page.getByText("SPREADSHEET_WORKER_FAILED", { exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Import spreadsheet", exact: true })).toBeEnabled();

      await attachTree(page, info, evidence("spreadsheet-reading", theme, width));
    } finally { gate.resolve(); await server.close(); }
  });
  test(`baseline Credentials save outcomes ${theme.attribute} ${width}`, {
    annotation: [{ type: "required-a11y-evidence", description: evidence("credentials-save", theme, width) }],
  }, async ({ page }, info) => {
    const server = await setup(page, theme, width);
    let document = fixtureSettingsDocument();
    const gate = Promise.withResolvers<void>();
    await page.route("**/api/v1/settings/editable", route => route.fulfill({ json: document }));
    await page.route("**/api/v1/commands", route => {
      const command = ProtectedSettingsCommandRequestSchema.parse(route.request().postDataJSON());
      const authority = document.protectedSettings;
      if (authority.state !== "available") throw new Error("baseline-protected-authority-unavailable");
      const operation = command.payload.entries.ucpathUserId;
      if (operation === undefined || !("set" in operation)) throw new Error("baseline-username-set-required");
      const identity = { valueId: "11111111-1111-4111-8111-111111111111", updatedAt: FIXTURE_NOW };
      const readback = { revision: authority.readback.revision + 1, entries: { ...authority.readback.entries, ucpathUserId: { present: true, ...identity } } };
      document = EditableSettingsWireSchema.parse({ ...document, protectedSettings: { ...authority,
        entries: { ...authority.entries, ucpathUserId: { ...identity, value: operation.set } }, readback } });
      return route.fulfill({ json: { state: "applied", commandId: command.commandId,
        affectedTargets: [{ family: "protected-settings", revision: readback.revision }], restartRequired: false, ...readback } });
    });
    try {
      await gotoAppState(page, server.baseUrl, { day: FIXTURE_DAY, settings: "credentials" });
      const username = page.getByRole("textbox", { name: "UCPath username", exact: true });
      const heading = page.getByRole("heading", { name: "Credentials", exact: true });
      await expect(username).toBeVisible();
      await page.route("**/api/v1/commands", async route => { await gate.promise; await route.fallback(); }, { times: 1 });
      await username.fill("synthetic-baseline-user"); await heading.click();
      await expect(page.getByText("Saving…", { exact: true })).toBeVisible();

      gate.resolve();
      await expect(page.locator('[data-slot="toast"]').filter({ hasText: "Saved UCPath username" })).toBeVisible();

      await page.locator('[data-slot="toast-close"]').hover();
      await expect(page.locator('[data-slot="toast-close"]')).toHaveAttribute("aria-hidden", "false");
      await expect(page.locator('[data-slot="toast"]').getByRole("button", { name: "Dismiss", exact: true })).toBeVisible();
      await page.locator('[data-slot="toast"]').getByRole("button", { name: "Dismiss", exact: true }).click();
      await expect(page.locator('[data-slot="toast"]')).toHaveCount(0);
      await expect(page.getByText("Saved", { exact: true })).toBeVisible();

      await page.route("**/api/v1/commands", route => route.abort("failed"), { times: 1 });
      await username.fill("synthetic-unconfirmed-user"); await heading.click();
      await expect(page.getByText("Credentials write unconfirmed", { exact: true })).toBeVisible();

      await page.reload(); await expect(username).toHaveValue("synthetic-baseline-user");
      await page.route("**/api/v1/commands", route => route.fulfill({ status: 403, json: { state: "error", code: "OPERATOR_MUTATION_ORIGIN_REFUSED", message: "Synthetic refusal", retryable: false } }), { times: 1 });
      await username.fill("synthetic-refused-user"); await heading.click();
      await expect(page.getByText("Credentials were not applied", { exact: true })).toBeVisible();

      await attachTree(page, info, evidence("credentials-save", theme, width));
    } finally { gate.resolve(); await server.close(); }
  });

  test(`baseline runtime path authority ${theme.attribute} ${width}`, {
    annotation: [{ type: "required-a11y-evidence", description: evidence("runtime-path-read", theme, width) }],
  }, async ({ page }, info) => {
    const server = await setup(page, theme, width);
    const gate = Promise.withResolvers<void>();
    await page.route("**/api/v1/settings/storage-relocation", async route => { await gate.promise; await route.fulfill({ status: 503, json: { state: "error", code: "fixture-unavailable", message: "Synthetic relocation unavailable", retryable: true } }); });
    try {
      await gotoAppState(page, server.baseUrl, { day: FIXTURE_DAY, settings: "paths" });
      await expect(page.getByRole("status", { name: "Loading runtime locations", exact: true })).toBeVisible();

      gate.resolve();
      await expect(page.getByText("Runtime locations unavailable", { exact: true })).toBeVisible();

      await attachTree(page, info, evidence("runtime-path-read", theme, width));
    } finally { gate.resolve(); await server.close(); }
  });
}

test("Settings missing parts delay skeletons and retain independent Paths rows", { annotation: [{ type: "required-a11y-evidence", description: "settings-independent-paths.a11y.yml" }] }, async ({ page }, info) => {
  const server = await setup(page, PARITY_THEMES[0], 1280);
  const gate = Promise.withResolvers<void>();
  let reached = 0;
  await page.route("**/api/v1/settings/editable", async route => { reached++; await gate.promise; await route.fulfill({ status: 503, json: { state: "error", code: "SETTINGS_INITIAL_READ_UNAVAILABLE", message: "Synthetic read failure", retryable: true } }); });
  try {
    await gotoAppState(page, server.baseUrl, { day: FIXTURE_DAY, settings: "paths" });
    await expect(page.getByRole("button", { name: "Change Runtime state folder", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Change Artifact folder", exact: true })).toBeVisible();
    await expect(page.getByRole("status", { name: "Loading workflow paths", exact: true }).first()).toBeVisible();
    expect(reached).toBe(1);
    gate.resolve();
    await expect(page.getByText("Editable settings could not be read", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Change Runtime state folder", exact: true })).toBeVisible();
    await expect(page.locator('.settings-tab-body [data-slot="skeleton"]')).toHaveCount(0);
    await attachTree(page, info, "settings-independent-paths.a11y.yml");
  } finally { gate.resolve(); await server.close(); }
});

test("Settings fast reads never mount a skeleton and a revisit keeps the exact editable value", { annotation: [{ type: "required-a11y-evidence", description: "settings-retained-editable.a11y.yml" }] }, async ({ page }, info) => {
  const server = await setup(page, PARITY_THEMES[0], 1280);
  const gate = Promise.withResolvers<void>();
  let calls = 0;
  const fast = Promise.withResolvers<void>();
  await page.clock.install({ time: new Date(FIXTURE_NOW) });
  await page.clock.pauseAt(new Date(new Date(FIXTURE_NOW).valueOf() + 1000));
  await page.addInitScript(() => {
    Reflect.set(window, "settingsSkeletonSeen", false);
    new MutationObserver(() => { if (document.querySelector('[data-settings-loading]')) Reflect.set(window, "settingsSkeletonSeen", true); }).observe(document, { childList: true, subtree: true, attributes: true });
  });
  await page.route("**/api/v1/settings/editable", async route => {
    calls++;
    if (calls === 1) { await fast.promise; await route.fulfill({ json: fixtureSettingsDocument() }); }
    else { await gate.promise; await route.fulfill({ status: 503, json: { state: "error", code: "SETTINGS_INITIAL_READ_UNAVAILABLE", message: "Synthetic read failure", retryable: true } }); }
  });
  try {
    await page.goto(`${server.baseUrl}/?day=${FIXTURE_DAY}&settings=performance`);
    await expect.poll(() => calls).toBe(1);
    await page.clock.runFor(80);
    fast.resolve();
    const field = page.locator('[data-settings-path="timeouts.navigationMs"] input').first();
    await expect(field).toBeVisible();
    const value = await field.inputValue();
    expect(await page.evaluate(() => Reflect.get(window, "settingsSkeletonSeen") === true)).toBe(false);
    await page.clock.resume();
    await page.getByRole("button", { name: "Back to dashboard", exact: true }).click();
    await page.locator("#settings-gear").click();
    await page.locator("a[href='?settings=performance']").first().click();
    await expect.poll(() => calls).toBe(2);
    await expect(field).toHaveValue(value);
    await expect(page.locator('[data-settings-loading]')).toHaveCount(0);
    gate.resolve();
    await expect(page.getByText("Current settings unavailable", { exact: true })).toBeVisible();
    await expect(field).toHaveValue(value);
    await expect(page.locator('[data-settings-loading]')).toHaveCount(0);
    await attachTree(page, info, "settings-retained-editable.a11y.yml");
  } finally { fast.resolve(); gate.resolve(); await server.close(); }
});
