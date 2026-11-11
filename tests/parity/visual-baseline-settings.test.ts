import { expect, type Page, type TestInfo } from "@playwright/test";
import { test } from "./helpers/fixtures.js";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { mergeSettingsPatch } from "../../src/models/config/settings.js";
import { ProtectedSettingsCommandRequestSchema, SettingsCommandRequestSchema } from "../../src/rules/commands/commands.js";
import { PARITY_DIST_DIR } from "./helpers/bundle.js";
import { assertThemeApplied, captureParityPair, installTheme, PARITY_THEMES, type ParityTheme } from "./helpers/capture.js";
import { gotoAppState, installServedSurfaces } from "./helpers/app-driver.js";
import { disposeHttpRouteHarness } from "../support/helpers/backend/http-route-harness.js";
import { startFixtureServer } from "../support/helpers/dashboard/fixture-bff.js";
import { EditableSettingsWireSchema } from "../../src/models/dashboard/settings-editor.js";
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
  const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
  await installServedSurfaces(page);
  await page.setViewportSize({ width, height: 720 });
  await page.clock.setFixedTime(new Date(FIXTURE_NOW));
  await installTheme(page, theme);
  return server;
}

for (const theme of PARITY_THEMES) for (const width of [1280]) {
  for (const section of ["general", "credentials", "performance"] as const) {
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
      await expect(page.getByRole("button", { name: "Connect ChatGPT", exact: true })).toBeVisible();
      await capture(page, info, theme, width, "general-signed-out");
      await page.getByRole("button", { name: "Connect ChatGPT", exact: true }).click();
      await expect(page.getByRole("button", { name: "Disconnect", exact: true })).toBeVisible();

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

      const saved = page.locator('[data-slot="toast"]').filter({ hasText: "Saved Task" });
      await saved.focus();
      await expect(saved).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(page.locator('[data-slot="toast"]')).toHaveCount(0);
      await expect(page.getByText("Saved", { exact: true })).toBeVisible();

      await page.route("**/api/v1/commands", route => route.abort("failed"), { times: 1 });
      await task.fill("240");
      await expect(page.getByText("Settings save unconfirmed", { exact: true })).toBeVisible();

      await page.reload(); await expect(task).toBeVisible();
      await page.route("**/api/v1/commands", route => route.fulfill({ status: 403, json: { state: "error", code: "OPERATOR_MUTATION_ORIGIN_REFUSED", message: "Synthetic refusal", retryable: false } }), { times: 1 });
      await task.fill("270");
      await expect(page.getByText("Settings weren't saved", { exact: true })).toBeVisible();

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
      await attachTree(page, info, evidence("paths-credentials", theme, width));
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
      const heading = page.getByRole("heading", { name: "Account", level: 1, exact: true });
      await expect(username).toBeVisible();
      await page.route("**/api/v1/commands", async route => { await gate.promise; await route.fallback(); }, { times: 1 });
      await username.fill("synthetic-baseline-user"); await heading.click();
      await expect(page.getByText("Saving…", { exact: true })).toBeVisible();

      gate.resolve();
      await expect(page.locator('[data-slot="toast"]').filter({ hasText: "Saved UCPath username" })).toBeVisible();

      await page.locator('[data-slot="toast"]').first().click();
      await expect(page.locator('[data-slot="toast"]')).toHaveCount(0);
      await expect(page.getByText("Saved", { exact: true })).toBeVisible();

      await page.route("**/api/v1/commands", route => route.abort("failed"), { times: 1 });
      await username.fill("synthetic-unconfirmed-user"); await heading.click();
      await expect(page.getByText("Credentials save unconfirmed", { exact: true })).toBeVisible();

      await page.reload(); await expect(username).toHaveValue("synthetic-baseline-user");
      await page.route("**/api/v1/commands", route => route.fulfill({ status: 403, json: { state: "error", code: "OPERATOR_MUTATION_ORIGIN_REFUSED", message: "Synthetic refusal", retryable: false } }), { times: 1 });
      await username.fill("synthetic-refused-user"); await heading.click();
      await expect(page.getByText("Credentials weren't saved", { exact: true })).toBeVisible();

      await attachTree(page, info, evidence("credentials-save", theme, width));
    } finally { gate.resolve(); await server.close(); }
  });
}

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
    await page.getByRole("searchbox", { name: "Search settings", exact: true }).fill("backoff");
    await page.getByRole("link", { name: "Backoff base Performance", exact: true }).click();
    await page.getByRole("searchbox", { name: "Search settings", exact: true }).fill("");
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
