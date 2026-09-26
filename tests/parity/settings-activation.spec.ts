import { expect, test } from "@playwright/test";
import { resolve } from "node:path";
import { createDashboardClient } from "../../src/dashboard/client/index.js";
import { deriveSettingsPatchFingerprint } from "../../src/domain/config/settings.js";
import { createHash, randomUUID } from "node:crypto";
import { startSettingsActivationServer } from "./helpers/fixture-settings-activation.js";
import { PARITY_THEMES, installTheme, assertThemeApplied, captureParityPair } from "./helpers/capture.js";
import { ensureParityBundle } from "./helpers/bundle.js";

for (const theme of PARITY_THEMES) test(`settings activation ${theme.name}: real save, refusal, reset and keyboard at minimum desktop`, { annotation: [{ type: "required-a11y-evidence", description: `settings-activation-${theme.name}.a11y.yml` }] }, async ({ page }) => {
  ensureParityBundle(); const server = await startSettingsActivationServer();
  try {
    const pageErrors: string[] = []; page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.setViewportSize({ width: 1024, height: 720 }); await installTheme(page, theme);
    await page.goto(`${server.url}/?settings=display`);
    const width = page.getByRole("spinbutton", { name: "Screen width" });
    const height = page.getByRole("spinbutton", { name: "Screen height" });
    await expect(width).toHaveValue("2560"); await assertThemeApplied(page, theme);
    await width.focus(); await expect(width).toBeFocused(); await page.keyboard.press("Tab");
    await expect(height).toBeFocused();
    await expect(page.getByText("Setting identities", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Save changes", exact: true })).toHaveCount(0);
    await width.fill("0"); await expect(page.getByText("Enter a whole number of at least 1.")).toBeVisible();
    let release: () => void = () => {};
    const pending = new Promise<void>((resolvePending) => { release = resolvePending; });
    await page.route("**/api/v1/commands", async (route) => { await pending; await route.continue(); }, { times: 1 });
    await width.fill("1980"); await height.fill("1080");
    await expect(page.getByText("Saving…", { exact: true })).toBeVisible(); release();
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    const client = createDashboardClient({ baseUrl: server.url });
    const saved = await client.editableSettings(); expect(saved.runtimeStatus.state).toBe("current"); expect(saved.revision).toBe(2);
    await expect(width).toHaveValue("1980");
    await captureParityPair(page, resolve(import.meta.dirname, "references"), {
      stateId: "settings-activation-saved", viewport: "1024x720", theme: theme.name,
      adapter: "real-settings", fixtureId: "settings-activation", descriptorHash: "settings-activation-v1",
      appVersion: "0.1.0", capturedAt: "2026-09-09T12:00:00.000Z", variant: "default",
    });
    // Another client advances authority while the browser still holds revision two.
    const patch = { "timeouts.taskMs": { set: 90_000 } } as const;
    await client.applySettings({ family: "settings", type: "apply-settings", commandId: randomUUID(),
      requestedAt: "2026-09-09T12:00:00.000Z", requestedBy: "local-operator", source: "settings-surface",
      target: { expectedRevision: saved.revision }, payload: { settingsSchemaHash: saved.settingsSchemaHash,
        patchFingerprint: deriveSettingsPatchFingerprint(patch), patch } });
    await width.fill("1800");
    await expect(page.getByText(/Current values are refreshed beside your retained edit/)).toBeVisible();
    expect((await client.editableSettings()).revision).toBe(3);
    await page.reload(); await expect(width).toHaveValue("1980");
    await page.route("**/api/v1/commands", (route) => route.abort("failed"), { times: 1 });
    await width.fill("1800");
    await expect(page.getByText("Settings write unconfirmed", { exact: true })).toBeVisible();
    expect((await client.editableSettings()).revision).toBe(3);
    await page.reload(); await expect(width).toHaveValue("1980");
    await page.goto(`${server.url}/?settings=paths`);
    await page.getByRole("textbox", { name: "Reports directory" }).fill("relative-path");
    await page.getByRole("textbox", { name: "Reports directory" }).press("Control+Enter");
    await expect(page.getByRole("textbox", { name: "Reports directory" })).toBeFocused();
    await expect(page.getByText("Enter an absolute path.")).toBeVisible();
    expect((await client.editableSettings()).revision).toBe(3);
    await page.goto(`${server.url}/?settings=display`); await expect(width).toHaveValue("1980");
    await width.fill("2560"); await height.fill("1440");
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    const savedDefault = await client.editableSettings(); expect(savedDefault.revision).toBe(4);
    expect(savedDefault.sections.flatMap(section => section.leaves).find(leaf => leaf.path === "display.screenWidth")?.settingsValue).toBe(2560);
    await page.locator('[data-settings-path="display.screenWidth"]').getByRole("button", { name: "Restore standard", exact: true }).click();
    await expect.poll(async () => (await client.editableSettings()).revision).toBe(5);
    const reset = await client.editableSettings(); expect(reset.revision).toBe(5);
    expect(reset.sections.flatMap((section) => section.leaves).find((leaf) => leaf.path === "display.screenWidth")?.settingsValue).toBeUndefined();
    await page.evaluate(() => { document.documentElement.style.zoom = "1.25"; });
    await expect(width).toBeVisible(); await width.focus(); await expect(width).toBeFocused();
    await captureParityPair(page, resolve(import.meta.dirname, "references"), {
      stateId: "settings-activation-reset", viewport: "1024x720", theme: theme.name,
      adapter: "real-settings", fixtureId: "settings-activation", descriptorHash: "settings-activation-v1",
      appVersion: "0.1.0", capturedAt: "2026-09-09T12:00:00.000Z", variant: "zoom125",
    });
    await page.goto(`${server.url}/?settings=performance`);
    const task = page.getByRole("textbox", { name: "Task in minutes" });
    await expect(task).toHaveValue("1.5");
    await task.fill("3.000016");
    await expect(page.getByText("Enter a positive duration that resolves to a whole millisecond.")).toBeVisible();
    expect((await client.editableSettings()).revision).toBe(5);
    await task.fill("3.5");
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    const savedTimeout = await client.editableSettings();
    expect(savedTimeout.sections.flatMap(section => section.leaves).find(leaf => leaf.path === "timeouts.taskMs")?.settingsValue).toBe(210_000);
    await expect(task).toHaveValue("3.5");
    await page.getByRole("combobox", { name: "Task unit" }).selectOption("seconds");
    await expect(page.getByRole("textbox", { name: "Task in seconds" })).toHaveValue("210");
    await page.getByRole("textbox", { name: "Task in seconds" }).fill("210.001");
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    expect((await client.editableSettings()).sections.flatMap(section => section.leaves).find(leaf => leaf.path === "timeouts.taskMs")?.settingsValue).toBe(210_001);
    expect(pageErrors).toEqual([]);
    const tree = await page.locator("body").ariaSnapshot();
    const a11yName = `settings-activation-${theme.name}.a11y.yml`;
    test.info().annotations.push({ type: `a11y-attachment-sha256:${a11yName}`,
      description: createHash("sha256").update(tree).digest("hex") });
    await test.info().attach(a11yName, { body: tree, contentType: "text/yaml" });
  } finally { await server.stop(); }
});

test("Routes saves a complete production system only after Save routes", async ({ page }) => {
  ensureParityBundle();
  const server = await startSettingsActivationServer();
  try {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`${server.url}/?settings=routes`);
    const entry = page.locator('[data-settings-path="urls.crm.prod"] input').first();
    await expect(entry).toHaveValue(/^https:\/\//u);
    await entry.fill("https://crm.example.test/hr");
    const client = createDashboardClient({ baseUrl: server.url });
    await page.waitForTimeout(800);
    expect((await client.editableSettings()).revision).toBe(1);
    await page.getByRole("button", { name: "Save routes" }).first().click();
    await expect.poll(async () => (await client.editableSettings()).revision).toBe(2);
    const saved = await client.editableSettings();
    const route = saved.sections.find(section => section.id === "routes")?.leaves.find(leaf => leaf.path === "urls.crm.prod");
    expect(route?.settingsValue).toMatchObject({ entry: "https://crm.example.test/hr" });
  } finally { await server.stop(); }
});
