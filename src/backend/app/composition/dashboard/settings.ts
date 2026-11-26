import { z } from "zod";
import { defineLaneRead, type DashboardReadLanes, type LaneReadDefinition } from "../../../storage/sqlite/dashboard-read-host.js";
import { createSettingsApplicationExecutor } from "../../../runs/commands/settings-service.js";
import { selectActiveRunSettings } from "../../../runs/settings/run-settings.js";
import { activeSettingsConfig, activeSettingsRuntimeIdentity, createProtectedSettingsRuntimeReader, createSettingsRuntimeReader, readSettings, settingsRuntimeStatusOf, type ProtectedSettingsRuntimeSnapshot } from "../../../runtime/settings/settings-runtime.js";
import type { createCredentialStore } from "../../../storage/configuration/credential-store.js";
import type { AuthorityDatabase } from "../../../storage/sqlite/authority-database.js";
import { createNativePathPicker } from "../../../transports/http/native-path-picker.js";
import type { SettingsRouteDeps } from "../../../transports/http/routes/settings-types.js";
import { resolveConfigWithProvenance, ResolvedConfigSchema } from "../../config/resolve.js";
import { DESCRIPTORS } from "../../registries/workflow-registry.js";
import { buildSettingsFacts } from "../../../runs/queries/settings.js";
import { buildSettingsEditor } from "../../../runs/queries/settings-editor.js";
import { SettingsFileRecordSchema, SettingsRuntimeIdentitySchema } from "../../../../models/config/settings.js";
import { StoredConfigSchema } from "../../../../models/config/snapshot.js";
import { PersonPreferencesSchema } from "../../../../models/config/person-preferences.js";
import { HostConfigFactsSchema } from "../../../../models/config/host-display.js";
import { SettingsFactsWireSchema } from "../../../../models/dashboard/settings.js";
import type { EditableSettingsWire } from "../../../../models/dashboard/settings-editor.js";
import { canonicalJsonStringify } from "../../../../rules/validation/canonical-json.js";

// The settings record is authenticated against its command and audit rows, so those rows back every settings read.
const SETTINGS_TABLES = ["settings", "settings_snapshots", "commands", "command_audits"] as const;
const fileRecord = SettingsFileRecordSchema.shape;
/** The store's authenticated record, as `readSettings` returns it: the file form's `lastApplied` is not part of it. */
const StoredSettingsRecordSchema = z.strictObject({ revision: fileRecord.revision, settingsSchemaHash: fileRecord.settingsSchemaHash,
  settingsFingerprint: fileRecord.settingsFingerprint, settings: fileRecord.settings });
const SettingsStorePartSchema = z.strictObject({ record: StoredSettingsRecordSchema, active: SettingsRuntimeIdentitySchema,
  activeConfig: StoredConfigSchema, activePreferences: PersonPreferencesSchema,
  resolutions: z.strictObject({ record: ResolvedConfigSchema, defaults: ResolvedConfigSchema }) });

/**
 * The store part of the settings editor: the saved record, the active identity and its snapshot, and the record's and the
 * defaults' resolutions (gate G6: resolving on main costs more than the editor's budget). Protected settings never reach a lane.
 */
const settingsStorePartRead = defineLaneRead(import.meta.url, "settings-store-part", {
  lane: "navigation", priority: "interactive", tables: SETTINGS_TABLES,
  // resolve validates the pair itself.
  args: z.strictObject({ hostFacts: HostConfigFactsSchema, runtimeStoragePair: z.strictObject({ stateRoot: z.string(), artifactRoot: z.string() }).optional() }),
  run({ native: { authority } }, { hostFacts, runtimeStoragePair }) {
    const active = activeSettingsRuntimeIdentity(authority);
    authority.runtimeConfig.requireActive({ settingsRevision: active.settingsRevision, settingsFingerprint: active.settingsFingerprint,
      configFingerprint: active.configFingerprint });
    const selected = selectActiveRunSettings(authority);
    const record = readSettings(authority);
    const resolve = (settings: unknown) => resolveConfigWithProvenance(settings, hostFacts, undefined, runtimeStoragePair);
    return SettingsStorePartSchema.parse({ record, active, activeConfig: selected.config, activePreferences: selected.preferences,
      resolutions: { record: resolve(record.settings), defaults: resolve({}) } });
  },
});

const settingsFactsRead = defineLaneRead(import.meta.url, "settings-facts", {
  lane: "navigation", priority: "interactive", args: z.strictObject({}), tables: SETTINGS_TABLES,
  run: ({ native }) => SettingsFactsWireSchema.parse(buildSettingsFacts({ config: activeSettingsConfig(native.authority), descriptors: DESCRIPTORS })),
});

/** Read once per editor read, so the same facts key the reuse and build the document. */
function readProtectedFacts(reader: Readonly<{ read(): ProtectedSettingsRuntimeSnapshot }>):
  Readonly<{ state: "read"; facts: ProtectedSettingsRuntimeSnapshot }> | Readonly<{ state: "unreadable"; error: unknown }> {
  try { return { state: "read", facts: reader.read() }; }
  catch (error) { return { state: "unreadable", error }; }
}

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
  readLanes?: Pick<DashboardReadLanes, "read">;
  /** The profile's browser-root custody check, run on main for each lane resolution at every editor read. */
  assertBrowserRoot?: (path: string) => void;
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
  const laneRead = async <Args>(definition: LaneReadDefinition<Args, unknown>, args: Args) => {
    input.assertCurrent?.();
    const { body } = await lanes.read(definition, args);
    input.assertCurrent?.();
    return body;
  };
  // Reused while the store part, the protected facts and the fiscal year are unchanged; any of them changing builds again.
  let last: { key: string; browserRoots: readonly string[]; document: EditableSettingsWire } | undefined;
  // The root on disk can stop qualifying after startup, so a reused document is checked again.
  const assertBrowserRoots = (roots: readonly string[]) => { for (const root of roots) input.assertBrowserRoot?.(root); };
  const editable = async (): Promise<EditableSettingsWire> => {
    const body = await laneRead(settingsStorePartRead, { hostFacts, ...(input.runtimeStoragePair === undefined ? {} : { runtimeStoragePair: input.runtimeStoragePair }) });
    const protectedFacts = readProtectedFacts(routes.settingsEditor.protectedSettings);
    const key = canonicalJsonStringify({ body, protectedFacts: protectedFacts.state === "read" ? protectedFacts.facts : null, fiscalYear: clock.fiscalYear() });
    if (last?.key === key) {
      assertBrowserRoots(last.browserRoots);
      return last.document;
    }
    const { record, active, activeConfig, activePreferences, resolutions } = SettingsStorePartSchema.parse(JSON.parse(body));
    const browserRoots = [resolutions.record.config.paths.browserProfileRoot, resolutions.defaults.config.paths.browserProfileRoot];
    assertBrowserRoots(browserRoots);
    const document = buildSettingsEditor({ ...routes.settingsEditor, resolutions,
      settings: { read: () => ({ record, runtimeStatus: settingsRuntimeStatusOf(record, active, resolutions.record.fingerprint), activeConfig, activePreferences }) },
      // The editor shows an unreadable protected store as unknown; the read's own error is what it sees.
      protectedSettings: { read: () => {
        if (protectedFacts.state === "unreadable") throw protectedFacts.error;
        return protectedFacts.facts;
      } } });
    last = { key, browserRoots, document };
    return document;
  };
  return { routes: { ...routes, settingsLane: { editable, facts: () => laneRead(settingsFactsRead, {}) } }, editable,
    executor: createSettingsApplicationExecutor(resolveSettings, input.credentials) };
}
