import { FingerprintSchema } from "../../../../src/domain/ids.js";
import { canonicalJsonStringify } from "../../../../src/domain/canonical-json.js";
import { sha256Hex } from "../../../../src/domain/sha256.js";
import { createSettingsApplicationExecutor } from "../../../../src/backend/runs/dashboard/commands/settings-service.js";
import { randomUUID } from "node:crypto";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { manualClock } from "../../../../src/domain/clock.js";
import { hostConfigFacts } from "../../../../src/domain/config/host-display.js";
import { resolveConfigWithProvenance } from "../../../../src/backend/app/config/resolve.js";
import { SETTINGS_SCHEMA_HASH, deriveSettingsPatchFingerprint, type SettingsPatch } from "../../../../src/domain/config/settings.js";
import { ProviderKeysRetryIntentSchema } from "../../../../src/domain/commands.js";
import { admitLocalEnvironmentFile } from "../../../../src/domain/secrets.js";
import { createProviderKeyStore } from "../../../../src/backend/storage/config/provider-key-store.js";
import type { ProviderKeyStoreHooks } from "../../../../src/backend/storage/config/provider-key-store.js";
import { createProviderKeyJournal } from "../../../../src/backend/runs/dashboard/commands/provider-key-journal.js";
import { providerCommandFromStore, providerMarkedFingerprint } from "../../../../src/backend/runs/dashboard/commands/provider-key-projection.js";
import { PROTECTED_SETTINGS_SCHEMA_HASH } from "../../../../src/domain/config/protected-settings.js";
import { executeSettingsCommand } from "../../../../src/backend/runs/command-kernel.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { createCredentialStore } from "../../../../src/backend/storage/config/credential-store.js";
import { RuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";
import { activeSettingsRuntimeIdentity, readSettings } from "../../../../src/backend/runtime/settings/settings-runtime.js";
import { composeSettings } from "../../../../src/backend/app/dashboard/compose/settings.js";
import { buildSettingsEditor } from "../../../../src/backend/runs/dashboard/queries/settings-editor.js";
import { createDashboardClient } from "../../../../src/dashboard/client/index.js";
import { DashboardClientProvider } from "../../../../src/dashboard/state/client-context.js";
import { useEditableSettings } from "../../../../src/dashboard/surfaces/settings-editor-model.js";
import { EditableSettingsSection } from "../../../../src/dashboard/surfaces/settings-editor.js";
import { SettingsAuthoritySection } from "../../../../src/dashboard/surfaces/settings-authorities.js";
import { RoutesSection } from "../../../../src/dashboard/surfaces/settings-routes.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
export function syntheticSettingsAuthority(options: { providerFile?: string; parentSlots?: NodeJS.ProcessEnv; providerHooks?: ProviderKeyStoreHooks; configuredModels?: readonly string[] } = {}) {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "settings-surface-"));
  const clock = manualClock(new Date("2026-09-13T12:00:00.000Z"));
  const admission = RuntimeAdmission.syntheticRoots(root, join(root, "artifacts"));
  const database = AuthorityDatabase.open(admission, { path: join(root, "state.db"), busyTimeoutMs: 250, migrationOwner: "unit-test" }, clock);
  const credentials = createCredentialStore({ admission, stateRoot: root });
  const providerEnvPath = options.providerFile === undefined ? undefined : join(root, ".env.providers");
  if (providerEnvPath !== undefined && options.providerFile !== undefined) writeFileSync(providerEnvPath, options.providerFile, { mode: 0o600 });
  const providerEnvironment: NodeJS.ProcessEnv = { ...options.parentSlots };
  const providerBoot = providerEnvPath === undefined ? undefined : admitLocalEnvironmentFile(providerEnvPath, providerEnvironment);
  const providerStore = providerEnvPath === undefined ? undefined : createProviderKeyStore({ admission, envPath: providerEnvPath,
    journal: createProviderKeyJournal(database), markedFingerprint: providerMarkedFingerprint, hooks: options.providerHooks });
  const hostFacts = hostConfigFacts({ HRAUTO_HOST_PRIMARY_DISPLAY: "1920x1080" });
  const resolveConfigured = (settings: unknown) => {
    const resolved = resolveConfigWithProvenance(settings, hostFacts, clock);
    if (options.configuredModels === undefined || options.configuredModels.length === 0) return resolved;
    const value = settings as { providers?: { gemini?: { models?: readonly string[] } } };
    const models = value.providers?.gemini?.models ?? options.configuredModels;
    const config = { ...resolved.config, providers: { ...resolved.config.providers, gemini: { models } } };
    return { ...resolved, config, fingerprint: FingerprintSchema.parse(sha256Hex(canonicalJsonStringify(config))) };
  };
  const resolved = resolveConfigured({});
  database.withAuthorityTransaction(repositories => {
    const record = readSettings(repositories); const configSnapshotId = randomUUID();
    repositories.configSnapshots.insert({ configSnapshotId, revision: 1, fingerprint: resolved.fingerprint, config: resolved.config, provenance: resolved.provenance, capturedAt: clock.now().toISOString(), capturedBy: "local-operator" });
    repositories.runtimeConfig.activate({ settingsRevision: record.revision, settingsFingerprint: record.settingsFingerprint, configSnapshotId, configFingerprint: resolved.fingerprint, activatedAt: clock.now().toISOString() });
  });
  const composition = composeSettings({ database, clock, hostFacts, active: activeSettingsRuntimeIdentity,
    environment: { HRAUTO_HOST_PRIMARY_DISPLAY: "1920x1080", ...providerEnvironment }, credentials,
    providerKeys: providerStore, providerBoot });
  const settingsExecutor = options.configuredModels === undefined ? composition.executor
    : createSettingsApplicationExecutor(resolveConfigured, credentials);
  const execute = (request: unknown) => {
    const retry = ProviderKeysRetryIntentSchema.safeParse(request);
    const resolved = retry.success ? providerCommandFromStore(providerStore!.readPendingRequest({
      commandId: retry.data.retry.commandId, writeId: retry.data.retry.writeId,
      receiptId: retry.data.retry.pendingReceiptId,
    })) : request;
    return executeSettingsCommand({ authority: database, clock, ids: { uuid: randomUUID }, settings: settingsExecutor }, resolved);
  };
  const read = () => buildSettingsEditor(composition.routes.settingsEditor);
  const apply = (patch: SettingsPatch, revision = read().revision) => execute({ family: "settings", type: "apply-settings", commandId: randomUUID(), requestedAt: clock.now().toISOString(), requestedBy: "local-operator", source: "settings-surface", target: { expectedRevision: revision }, payload: { settingsSchemaHash: SETTINGS_SCHEMA_HASH, patchFingerprint: deriveSettingsPatchFingerprint(patch), patch } });
  const protectedApply = (entries: unknown, revision = credentials.read().revision) => execute({ family: "settings", type: "apply-protected-settings", commandId: randomUUID(), requestedAt: clock.now().toISOString(), requestedBy: "local-operator", source: "settings-surface", target: { expectedRevision: revision }, payload: { protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH, writeId: randomUUID(), entries } });
  return { root, database, credentials, providerStore, providerEnvPath, providerEnvironment, clock, execute, read, apply, protectedApply,
    close: () => { database.close(); admission.release(); rmSync(root, { recursive: true, force: true }); } };
}
export async function mountSettingsHarness(authority: ReturnType<typeof syntheticSettingsAuthority>, section = "general", readDocument: (() => unknown) | undefined = undefined) {
  const commands: unknown[] = [];
  const ports = {
    response: (): Response | undefined => undefined,
    read: (): unknown => readDocument?.() ?? authority.read(),
    execute: (request: unknown): unknown => authority.execute(request),
  };
  const client = createDashboardClient({ baseUrl: "http://127.0.0.1:43210", fetchImpl: async (url, init) => {
    if (url.endsWith("/settings/editable")) return new Response(JSON.stringify(ports.read()), { status: 200 });
    if (url.endsWith("/settings/storage-relocation")) return new Response(JSON.stringify({ revision: 0,
      installationId: "11111111-1111-4111-8111-111111111111", sourceGeneration: 0,
      sourcePair: { stateRoot: "/tmp/settings-fixture/state", artifactRoot: "/tmp/settings-fixture/artifacts" }, pending: null }), { status: 200 });
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
    if (sectionId === "routes") return createElement(RoutesSection, { editor });
    return ["credentials", "protected-store", "provider-env", "runtime-isolation"].includes(sectionId)
      ? createElement(SettingsAuthoritySection, { editor, sectionId }) : createElement(EditableSettingsSection, { editor, sectionId });
  }
  const render = async (sectionId: string): Promise<void> => { await act(async () => { root.render(createElement(DashboardClientProvider, { client, children: createElement(Harness, { sectionId }) })); }); };
  await render(section);
  return { host, commands, ports, client, render, controller: () => { if (editor === undefined) throw new Error("settings-not-mounted"); return editor; },
    close: () => { act(() => root.unmount()); host.remove(); } };
}
export async function settingsAction(action: () => void): Promise<void> { await act(async () => { action(); }); }
