import { expect, test, type Page } from "@playwright/test";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createDashboardClient } from "../../src/dashboard/client/index.js";
import { ProtectedSettingsCommandRequestSchema, SettingsCommandRequestSchema } from "../../src/domain/commands.js";
import { deriveSettingsPatchFingerprint } from "../../src/domain/config/settings.js";
import { EditableSettingsWireSchema } from "../../src/domain/dashboard/settings-editor.js";
import { fixtureSettingsDocument } from "./helpers/fixture-settings.js";
import { startSettingsActivationServer } from "./helpers/fixture-settings-activation.js";
import { ensureParityBundle } from "./helpers/bundle.js";
import { PARITY_THEMES, installTheme, assertThemeApplied, captureParityPair } from "./helpers/capture.js";
import { REFERENCES, registerReferenceServers } from "./helpers/reference-harness.js";
import { FIXTURE_APP_VERSION, FIXTURE_DAY, FIXTURE_DESCRIPTOR_HASH } from "./helpers/fixture-identity.js";

async function attachTree(page: Page, name: string): Promise<void> {
  const body = await page.locator("body").ariaSnapshot();
  test.info().annotations.push({ type: `a11y-attachment-sha256:${name}`, description: createHash("sha256").update(body).digest("hex") });
  await test.info().attach(name, { body, contentType: "text/yaml" });
}
const scenes = [
  { id: "structured", section: "providers", title: "Provider budgets & models" },
  { id: "credentials", section: "protected-store", title: "Credentials" },
  { id: "readonly", section: "runtime-isolation", title: "Deployment" },
  { id: "annual", section: "annual-dates", title: "Annual dates" },
  { id: "conflict", section: "general", title: "General" },
] as const;
const servers = registerReferenceServers(["server"]);
for (const theme of PARITY_THEMES) for (const scene of scenes) test(`settings catalog ${scene.id} @ ${theme.name}`, async ({ page }) => {
  let document = fixtureSettingsDocument({ providers: { gemini: { models: ["model-second", "model-first"] } }, annualDates: { FY2027: { jobEndDate: "6/30/2027", kronosDefaultEndDate: "6/30/2027", kronosDefaultStartDate: "7/1/2026" } } }, 2);
  if (document.protectedSettings.state !== "available") throw new Error("fixture-credential-store-unavailable");
  document = EditableSettingsWireSchema.parse({ ...document, protectedSettings: { ...document.protectedSettings,
    entries: { ...document.protectedSettings.entries, ucpathPassword: {
      valueId: "00000000-0000-4000-8000-000000000092", value: "synthetic-visible-credential", updatedAt: "2026-09-09T12:00:00.000Z",
    } },
    readback: { revision: 2, entries: { ...document.protectedSettings.readback.entries,
      ucpathPassword: { present: true, valueId: "00000000-0000-4000-8000-000000000092", updatedAt: "2026-09-09T12:00:00.000Z" } } } } });
  await page.route("**/api/v1/settings/editable", route => route.fulfill({ json: document }));
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.setViewportSize({ width: 1024, height: 720 }); await installTheme(page, theme);
  await page.goto(`${servers.server.baseUrl}/?day=${FIXTURE_DAY}&settings=${scene.section}`);
  await expect(page.getByRole("heading", { name: scene.title, exact: true })).toBeVisible();
  await assertThemeApplied(page, theme);
  if (scene.id === "structured") {
    await expect(page.locator('[data-settings-path="providers.gemini.models"] textarea')).toHaveValue("model-second\nmodel-first");
    expect(await page.locator('input[type="number"]').count()).toBeGreaterThan(5);
  } else if (scene.id === "credentials") {
    await expect(page.locator('[data-protected-name] input[type="text"]')).toHaveCount(5);
    for (const input of await page.locator('[data-protected-name] input[type="text"]').all()) await expect(input).toHaveValue("");
    await expect(page.getByText("Present", { exact: true })).toHaveCount(1);
    await expect(page.getByText("Missing", { exact: true })).toHaveCount(4);
    await expect(page.getByText("synthetic-visible-credential", { exact: true })).toBeVisible();
  } else if (scene.id === "readonly") {
    await expect(page.locator("input,textarea,select")).toHaveCount(0);
    await expect(page.getByText("Source: active process configuration. Read-only here; changes apply after restart.", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Production routes", exact: true })).toBeVisible();
    await expect(page.getByText("Runtime state folder", { exact: true })).toBeVisible();
    await expect(page.getByText("Login URL", { exact: true })).toBeVisible();
    const identity = page.getByText("Runtime state folder", { exact: true }).locator("xpath=..").locator("details > summary");
    await identity.focus(); await page.keyboard.press("Enter");
    await expect(page.getByText("paths.stateRoot", { exact: true })).toBeVisible();
  } else if (scene.id === "annual") {
    await expect(page.locator('[data-settings-path^="annualDates.FY2027."]')).toHaveCount(3);
  } else {
    await page.getByRole("textbox", { name: "Operator label" }).fill("Retained operator draft");
    await page.route("**/api/v1/commands", async route => {
      const request = SettingsCommandRequestSchema.parse(route.request().postDataJSON());
      document = { ...fixtureSettingsDocument({ actor: { label: "Competing operator" } }, 3), protectedSettings: document.protectedSettings };
      await route.fulfill({ json: { state: "conflict", commandId: request.commandId, currentVersion: 3, message: "synthetic diagnostic must not render" } });
    });
    await page.getByRole("button", { name: "Save 1", exact: true }).click();
    await expect(page.getByText(/Current values are refreshed beside your retained draft/u)).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Operator label" })).toHaveValue("Retained operator draft");
    await expect(page.getByText("Competing operator", { exact: true })).toHaveCount(1);
    expect(await page.locator("body").innerText()).not.toContain("synthetic diagnostic");
  }
  expect(errors).toEqual([]);
  await captureParityPair(page, REFERENCES, { stateId: `settings-catalog-${scene.id}`, viewport: "1024x720", theme: theme.name,
    adapter: "fixture", fixtureId: "settings-catalog", descriptorHash: FIXTURE_DESCRIPTOR_HASH,
    appVersion: FIXTURE_APP_VERSION, capturedAt: FIXTURE_DAY, variant: "default" });
});

for (const theme of PARITY_THEMES) test(`settings catalog real authorities, exact retry and dirty exits @ ${theme.name}`, {
  annotation: [{ type: "required-a11y-evidence", description: `settings-catalog-real-${theme.name}.a11y.yml` }],
}, async ({ page }) => {
  ensureParityBundle(); const server = await startSettingsActivationServer();
  const secret = "synthetic-browser-credential-sentinel";
  const errors: string[] = []; const logs: string[] = [];
  page.on("pageerror", error => errors.push(error.message)); page.on("console", message => logs.push(message.text()));
  try {
    const client = createDashboardClient({ baseUrl: server.url });
    await page.setViewportSize({ width: 1024, height: 720 }); await installTheme(page, theme);
    await page.goto(`${server.url}/?settings=general`);
    await page.getByRole("textbox", { name: "Operator label" }).fill("Retained ordinary draft");
    await page.getByRole("link", { name: "Credentials", exact: true }).click();
    const password = page.getByLabel("UCPath password", { exact: true });
    await expect(password).toHaveAttribute("type", "text"); await expect(password).toHaveValue("");
    await password.fill(secret);
    const attempts: unknown[] = [];
    await page.route("**/api/v1/commands", async route => {
      attempts.push(route.request().postDataJSON() as unknown);
      if (attempts.length === 1) { const response = await route.fetch(); expect(response.ok()).toBe(true); await route.abort("failed"); }
      else await route.continue();
    });
    await page.getByRole("button", { name: "Save credentials 1", exact: true }).click();
    await expect(page.getByText("Credentials write unconfirmed", { exact: true })).toBeVisible();
    await expect(password).toBeDisabled();
    const afterLost = await client.editableSettings(); expect(afterLost.revision).toBe(1);
    if (afterLost.protectedSettings.state !== "available") throw new Error("protected-readback-unavailable");
    expect(afterLost.protectedSettings.readback.revision).toBe(2);
    expect(afterLost.protectedSettings.entries.ucpathPassword?.value).toBe(secret);
    await page.getByRole("button", { name: "Retry exact attempt", exact: true }).click();
    await expect(page.getByText("Credentials already applied", { exact: true })).toBeVisible();
    expect(JSON.stringify(attempts[1]) === JSON.stringify(attempts[0])).toBe(true);
    const original = ProtectedSettingsCommandRequestSchema.parse(attempts[0]);
    expect(ProtectedSettingsCommandRequestSchema.parse(attempts[1]).payload.writeId).toBe(original.payload.writeId);
    await expect(password).toHaveValue("");
    await expect(page.getByText(secret, { exact: true })).toBeVisible();
    await page.getByRole("link", { name: "General", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Operator label" })).toHaveValue("Retained ordinary draft");
    const patch = { "actor.label": { set: "Competing ordinary writer" } } as const;
    await client.applySettings({ family: "settings", type: "apply-settings", commandId: randomUUID(), requestedAt: "2026-09-09T12:00:00.000Z", requestedBy: "local-operator", source: "settings-surface", target: { expectedRevision: 1 }, payload: { settingsSchemaHash: afterLost.settingsSchemaHash, patchFingerprint: deriveSettingsPatchFingerprint(patch), patch } });
    await page.getByRole("button", { name: "Save 1", exact: true }).click();
    await expect(page.getByText(/Current values are refreshed beside your retained draft/u)).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Operator label" })).toHaveValue("Retained ordinary draft");
    await page.getByRole("button", { name: "Save 1", exact: true }).click();
    await expect(page.getByText("Settings applied", { exact: true })).toBeVisible();
    expect((await client.editableSettings()).revision).toBe(3);
    await page.getByRole("link", { name: "Credentials", exact: true }).click();
    await page.getByRole("button", { name: "Clear UCPath password", exact: true }).click();
    await page.getByRole("button", { name: "Save credentials 1", exact: true }).click();
    await expect(page.getByText("Credentials applied", { exact: true })).toBeVisible();
    const cleared = await client.editableSettings(); expect(cleared.revision).toBe(3);
    if (cleared.protectedSettings.state !== "available") throw new Error("protected-readback-unavailable");
    expect(cleared.protectedSettings.readback.entries.ucpathPassword.present).toBe(false); expect(cleared.protectedSettings.readback.revision).toBe(3);
    // A real competing protected writer advances only that authority.
    await password.fill(secret);
    await client.executeCommand({ ...original, commandId: randomUUID(), target: { expectedRevision: 3 }, payload: { ...original.payload, writeId: randomUUID(), entries: { timekeeperName: { set: "synthetic-competing-timekeeper" } } } });
    await page.getByRole("button", { name: "Save credentials 1", exact: true }).click();
    await expect(page.getByText(/Current presence is refreshed beside your retained draft/u)).toBeVisible();
    expect(await password.inputValue() === secret).toBe(true);
    // Lose the confirming GET after the next real effect; retry must keep its identity.
    await page.route("**/api/v1/settings/editable", route => route.abort("failed"), { times: 1 });
    await page.getByRole("button", { name: "Save credentials 1", exact: true }).click();
    await expect(page.getByText("Credentials write unconfirmed", { exact: true })).toBeVisible();
    const beforeRetry = JSON.stringify(attempts.at(-1));
    await page.getByRole("button", { name: "Retry exact attempt", exact: true }).click();
    await expect(page.getByText("Credentials already applied", { exact: true })).toBeVisible();
    expect(JSON.stringify(attempts.at(-1)) === beforeRetry).toBe(true);
    await expect(password).toHaveValue("");
    const readback = await client.editableSettings();
    expect(JSON.stringify(readback).includes(secret)).toBe(true);
    expect((await page.content()).includes(secret)).toBe(true);
    expect((await page.locator("body").ariaSnapshot()).includes(secret)).toBe(true);
    expect(logs.join("\n").includes(secret)).toBe(false);
    const files = readdirSync(join(server.root, ".tracker"), { recursive: true, withFileTypes: true }).filter(file => file.isFile() && /\.(?:sqlite|db)(?:-wal|-shm)?$/u.test(file.name));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) expect(readFileSync(join(file.parentPath, file.name)).includes(Buffer.from(secret))).toBe(false);
    // Both ordinary and protected dirty exits cancel, then confirm, without dispatching.
    for (const section of ["general", "protected-store"] as const) {
      await page.getByRole("link", { name: section === "general" ? "General" : "Credentials", exact: true }).click();
      const field = section === "general" ? page.getByRole("textbox", { name: "Operator label" }) : password;
      await field.fill(section === "general" ? "Discard this ordinary draft" : secret);
      const count = attempts.length;
      await page.getByRole("button", { name: "Back to the dashboard", exact: true }).click();
      await expect(page.getByRole("dialog", { name: "Discard unsaved settings?" })).toBeVisible();
      await page.getByRole("button", { name: "Keep editing", exact: true }).click();
      expect(await field.inputValue() === (section === "general" ? "Discard this ordinary draft" : secret)).toBe(true);
      await page.getByRole("button", { name: "Back to the dashboard", exact: true }).click();
      await page.getByRole("button", { name: "Discard changes", exact: true }).click();
      await expect(page.getByRole("region", { name: "Settings", exact: true })).toHaveCount(0);
      const gear = page.getByRole("button", { name: "Settings — storage needs attention", exact: true }); await expect(gear).toBeFocused(); await gear.click();
      expect(attempts.length).toBe(count);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole("link", { name: "Provider availability", exact: true }).click();
    await expect(page.getByText("Missing", { exact: true })).toHaveCount(5);
    await expect(page.locator("input,select,textarea")).toHaveCount(0);
    await page.getByRole("link", { name: "Observed host", exact: true }).click();
    await expect(page.getByText("Primary display 2560 × 1440", { exact: true })).toBeVisible();
    await assertThemeApplied(page, theme); expect(errors).toEqual([]);
    await attachTree(page, `settings-catalog-real-${theme.name}.a11y.yml`);
  } finally { await server.stop(); }
});
