import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { manualClock } from "../../../../src/domain/clock.js";
import { hostConfigFacts } from "../../../../src/domain/config/host-display.js";
import { resolveConfigWithProvenance } from "../../../../src/domain/config/resolve.js";
import { SETTINGS_SCHEMA_HASH, deriveSettingsPatchFingerprint, type SettingsPatch } from "../../../../src/domain/config/settings.js";
import { PROTECTED_SETTINGS_SCHEMA_HASH } from "../../../../src/domain/config/protected-settings.js";
import { executeSettingsCommand } from "../../../../src/core/command-kernel.js";
import { AuthorityDatabase } from "../../../../src/infra/sqlite/index.js";
import { createCredentialStore } from "../../../../src/infra/config/credential-store.js";
import { activeSettingsRuntimeIdentity, readSettings } from "../../../../src/server/settings-runtime.js";
import { composeSettings } from "../../../../src/server/dashboard/compose/settings.js";
import { buildSettingsEditor } from "../../../../src/server/dashboard/queries/settings-editor.js";
import { createDashboardClient } from "../../../../src/dashboard/client/index.js";
import { DashboardClientProvider } from "../../../../src/dashboard/state/client-context.js";
import { useEditableSettings } from "../../../../src/dashboard/surfaces/settings-editor-model.js";
import { EditableSettingsSection } from "../../../../src/dashboard/surfaces/settings-editor.js";
import { SettingsAuthoritySection } from "../../../../src/dashboard/surfaces/settings-authorities.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
export function syntheticSettingsAuthority() {
  const root = mkdtempSync(join(tmpdir(), "settings-surface-"));
  const clock = manualClock(new Date("2026-09-13T12:00:00.000Z"));
  const database = AuthorityDatabase.open({ path: join(root, "state.db"), busyTimeoutMs: 250, migrationOwner: "unit-test" }, clock);
  const credentials = createCredentialStore({ stateRoot: root });
  const hostFacts = hostConfigFacts({ HRAUTO_HOST_PRIMARY_DISPLAY: "1920x1080" });
  const resolved = resolveConfigWithProvenance({}, hostFacts, clock);
  database.withAuthorityTransaction(repositories => {
    const record = readSettings(repositories); const configSnapshotId = randomUUID();
    repositories.configSnapshots.insert({ configSnapshotId, revision: 1, fingerprint: resolved.fingerprint, config: resolved.config, provenance: resolved.provenance, capturedAt: clock.now().toISOString(), capturedBy: "local-operator" });
    repositories.runtimeConfig.activate({ settingsRevision: record.revision, settingsFingerprint: record.settingsFingerprint, configSnapshotId, configFingerprint: resolved.fingerprint, activatedAt: clock.now().toISOString() });
  });
  const composition = composeSettings({ database, clock, hostFacts, active: activeSettingsRuntimeIdentity, environment: { HRAUTO_HOST_PRIMARY_DISPLAY: "1920x1080" }, credentials });
  const execute = (request: unknown) => executeSettingsCommand({ authority: database, clock, ids: { uuid: randomUUID }, settings: composition.executor }, request);
  const read = () => buildSettingsEditor(composition.routes.settingsEditor);
  const apply = (patch: SettingsPatch, revision = read().revision) => execute({ family: "settings", type: "apply-settings", commandId: randomUUID(), requestedAt: clock.now().toISOString(), requestedBy: "local-operator", source: "settings-surface", target: { expectedRevision: revision }, payload: { settingsSchemaHash: SETTINGS_SCHEMA_HASH, patchFingerprint: deriveSettingsPatchFingerprint(patch), patch } });
  const protectedApply = (entries: unknown, revision = credentials.read().revision) => execute({ family: "settings", type: "apply-protected-settings", commandId: randomUUID(), requestedAt: clock.now().toISOString(), requestedBy: "local-operator", source: "settings-surface", target: { expectedRevision: revision }, payload: { protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH, writeId: randomUUID(), entries } });
  return { root, database, credentials, clock, execute, read, apply, protectedApply, close: () => { database.close(); rmSync(root, { recursive: true, force: true }); } };
}
export async function mountSettingsHarness(authority: ReturnType<typeof syntheticSettingsAuthority>, section = "general") {
  const commands: unknown[] = [];
  const ports = {
    response: (): Response | undefined => undefined,
    read: (): unknown => authority.read(),
    execute: (request: unknown): unknown => authority.execute(request),
  };
  const client = createDashboardClient({ baseUrl: "http://127.0.0.1:43210", fetchImpl: async (url, init) => {
    if (url.endsWith("/settings/editable")) return new Response(JSON.stringify(ports.read()), { status: 200 });
    if (url.endsWith("/commands") && typeof init?.body === "string") {
      const request: unknown = JSON.parse(init.body); commands.push(request);
      const refusal = ports.response(); if (refusal !== undefined) return refusal;
      return new Response(JSON.stringify(ports.execute(request)), { status: 200 });
    }
    throw new Error("unexpected-settings-test-request");
  } });
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  let editor: ReturnType<typeof useEditableSettings> | undefined;
  function Harness({ sectionId }: { sectionId: string }) {
    editor = useEditableSettings({ actorId: "local-operator", descriptorFingerprint: "d".repeat(64) });
    return ["protected-store", "provider-env", "derived-host", "runtime-isolation"].includes(sectionId)
      ? createElement(SettingsAuthoritySection, { editor, sectionId }) : createElement(EditableSettingsSection, { editor, sectionId });
  }
  const render = async (sectionId: string): Promise<void> => { await act(async () => { root.render(createElement(DashboardClientProvider, { client, children: createElement(Harness, { sectionId }) })); }); };
  await render(section);
  return { host, commands, ports, client, render, controller: () => { if (editor === undefined) throw new Error("settings-not-mounted"); return editor; },
    close: () => { act(() => root.unmount()); host.remove(); } };
}
export async function settingsAction(action: () => void): Promise<void> { await act(async () => { action(); }); }
