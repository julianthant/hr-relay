import { PREFERENCES_SNAPSHOT } from "../../fixtures/phase1c-contract-fixtures.js";
import { FixtureCommandBinding } from "./command-binding.js";
import type { SettingsSaveNotice, SettingsSaveProblem } from "../../../../src/dashboard/surfaces/settings/editor/settings-attempt-model.js";
import { randomUUID } from "node:crypto";
import { act, createElement, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { hostConfigFacts } from "../../../../src/models/config/host-display.js";
import { resolveConfigWithProvenance } from "../../../../src/backend/app/config/resolve.js";
import { SETTINGS_SCHEMA_HASH, deriveSettingsPatchFingerprint, type SettingsPatch } from "../../../../src/models/config/settings.js";
import { PROTECTED_SETTINGS_SCHEMA_HASH } from "../../../../src/models/config/protected-settings.js";
import { executeSettingsCommand } from "../../../../src/backend/runs/commands/settings-command.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { boundProfileCredentials, createBoundProfileFixture, type BoundProfileStorageFixture } from "../admission-fixture.js";
import { activeSettingsRuntimeIdentity } from "../../../../src/backend/runtime/settings/settings-runtime.js";
import { composeSettings } from "../../../../src/backend/app/composition/dashboard/settings.js";
import { buildSettingsEditor } from "../../../../src/backend/runs/queries/settings-editor.js";
import { createDashboardClient, createRowStore } from "../../../../src/dashboard/client/index.js";
import { StreamRowSchema } from "../../../../src/models/dashboard/subscription.js";
import { DashboardClientProvider, useDashboardCommandBinding } from "../../../../src/dashboard/state/client-context.js";
import { PersonPreferencesContext } from "../../../../src/dashboard/lib/person-preferences.js";
import { createPersonPreferences } from "../../../../src/dashboard/state/person-preferences-model.js";
import { useEditableSettings } from "../../../../src/dashboard/surfaces/settings/editor/settings-editor-model.js";
import { EditableSettingsSection } from "../../../../src/dashboard/surfaces/settings/editor/settings-editor.js";
import { SettingsAuthoritySection } from "../../../../src/dashboard/surfaces/settings/editor/settings-authorities.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
export async function syntheticSettingsAuthority(profileFixture: () => Promise<BoundProfileStorageFixture> = createBoundProfileFixture) {
  const profile = await profileFixture();
  const clock = manualClock(new Date("2026-09-13T12:00:00.000Z"));
  const admission = profile.admission;
  const credentials = boundProfileCredentials(admission);
  const database = AuthorityDatabase.open(admission, { path: profile.path, busyTimeoutMs: 250, migrationOwner: "unit-test" }, clock, undefined, undefined, undefined, credentials);
  const hostFacts = hostConfigFacts({ HRAUTO_HOST_PRIMARY_DISPLAY: "1920x1080" });
  const resolveConfigured = (settings: unknown) => resolveConfigWithProvenance(settings, hostFacts, clock);
  const resolved = resolveConfigured({});
  database.authority.runtimeConfig.initialize({ ...PREFERENCES_SNAPSHOT, configSnapshotId: randomUUID(), revision: 1,
    fingerprint: resolved.fingerprint, config: resolved.config, provenance: resolved.provenance,
    capturedAt: clock.now().toISOString(), capturedBy: "local-operator" });
  const composition = composeSettings({ database, clock, hostFacts, active: activeSettingsRuntimeIdentity,
    environment: { HRAUTO_HOST_PRIMARY_DISPLAY: "1920x1080" }, credentials });
  const execute = (request: unknown) => executeSettingsCommand({ authority: database, clock, ids: { uuid: randomUUID }, settings: composition.executor }, request);
  const read = () => buildSettingsEditor(composition.routes.settingsEditor);
  const apply = (patch: SettingsPatch, revision = read().revision) => execute({ family: "settings", type: "apply-settings", commandId: randomUUID(), requestedAt: clock.now().toISOString(), requestedBy: "local-operator", source: "settings-surface", target: { expectedRevision: revision }, payload: { settingsSchemaHash: SETTINGS_SCHEMA_HASH, patchFingerprint: deriveSettingsPatchFingerprint(patch), patch } });
  const protectedApply = (entries: unknown, revision = credentials.read().revision) => execute({ family: "settings", type: "apply-protected-settings", commandId: randomUUID(), requestedAt: clock.now().toISOString(), requestedBy: "local-operator", source: "settings-surface", target: { expectedRevision: revision }, payload: { protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH, writeId: randomUUID(), entries } });
  return { root: profile.workspace, database, credentials, clock, execute, read, apply, protectedApply,
    close: async () => { database.close(); await profile.close(); } };
}
export async function mountSettingsHarness(authority: Awaited<ReturnType<typeof syntheticSettingsAuthority>>, section = "general", readDocument: (() => unknown) | undefined = undefined, withPersonPreferences = false) {
  const commands: unknown[] = [];
  /** Every request the editor sent, as `METHOD /path`. */
  const requests: string[] = [];
  // The stream's rows: an applied ordinary save delivers the document read after it, before its reply.
  const rows = createRowStore();
  const notices: SettingsSaveNotice[] = [];
  const problems: SettingsSaveProblem[] = [];
  const ports = {
    response: (): Response | undefined => undefined,
    read: (): unknown => readDocument?.() ?? authority.read(),
    execute: (request: unknown): unknown => authority.execute(request),
    /** The settings row the hub sends after an ordinary commit: the document as read now, unavailable when the read throws. */
    deliver: (): void => {
      let value: unknown;
      try { value = { state: "available", value: ports.read() }; } catch { value = { state: "unavailable", error: { state: "error", code: "DASHBOARD_READ_FAILED", message: "Relay could not load this.", retryable: true } }; }
      rows.apply([StreamRowSchema.parse({ model: "settings", key: "editable", value })]);
    },
  };
  // The snapshot's settings row.
  ports.deliver();
  const client = createDashboardClient({ baseUrl: "http://127.0.0.1:43210", fetchImpl: async (url, init) => {
    requests.push(`${init?.method ?? "GET"} ${new URL(url).pathname}`);
    if (url.endsWith("/settings/editable")) return new Response(JSON.stringify(ports.read()), { status: 200 });
    if (url.endsWith("/settings/storage-relocation")) return new Response(JSON.stringify({ revision: 0,
      installationId: "11111111-1111-4111-8111-111111111111", sourceGeneration: 0,
      sourcePair: { stateRoot: "/tmp/settings-fixture/state", artifactRoot: "/tmp/settings-fixture/artifacts" }, pending: null }), { status: 200 });
    if (url.endsWith("/commands") && typeof init?.body === "string") {
      const request: unknown = JSON.parse(init.body); commands.push(request);
      const refusal = ports.response(); if (refusal !== undefined) return refusal;
      const result = await ports.execute(request);
      if (typeof request === "object" && request !== null && "type" in request && request.type === "apply-settings"
        && typeof result === "object" && result !== null && "state" in result && result.state === "applied") {
        ports.deliver();
      }
      return new Response(JSON.stringify(result), { status: 200 });
    }
    throw new Error("unexpected-settings-test-request");
  } });
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  const preferences = withPersonPreferences ? createPersonPreferences("person") : undefined;
  let editor: ReturnType<typeof useEditableSettings> | undefined;
  function Harness({ sectionId }: { sectionId: string }) {
    const binding = useDashboardCommandBinding();
    useEffect(() => preferences === undefined || binding === undefined ? undefined : preferences.connect(client, binding, () => binding), [binding]);
    editor = useEditableSettings({ actorId: "local-operator", descriptorFingerprint: "d".repeat(64), onSaved: notice => notices.push(notice), onSaveProblem: notice => problems.push(notice) });
    const page = ["credentials", "protected-store", "provider-env", "runtime-isolation"].includes(sectionId)
      ? createElement(SettingsAuthoritySection, { profileName: "Synthetic Operator", editor, sectionId }) : createElement(EditableSettingsSection, { editor, sectionId });
    return createElement(PersonPreferencesContext.Provider, { value: preferences }, page);
  }
  let shown = section;
  const render = async (sectionId: string, show = true, requestKey = 0, stopped = false): Promise<void> => { shown = sectionId; await act(async () => { root.render(createElement(DashboardClientProvider, { client, children: createElement(FixtureCommandBinding, { actorId: "local-operator", requestKey, rows, stopped, children: show ? createElement(Harness, { sectionId }) : null }) })); }); };
  await render(section);
  /** Ends the stream the rows came from, as a subscription that has stopped. */
  const stop = (): Promise<void> => render(shown, true, 0, true);
  return { host, commands, requests, notices, problems, ports, client, rows, render, stop, controller: () => { if (editor === undefined) throw new Error("settings-not-mounted"); return editor; },
    close: () => { act(() => root.unmount()); host.remove(); } };
}
export async function settingsAction(action: () => void): Promise<void> { await act(async () => { action(); }); }
