import { AuthoritySourceClosureUnprovedError } from '../../src/backend/storage/source-closure.js';
import { expect, test } from "@playwright/test";

import { createDashboardClient } from "../../src/dashboard/client/index.js";
import { deriveSettingsPatchFingerprint } from "../../src/models/config/settings.js";
import { createHash, randomUUID } from "node:crypto";
import { startSettingsActivationServer } from "./helpers/fixture-settings-activation.js";
import { PARITY_THEMES, installTheme, assertThemeApplied } from "./helpers/capture.js";
import { ensureParityBundle } from "./helpers/bundle.js";

const retainedParityFixtureFailures = new Set<object>();

for (const theme of PARITY_THEMES) test(`settings activation ${theme.name}: current Paths, exact Task authority and keyboard at minimum desktop`, { annotation: [{ type: "required-a11y-evidence", description: `settings-activation-${theme.name}.a11y.yml` }] }, async ({ page }) => {
  ensureParityBundle(); const server = await startSettingsActivationServer();
  let parityBodyFailure: { error: unknown } | undefined;
  try {
    const pageErrors: string[] = []; page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.setViewportSize({ width: 1024, height: 720 }); await installTheme(page, theme);
    await page.goto(`${server.url}/?settings=paths`);
    await assertThemeApplied(page, theme);
    const reports = page.getByRole("button", { name: "Change Reports directory", exact: true });
    await expect(reports).toBeVisible(); await expect(reports).toBeEnabled();
    await reports.focus(); await expect(reports).toBeFocused();
    const client = createDashboardClient({ baseUrl: server.url });
    const initial = await client.editableSettings(); expect(initial.revision).toBe(1);
    expect(initial.runtimeStatus.state).toBe("current");
    const patch = { "timeouts.taskMs": { set: 90_000 } } as const;
    await client.applySettings({ family: "settings", type: "apply-settings", commandId: randomUUID(),
      requestedAt: "2026-09-09T12:00:00.000Z", requestedBy: "local-operator", source: "settings-surface",
      target: { expectedRevision: initial.revision }, payload: { settingsSchemaHash: initial.settingsSchemaHash,
        patchFingerprint: deriveSettingsPatchFingerprint(patch), patch } });
    expect((await client.editableSettings()).revision).toBe(2);
    await page.goto(`${server.url}/?settings=performance`);
    const task = page.getByRole("textbox", { name: "Task", exact: true });
    await expect(task).toHaveValue("90");
    await task.fill("180.00096");
    await expect(page.getByText("Enter a positive duration that resolves to a whole millisecond.")).toBeVisible();
    expect((await client.editableSettings()).revision).toBe(2);
    let release: () => void = () => {};
    const pending = new Promise<void>(resolve => { release = resolve; });
    await page.route("**/api/v1/commands", async route => { await pending; await route.continue(); }, { times: 1 });
    await task.fill("210"); await task.blur();
    await expect(page.getByText("Saving…", { exact: true })).toBeVisible(); release();
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    const savedTimeout = await client.editableSettings(); expect(savedTimeout.revision).toBe(3);
    expect(savedTimeout.sections.flatMap(section => section.leaves).find(leaf => leaf.path === "timeouts.taskMs")?.settingsValue).toBe(210_000);
    await expect(task).toHaveValue("210");
    await task.fill("210.001"); await task.blur();
    await expect.poll(async () => (await client.editableSettings()).revision).toBe(4);
    expect((await client.editableSettings()).sections.flatMap(section => section.leaves).find(leaf => leaf.path === "timeouts.taskMs")?.settingsValue).toBe(210_001);
    await page.evaluate(() => { document.documentElement.style.zoom = "1.25"; });
    await expect(task).toBeVisible(); await task.focus(); await expect(task).toBeFocused();
    expect(pageErrors).toEqual([]);
    const tree = await page.locator("body").ariaSnapshot();
    const a11yName = `settings-activation-${theme.name}.a11y.yml`;
    test.info().annotations.push({ type: `a11y-attachment-sha256:${a11yName}`,
      description: createHash("sha256").update(tree).digest("hex") });
    await test.info().attach(a11yName, { body: tree, contentType: "text/yaml" });
  } catch (error) { parityBodyFailure = { error }; }
  if (parityBodyFailure?.error instanceof AuthoritySourceClosureUnprovedError) {
    retainedParityFixtureFailures.add({ owner: server, primary: parityBodyFailure.error });
    throw parityBodyFailure.error;
  }
  let parityCleanupFailure: { error: unknown } | undefined;
  try { await server.stop(); } catch (error) { parityCleanupFailure = { error }; }
  if (parityCleanupFailure !== undefined) {
    retainedParityFixtureFailures.add({ owner: server, primary: parityBodyFailure?.error, cleanup: parityCleanupFailure.error });
    if (parityBodyFailure !== undefined) throw new AggregateError([parityBodyFailure.error, parityCleanupFailure.error], 'parity-body-and-cleanup-failed', { cause: parityBodyFailure.error });
    throw parityCleanupFailure.error;
  }
  if (parityBodyFailure !== undefined) throw parityBodyFailure.error;
});

test("Routes autosaves a complete production system after its field loses focus", async ({ page }) => {
  ensureParityBundle();
  const server = await startSettingsActivationServer();
  let parityBodyFailure: { error: unknown } | undefined;
  try {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`${server.url}/?settings=routes`);
    const entry = page.locator('[data-settings-path="urls.crm.prod"] input').first();
    await expect(entry).toHaveValue(/^https:\/\//u);
    await entry.fill("https://crm.example.test/hr");
    const client = createDashboardClient({ baseUrl: server.url });
    await expect(page.getByRole("button", { name: "Save routes" })).toHaveCount(0);
    await entry.blur();
    await expect.poll(async () => (await client.editableSettings()).revision).toBe(2);
    const saved = await client.editableSettings();
    const route = saved.sections.find(section => section.id === "routes")?.leaves.find(leaf => leaf.path === "urls.crm.prod");
    expect(route?.settingsValue).toMatchObject({ entry: "https://crm.example.test/hr" });
  } catch (error) { parityBodyFailure = { error }; }
  if (parityBodyFailure?.error instanceof AuthoritySourceClosureUnprovedError) {
    retainedParityFixtureFailures.add({ owner: server, primary: parityBodyFailure.error });
    throw parityBodyFailure.error;
  }
  let parityCleanupFailure: { error: unknown } | undefined;
  try { await server.stop(); } catch (error) { parityCleanupFailure = { error }; }
  if (parityCleanupFailure !== undefined) {
    retainedParityFixtureFailures.add({ owner: server, primary: parityBodyFailure?.error, cleanup: parityCleanupFailure.error });
    if (parityBodyFailure !== undefined) throw new AggregateError([parityBodyFailure.error, parityCleanupFailure.error], 'parity-body-and-cleanup-failed', { cause: parityBodyFailure.error });
    throw parityCleanupFailure.error;
  }
  if (parityBodyFailure !== undefined) throw parityBodyFailure.error;
});
