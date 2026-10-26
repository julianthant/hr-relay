import { AuthoritySourceClosureUnprovedError } from '../../src/backend/storage/source-closure.js';
import { expect, test, type Page } from "@playwright/test";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createDashboardClient } from "../../src/dashboard/client/index.js";
import { ProtectedSettingsCommandRequestSchema } from "../../src/rules/commands/commands.js";
import { EditableSettingsWireSchema } from "../../src/models/dashboard/settings-editor.js";
import { fixtureSettingsDocument } from "./helpers/fixture-settings.js";
import { startSettingsActivationServer } from "./helpers/fixture-settings-activation.js";
import { ensureParityBundle } from "./helpers/bundle.js";
import { PARITY_THEMES, installTheme, assertThemeApplied } from "./helpers/capture.js";
import { registerReferenceServers } from "./helpers/reference-harness.js";
import { FIXTURE_DAY } from "./helpers/fixture-identity.js";

const retainedParityFixtureFailures = new Set<object>();

async function attachTree(page: Page, name: string): Promise<void> {
  const body = await page.locator("body").ariaSnapshot();
  test.info().annotations.push({ type: `a11y-attachment-sha256:${name}`, description: createHash("sha256").update(body).digest("hex") });
  await test.info().attach(name, { body, contentType: "text/yaml" });
}
const scenes = [
  { id: "routes", section: "routes", title: "Routes" },
  { id: "credentials", section: "protected-store", title: "Credentials" },
] as const;
const servers = registerReferenceServers(["server"]);
for (const theme of PARITY_THEMES) for (const scene of scenes) test(`settings catalog ${scene.id} @ ${theme.name}`, async ({ page }) => {
  let document = fixtureSettingsDocument({ annualDates: { FY2027: { jobEndDate: "6/30/2027", kronosDefaultEndDate: "6/30/2027", kronosDefaultStartDate: "7/1/2026" } } }, 2);
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
  if (scene.id === "routes") {
    await expect(page.locator('[data-settings-path="urls.crm.prod"] input')).toHaveCount(5);
    await expect(page.locator('[data-settings-path="urls.crm.prod"] input').first()).toHaveValue(/^https:\/\//u);
    await expect(page.getByRole("button", { name: "Save routes" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "CRM 5 URLs", exact: true })).toBeVisible();
    await expect(page.getByRole("searchbox", { name: "Find a system or route", exact: true })).toBeVisible();
  } else {
    const password = page.getByLabel("UCPath password", { exact: true });
    await expect(password).toHaveAttribute("type", "password");
    await expect(password).toHaveValue("synthetic-visible-credential");
    await expect(page.getByRole("button", { name: "Show UCPath password", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Remove UCPath password", exact: true })).toBeVisible();
    expect(await page.locator("body").innerText()).not.toContain("synthetic-visible-credential");
  }
  expect(errors).toEqual([]);

  if (scene.id === "routes") {
    await page.setViewportSize({ width: 1440, height: 900 });
    const label = await page.locator('[data-settings-path="urls.crm.prod"] label').first().boundingBox();
    const input = await page.locator('[data-settings-path="urls.crm.prod"] input').first().boundingBox();
    expect(label).not.toBeNull(); expect(input).not.toBeNull();
    if (label === null || input === null) throw new Error("route-field-layout-unavailable");
    expect(input.x).toBeGreaterThan(label.x + 200);
    expect(Math.abs(input.y - label.y)).toBeLessThan(30);

  }
});

for (const theme of PARITY_THEMES) test(`settings catalog real authorities, exact retry and dirty exits @ ${theme.name}`, {
  annotation: [{ type: "required-a11y-evidence", description: `settings-catalog-real-${theme.name}.a11y.yml` }],
}, async ({ page }) => {
  ensureParityBundle(); const server = await startSettingsActivationServer();
  const secret = "synthetic-browser-credential-sentinel";
  const errors: string[] = []; const logs: string[] = [];
  page.on("pageerror", error => errors.push(error.message)); page.on("console", message => logs.push(message.text()));
  let parityBodyFailure: { error: unknown } | undefined;
  try {
    const client = createDashboardClient({ baseUrl: server.url });
    const initialProtected = await client.editableSettings();
    if (initialProtected.protectedSettings.state !== "available") throw new Error('protected-settings-unavailable');
    const protectedBaseline = initialProtected.protectedSettings.readback.revision;
    expect(protectedBaseline).toBe(server.protectedRevision());
    await page.setViewportSize({ width: 1024, height: 720 }); await installTheme(page, theme);
    await page.goto(`${server.url}/?settings=general`);
    await page.getByRole("link", { name: "Credentials", exact: true }).click();
    const password = page.getByLabel("UCPath password", { exact: true });
    await expect(password).toHaveAttribute("type", "password"); await expect(password).toHaveValue("");
    await password.fill(secret);
    const attempts: unknown[] = [];
    await page.route("**/api/v1/commands", async route => {
      attempts.push(route.request().postDataJSON() as unknown);
      if (attempts.length === 1) { const response = await route.fetch(); expect(response.ok()).toBe(true); await route.abort("failed"); }
      else await route.continue();
    });
    await password.blur();
    await expect(page.getByText("Credentials write unconfirmed", { exact: true })).toBeVisible();
    await expect(password).toBeDisabled();
    const afterLost = await client.editableSettings(); expect(afterLost.revision).toBe(1);
    if (afterLost.protectedSettings.state !== "available") throw new Error("protected-readback-unavailable");
    expect(afterLost.protectedSettings.readback.revision).toBe(protectedBaseline + 1);
    expect(afterLost.protectedSettings.entries.ucpathPassword?.value).toBe(secret);
    await page.getByRole("button", { name: "Retry exact attempt", exact: true }).click();
    await expect(page.getByText("Already saved", { exact: true })).toBeVisible();
    expect(JSON.stringify(attempts[1]) === JSON.stringify(attempts[0])).toBe(true);
    const original = ProtectedSettingsCommandRequestSchema.parse(attempts[0]);
    expect(ProtectedSettingsCommandRequestSchema.parse(attempts[1]).payload.writeId).toBe(original.payload.writeId);
    await expect(password).toHaveValue(secret);
    await expect(password).toHaveAttribute("type", "password");
    await page.getByRole("link", { name: "Credentials", exact: true }).click();
    await page.getByRole("button", { name: "Remove UCPath password", exact: true }).click();
    const removal = page.getByRole("dialog", { name: "Remove UCPath password?", exact: true });
    await expect(removal).toBeVisible();
    await removal.getByRole("button", { name: "Remove credential", exact: true }).click();
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    const cleared = await client.editableSettings(); expect(cleared.revision).toBe(1);
    if (cleared.protectedSettings.state !== "available") throw new Error("protected-readback-unavailable");
    expect(cleared.protectedSettings.readback.entries.ucpathPassword.present).toBe(false); expect(cleared.protectedSettings.readback.revision).toBe(protectedBaseline + 2);
    // A real competing protected writer advances only that authority.
    await password.fill(secret);
    await client.executeCommand({ ...original, commandId: randomUUID(), target: { expectedRevision: cleared.protectedSettings.readback.revision }, payload: { ...original.payload, writeId: randomUUID(), entries: { timekeeperName: { set: "synthetic-competing-timekeeper" } } } });
    await password.blur();
    await expect(page.getByText("The command conflicted with a newer state. Refresh and review the current result.", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Retry edit", exact: true })).toBeVisible();
    await expect(password).toBeEnabled();
    expect(await password.inputValue() === secret).toBe(true);
    const afterConflict = await client.editableSettings();
    if (afterConflict.protectedSettings.state !== "available") throw new Error("protected-conflict-readback-unavailable");
    expect(afterConflict.protectedSettings.readback.revision).toBe(protectedBaseline + 3);
    expect(afterConflict.protectedSettings.entries.timekeeperName?.value).toBe("synthetic-competing-timekeeper");
    // Lose the confirming GET after the next real effect; retry must keep its identity.
    await page.route("**/api/v1/settings/editable", route => route.abort("failed"), { times: 1 });
    await page.getByRole("button", { name: "Retry edit", exact: true }).click();
    await expect(page.getByText("Credentials write unconfirmed", { exact: true })).toBeVisible();
    const retryEdit = ProtectedSettingsCommandRequestSchema.parse(attempts.at(-1));
    expect(retryEdit.target.expectedRevision).toBe(protectedBaseline + 3);
    expect(retryEdit.payload.entries).toEqual({ ucpathPassword: { set: secret } });
    const beforeRetry = JSON.stringify(attempts.at(-1));
    await page.getByRole("button", { name: "Retry exact attempt", exact: true }).click();
    await expect(page.getByText("Already saved", { exact: true })).toBeVisible();
    expect(JSON.stringify(attempts.at(-1)) === beforeRetry).toBe(true);
    await expect(password).toHaveValue(secret);
    await expect(password).toHaveAttribute("type", "password");
    const readback = await client.editableSettings();
    if (readback.protectedSettings.state !== 'available') throw new Error('protected-settings-unavailable');
    expect(readback.protectedSettings.readback.revision).toBe(protectedBaseline + 4);
    expect(JSON.stringify(readback).includes(secret)).toBe(true);
    expect((await page.content()).includes(secret)).toBe(true);
    expect((await page.locator("body").ariaSnapshot()).includes(secret)).toBe(true);
    expect(logs.join("\n").includes(secret)).toBe(false);
    const files = readdirSync(join(server.root, ".tracker"), { recursive: true, withFileTypes: true }).filter(file => file.isFile() && /\.(?:sqlite|db)(?:-wal|-shm)?$/u.test(file.name));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) expect(readFileSync(join(file.parentPath, file.name)).includes(Buffer.from(secret))).toBe(false);
    await page.getByRole("link", { name: "Credentials", exact: true }).click();
    const count = attempts.length;
    await password.fill("");
    await expect(page.getByText("Enter a valid value for this credential.", { exact: true })).toBeVisible();
    expect(attempts.length).toBe(count);
    const back = page.getByRole("button", { name: "Back to dashboard", exact: true });
    await back.evaluate(element => { if (!(element instanceof HTMLButtonElement)) throw new Error("settings-exit-not-button"); element.click(); });
    await expect(page.getByRole("dialog", { name: "Discard unsaved settings?" })).toBeVisible();
    await page.getByRole("button", { name: "Keep editing", exact: true }).click();
    expect(await password.inputValue()).toBe("");
    await back.evaluate(element => { if (!(element instanceof HTMLButtonElement)) throw new Error("settings-exit-not-button"); element.click(); });
    await page.getByRole("button", { name: "Discard changes", exact: true }).click();
    await expect(page.getByRole("region", { name: "Settings", exact: true })).toHaveCount(0);
    const gear = page.getByRole("button", { name: "Settings", exact: true });
    await expect(gear).toBeFocused(); await gear.click();
    expect(attempts.length).toBe(count);
    const afterDiscard = await client.editableSettings();
    if (afterDiscard.protectedSettings.state !== "available") throw new Error("protected-readback-unavailable");
    expect(afterDiscard.protectedSettings.entries.ucpathPassword?.value).toBe(secret);
    await page.setViewportSize({ width: 1440, height: 900 });
    await assertThemeApplied(page, theme); expect(errors).toEqual([]);
    await attachTree(page, `settings-catalog-real-${theme.name}.a11y.yml`);
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
