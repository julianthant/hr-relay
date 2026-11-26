import { z } from "zod";
import { defineLaneRead, type DashboardReadLanes } from "../../../storage/sqlite/dashboard-read-host.js";
import { createSettingsApplicationExecutor } from "../../../runs/commands/settings-service.js";
import { selectActiveRunSettings } from "../../../runs/settings/run-settings.js";
import { activeSettingsConfig, activeSettingsRuntimeIdentity, createProtectedSettingsRuntimeReader, createSettingsRuntimeReader, readSettings, settingsRuntimeStatus, type ProtectedSettingsRuntimeSnapshot } from "../../../runtime/settings/settings-runtime.js";
import type { createCredentialStore } from "../../../storage/configuration/credential-store.js";
import type { AuthorityDatabase } from "../../../storage/sqlite/authority-database.js";
import { createNativePathPicker } from "../../../transports/http/native-path-picker.js";
import type { SettingsRouteDeps } from "../../../transports/http/routes/settings-types.js";
import { resolveConfigWithProvenance } from "../../config/resolve.js";
import { DESCRIPTORS } from "../../registries/workflow-registry.js";
import { buildSettingsFacts } from "../../../runs/queries/settings.js";
import { buildSettingsEditor } from "../../../runs/queries/settings-editor.js";
import { SettingsFileRecordSchema, SettingsRuntimeIdentitySchema } from "../../../../models/config/settings.js";
import { StoredConfigSchema } from "../../../../models/config/snapshot.js";
import { PersonPreferencesSchema } from "../../../../models/config/person-preferences.js";
import { SettingsFactsWireSchema } from "../../../../models/dashboard/settings.js";
import type { EditableSettingsWire } from "../../../../models/dashboard/settings-editor.js";
import { canonicalJsonStringify } from "../../../../rules/validation/canonical-json.js";

const SETTINGS_TABLES = ["settings", "settings_snapshots"] as const;
const SettingsStorePartSchema = z.strictObject({ record: SettingsFileRecordSchema, active: SettingsRuntimeIdentitySchema,
  activeConfig: StoredConfigSchema, activePreferences: PersonPreferencesSchema });

/** The store part of the settings editor: the saved record, the active identity and its snapshot. Protected settings never reach a lane. */
const settingsStorePartRead = defineLaneRead(import.meta.url, "settings-store-part", {
  lane: "navigation", priority: "interactive", args: z.strictObject({}), tables: SETTINGS_TABLES,
  run({ native: { authority } }) {
    const active = activeSettingsRuntimeIdentity(authority);
    authority.runtimeConfig.requireActive({ settingsRevision: active.settingsRevision, settingsFingerprint: active.settingsFingerprint,
      configFingerprint: active.configFingerprint });
    const selected = selectActiveRunSettings(authority);
    return SettingsStorePartSchema.parse({ record: readSettings(authority), active, activeConfig: selected.config, activePreferences: selected.preferences });
  },
});

const settingsFactsRead = defineLaneRead(import.meta.url, "settings-facts", {
  lane: "navigation", priority: "interactive", args: z.strictObject({}), tables: [...SETTINGS_TABLES, "commands", "command_audits"],
  run: ({ native }) => SettingsFactsWireSchema.parse(buildSettingsFacts({ config: activeSettingsConfig(native.authority), descriptors: DESCRIPTORS })),
});

export function composeProfileSettings(input: Parameters<typeof createSettingsRuntimeReader>[0] & {
  readonly database: Pick<AuthorityDatabase, "withAuthorityReadSnapshot" | "authority">;
}) {
  const reader = createSettingsRuntimeReader(input);
  return Object.freeze({ read: () => input.database.withAuthorityReadSnapshot(() => reader.read(input.database.authority)) });
}

export function composeSettings(input: Parameters<typeof createSettingsRuntimeReader>[0] & {
  database: Pick<AuthorityDatabase, "withAuthorityReadSnapshot" | "authority" | "trackAuthorityTables">;
  environment: Readonly<Record<string, string | undefined>>; credentials: ReturnType<typeof createCredentialStore>;
  assertCurrent?: () => void;
  resolveSettings?: Parameters<typeof createSettingsApplicationExecutor>[0];
  /** Seam for the settings store-part lane read and the stream row. */
  readLanes?: DashboardReadLanes;
}) {
  const { database, clock, hostFacts } = input;
  const reader = createSettingsRuntimeReader(input);
  const resolveSettings = input.resolveSettings ?? (settings => resolveConfigWithProvenance(settings, hostFacts, clock, input.runtimeStoragePair));
  const read = <T>(project: (repositories: AuthorityDatabase["authority"]) => T) => database.withAuthorityReadSnapshot(() => {
    input.assertCurrent?.();
    const result = project(database.authority);
    input.assertCurrent?.();
    return result;
  });
  const factsPosition = database.trackAuthorityTables(["settings", "settings_snapshots", "commands", "command_audits"]);
  const routes: SettingsRouteDeps = {
    nativePathPicker: createNativePathPicker(),
    settings: { readConfig: () => read(activeSettingsConfig), descriptors: DESCRIPTORS },
    withSettingsFacts: respond => read(repositories => respond(factsPosition(),
      () => buildSettingsFacts({ config: activeSettingsConfig(repositories), descriptors: DESCRIPTORS }))),
    settingsEditor: {
      settings: { read: () => read(repositories => {
        const snapshot = reader.read(repositories);
        const active = selectActiveRunSettings(repositories);
        return { ...snapshot, activeConfig: active.config, activePreferences: active.preferences };
      }) },
      protectedSettings: createProtectedSettingsRuntimeReader({ read: () => { input.assertCurrent?.(); const result = input.credentials.read(); input.assertCurrent?.(); return result; } }), environment: input.environment, clock,
      resolve: resolveSettings,
    },
  };
  // The document `GET /settings/editable` serves, also read for the stream's settings row.
  const lanes = input.readLanes;
  if (lanes === undefined) {
    const editable = () => buildSettingsEditor(routes.settingsEditor);
    return { routes, editable, executor: createSettingsApplicationExecutor(resolveSettings, input.credentials) };
  }
  const laneRead = async (definition: typeof settingsStorePartRead | typeof settingsFactsRead) => {
    input.assertCurrent?.();
    const { body } = await lanes.read(definition, {});
    input.assertCurrent?.();
    return body;
  };
  // Reused while the store part, the protected facts and the fiscal year are unchanged; any of them changing builds again.
  let last: { key: string; document: EditableSettingsWire } | undefined;
  const editable = async (): Promise<EditableSettingsWire> => {
    const body = await laneRead(settingsStorePartRead);
    let protectedFacts: ProtectedSettingsRuntimeSnapshot | undefined;
    try { protectedFacts = routes.settingsEditor.protectedSettings.read(); } catch { protectedFacts = undefined; }
    const key = canonicalJsonStringify({ body, protectedFacts: protectedFacts ?? null, fiscalYear: clock.fiscalYear() });
    if (last?.key === key) return last.document;
    const { record, active, activeConfig, activePreferences } = SettingsStorePartSchema.parse(JSON.parse(body));
    const document = buildSettingsEditor({ ...routes.settingsEditor,
      settings: { read: () => ({ record, runtimeStatus: settingsRuntimeStatus(input, record, active), activeConfig, activePreferences }) },
      protectedSettings: { read: () => {
        if (protectedFacts === undefined) throw new Error("settings-protected-facts-unavailable");
        return protectedFacts;
      } } });
    last = { key, document };
    return document;
  };
  return { routes: { ...routes, settingsLane: { editable, facts: () => laneRead(settingsFactsRead) } }, editable,
    executor: createSettingsApplicationExecutor(resolveSettings, input.credentials) };
}
