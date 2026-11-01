
import { expect } from "@playwright/test";
import { test } from "./helpers/fixtures.js";
import { createHash, randomUUID } from "node:crypto";
import { SettingsCommandRequestSchema, ProtectedSettingsCommandRequestSchema, CommandResultSchema } from "../../src/rules/commands/commands.js";
import { validateShortcutPreferences } from "../../src/dashboard/surfaces/settings/navigation/keyboard-preferences-model.js";
import { mergeSettingsPatch } from "../../src/models/config/settings.js";
import { EditableSettingsWireSchema } from "../../src/models/dashboard/settings-editor.js";
import { fixtureSettingsDocument } from "./helpers/fixture-settings.js";
import { startFixtureServer } from "../support/helpers/dashboard/fixture-bff.js";
import { installTheme, PARITY_THEMES } from "./helpers/capture.js";
import { PARITY_DIST_DIR } from "./helpers/bundle.js";

for (const theme of PARITY_THEMES) for (const width of [1024, 1440]) {
  const a11yName = `settings-save-toast-${theme.attribute}-${width}.a11y.yml`;
  test(`confirmed save toasts @ ${theme.attribute}-${width}`, { annotation: [{ type: "required-a11y-evidence", description: a11yName }] }, async ({ page }, info) => {
    const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
    let settings: Parameters<typeof mergeSettingsPatch>[0] = {}, revision = 1;
    let settingsDocument = fixtureSettingsDocument();
    const read = () => settingsDocument;
    await page.route("**/api/v1/settings/editable", route => route.fulfill({ json: settingsDocument }));
    await page.route("**/api/v1/commands", route => {
      const input: unknown = route.request().postDataJSON();
      const ordinary = SettingsCommandRequestSchema.safeParse(input);
      if (ordinary.success) {
        expect(ordinary.data.target.expectedRevision).toBe(revision);
        settings = mergeSettingsPatch(settings, ordinary.data.payload.patch); revision++;
        settingsDocument = EditableSettingsWireSchema.parse({ ...fixtureSettingsDocument(settings, revision), protectedSettings: settingsDocument.protectedSettings });
        return route.fulfill({ json: CommandResultSchema.parse({ state: "applied", commandId: ordinary.data.commandId,
          affectedTargets: [{ family: "settings", revision }], restartRequired: false,
          settingsRevision: revision, settingsFingerprint: settingsDocument.settingsFingerprint }) });
      }
      const command = ProtectedSettingsCommandRequestSchema.parse(input);
      const protectedSettings = settingsDocument.protectedSettings;
      if (protectedSettings.state !== "available") throw new Error("protected-fixture-unavailable");
      expect(command.target.expectedRevision).toBe(protectedSettings.readback.revision);
      const entries = { ...protectedSettings.entries }, presence = { ...protectedSettings.readback.entries };
      for (const [name, operation] of Object.entries(command.payload.entries)) {
        if (operation === undefined) throw new Error("protected-fixture-empty-operation");
        const key = name as keyof typeof entries;
        if ("clear" in operation) { delete entries[key]; presence[key] = { present: false }; }
        else {
          const identity = { valueId: randomUUID(), updatedAt: command.requestedAt };
          Object.assign(entries, { [name]: { ...identity, value: operation.set } });
          presence[key] = { present: true, ...identity };
        }
      }
      const readback = { revision: protectedSettings.readback.revision + 1, entries: presence };
      settingsDocument = EditableSettingsWireSchema.parse({ ...settingsDocument, protectedSettings: { ...protectedSettings, entries, readback } });
      return route.fulfill({ json: CommandResultSchema.parse({ state: "applied", commandId: command.commandId,
        affectedTargets: [{ family: "protected-settings", revision: readback.revision }], restartRequired: false, ...readback }) });
    });
    let release: () => void = () => {};
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    try {
      await page.setViewportSize({ width, height: width === 1024 ? 720 : 1000 }); await installTheme(page, theme);
      await page.goto(`${server.baseUrl}/?settings=performance`);
      const label = "Task";
      const task = page.getByRole("textbox", { name: "Task", exact: true });
      const toasts = page.locator('[data-slot="toast"]');
      await task.fill("0");
      await task.press("End"); await task.pressSequentially("1");
      await expect(task).toHaveValue("01");
      await expect(page.getByRole("button", { name: /^Undo/u })).toHaveCount(0);
      await task.press("ControlOrMeta+z"); await expect(task).toHaveValue("0");
      await expect(page.getByText("Enter a positive duration that resolves to a whole millisecond.", { exact: true })).toBeVisible();
      await page.waitForTimeout(800); await expect(toasts).toHaveCount(0);
      await expect(page.getByText("Unsaved changes", { exact: true })).toHaveCount(0);
      expect(read().revision).toBe(1);
      const pending = new Promise<void>(resolve => { release = resolve; });
      await page.route("**/api/v1/commands", async route => { await pending; await route.fallback(); }, { times: 1 });
      await task.fill("210"); await expect(page.getByText("Saving…", { exact: true })).toBeVisible();
      await expect(toasts).toHaveCount(0);
      release();
      const saved = toasts.filter({ hasText: `Saved ${label}` });
      await expect(saved).toHaveCount(1); await expect(saved).toHaveAttribute("role", "status");
      // The save lock disables controls while the command settles; focus returns to the edited field afterwards.
      await expect(task).toBeFocused();
      const focusBeforeHover = await page.evaluate(() => ({ tag: document.activeElement?.tagName, id: document.activeElement?.id }));
      await saved.locator('[data-slot="toast-close"]').hover();
      expect(await page.evaluate(() => ({ tag: document.activeElement?.tagName, id: document.activeElement?.id }))).toEqual(focusBeforeHover);
      await task.focus(); await expect(task).toBeFocused();
      expect(read().revision).toBe(2);
      const toastBounds = (await saved.boundingBox())!;
      expect(toastBounds.x).toBeGreaterThanOrEqual(0); expect(toastBounds.x + toastBounds.width).toBeLessThanOrEqual(width);

      const tree = await page.locator("body").ariaSnapshot();
      info.annotations.push({ type: `a11y-attachment-sha256:${a11yName}`, description: createHash("sha256").update(tree).digest("hex") });
      await info.attach(a11yName, { body: tree, contentType: "text/yaml" });
      await expect(saved.getByRole("button", { name: "Dismiss", exact: true })).toBeVisible();
      await saved.getByRole("button", { name: "Dismiss", exact: true }).click(); await expect(toasts).toHaveCount(0);
      await page.getByRole("link", { name: "Routes", exact: true }).click();
      await page.getByRole("searchbox", { name: "Search settings", exact: true }).fill("backoff");
      await page.getByRole("link", { name: "Backoff base Performance", exact: true }).click();
      await page.getByRole("searchbox", { name: "Search settings", exact: true }).fill("");
      await expect(toasts).toHaveCount(0); await expect(page.getByText("Saved", { exact: true })).toBeVisible();
      await page.route("**/api/v1/commands", route => route.abort("failed"), { times: 1 });
      await task.fill("240"); await expect(page.getByText("Settings write unconfirmed", { exact: true })).toBeVisible();
      const unconfirmed = toasts.filter({ hasText: "Settings save unconfirmed" });
      await expect(unconfirmed).toHaveCount(1);
      await expect(unconfirmed).not.toContainText("Saved Task");
      await unconfirmed.locator('[data-slot="toast-close"]').hover();
      await unconfirmed.getByRole("button", { name: "Dismiss", exact: true }).click();
      await expect(toasts).toHaveCount(0);
      await page.getByRole("button", { name: "Retry exact attempt", exact: true }).click();
      await expect(toasts.filter({ hasText: `Saved ${label}` })).toBeVisible();
      await expect(toasts).toHaveCount(0, { timeout: 6000 });
      await expect(page.getByText("Saved", { exact: true })).toBeVisible();

      await page.getByRole("link", { name: "Credentials", exact: true }).click();
      const username = page.getByRole("textbox", { name: "UCPath username", exact: true });
      await username.fill("synthetic-toast-user");
      await expect(toasts).toHaveCount(0);
      await page.getByRole("heading", { name: "Credentials", exact: true }).click();
      await expect(toasts.filter({ hasText: "Saved UCPath username" })).toBeVisible();
      await expect(toasts).not.toContainText("synthetic-toast-user");
      await toasts.locator('[data-slot="toast-close"]').hover(); await expect(toasts.getByRole("button", { name: "Dismiss", exact: true })).toBeVisible();
      await toasts.getByRole("button", { name: "Dismiss", exact: true }).click(); await expect(toasts).toHaveCount(0);

      await page.route("**/api/v1/commands", route => route.fulfill({ status: 403, json: { state: "error", code: "OPERATOR_MUTATION_ORIGIN_REFUSED", message: "private-server-sentinel", retryable: false } }), { times: 1 });
      await username.fill("private-refused-sentinel");
      await page.getByRole("heading", { name: "Credentials", exact: true }).click();
      const refused = toasts.filter({ hasText: "Credentials weren't saved" });
      await expect(refused).toHaveCount(1);
      await expect(page.getByText("Credentials were not applied", { exact: true })).toBeVisible();
      await expect(username).toHaveValue("private-refused-sentinel");
      await expect(refused).not.toContainText("private-refused-sentinel");
      await expect(page.locator("body")).not.toContainText("private-server-sentinel");
      await refused.locator('[data-slot="toast-close"]').hover();
      await refused.getByRole("button", { name: "Dismiss", exact: true }).click();
      await expect(toasts).toHaveCount(0);
      await page.getByRole("button", { name: "Retry edit", exact: true }).click();
      await expect(toasts.filter({ hasText: "Saved UCPath username" })).toHaveCount(1);
      await toasts.locator('[data-slot="toast-close"]').hover();
      await toasts.getByRole("button", { name: "Dismiss", exact: true }).click();
      await expect(toasts).toHaveCount(0);

      await page.getByRole("link", { name: "Keyboard", exact: true }).click();
      await page.getByRole("button", { name: "Edit Search runs shortcut 1", exact: true }).click();
      const shortcut = page.getByRole("textbox", { name: "Shortcut keys", exact: true });
      await shortcut.press("r"); await page.getByRole("button", { name: "Save shortcut", exact: true }).click();
      await expect(page.getByText("Shortcut unavailable", { exact: true })).toBeVisible(); await expect(toasts).toHaveCount(0);
      await shortcut.press("g"); await page.getByRole("button", { name: "Save shortcut", exact: true }).click();
      await expect(page.getByRole("dialog", { name: "Edit shortcut" })).toHaveCount(0);
      await expect(toasts.filter({ hasText: "Saved Search runs shortcut" })).toBeVisible();
      const storedShortcuts = await page.evaluate(() => localStorage.getItem("hr-gpt-shortcuts-v2"));
      expect(validateShortcutPreferences(JSON.parse(storedShortcuts ?? "null") as unknown).bindings.search).toEqual(["g"]);
      await toasts.locator('[data-slot="toast-close"]').hover(); await expect(toasts.getByRole("button", { name: "Dismiss", exact: true })).toBeVisible();
      await toasts.getByRole("button", { name: "Dismiss", exact: true }).click(); await expect(toasts).toHaveCount(0);

      await page.getByRole("link", { name: "Spreadsheets", exact: true }).click();
      await page.getByLabel("Open XLSX or CSV", { exact: true }).setInputFiles({ name: "typed-records.csv", mimeType: "text/csv", buffer: Buffer.from("Employee ID,Legal Name,Personal Email\n10000001,Jordan Lee,jordan@example.com\n") });
      await page.getByRole("button", { name: "Import selected columns", exact: true }).click();
      await expect(toasts.filter({ hasText: "Spreadsheet imported" })).toBeVisible();
      await toasts.locator('[data-slot="toast-close"]').hover(); await expect(toasts.getByRole("button", { name: "Dismiss", exact: true })).toBeVisible();
      await toasts.getByRole("button", { name: "Dismiss", exact: true }).click(); await expect(toasts).toHaveCount(0);
      await page.getByRole("textbox", { name: "A2", exact: true }).fill("10000002");
      await expect(page.getByText(/Edited copy/u)).toBeVisible(); await expect(toasts).toHaveCount(0);
      await page.getByRole("button", { name: "Export copy", exact: true }).click();
      const download = page.waitForEvent("download");
      await page.getByRole("menuitem", { name: "Excel workbook (.xlsx)", exact: true }).click();
      expect((await download).suggestedFilename()).toBe("typed-records-edited.xlsx");
      await expect(toasts.filter({ hasText: "Spreadsheet copy exported" })).toBeVisible();
      await expect(toasts).not.toContainText("10000002");
      await expect(page.getByText(/Saved copy/u)).toBeVisible();
      expect(errors).toEqual([]);
    } finally { release(); await server.close(); }
  });
}
