import { z } from "zod";
import { defineLaneRead, type DashboardReadLanes } from "../../../storage/sqlite/dashboard-read-host.js";
import { createSettingsApplicationExecutor } from "../../../runs/commands/settings-service.js";
import type { SettingsApplicationExecutor } from "../../../runs/commands/settings-command.js";
import { selectActiveRunSettings } from "../../../runs/settings/run-settings.js";
import { activeSettingsRuntimeIdentity, createProtectedSettingsRuntimeReader, createSettingsRuntimeReader, readSettings, settingsRuntimeStatusOf } from "../../../runtime/settings/settings-runtime.js";
import type { createCredentialStore } from "../../../storage/configuration/credential-store.js";
import type { AuthorityDatabase } from "../../../storage/sqlite/authority-database.js";
import { createNativePathPicker } from "../../../transports/http/native-path-picker.js";
import type { SettingsRouteDeps } from "../../../transports/http/routes/settings-types.js";
import { resolveConfigWithProvenance, ResolvedConfigSchema } from "../../config/resolve.js";
import { buildSettingsEditor, type ProtectedSettingsEditorFacts } from "../../../runs/queries/settings-editor.js";
import { SettingsFileRecordSchema, SettingsRuntimeIdentitySchema } from "../../../../models/config/settings.js";
import { StoredConfigSchema } from "../../../../models/config/snapshot.js";
import { PersonPreferencesSchema } from "../../../../models/config/person-preferences.js";
import { HostConfigFactsSchema } from "../../../../models/config/host-display.js";
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

/** The same facts key the reuse and build the document. */
async function readProtectedFacts(read: () => ProtectedSettingsEditorFacts | Promise<ProtectedSettingsEditorFacts>):
  Promise<Readonly<{ state: "read"; facts: ProtectedSettingsEditorFacts }> | Readonly<{ state: "unreadable"; error: unknown }>> {
  try { return { state: "read", facts: await read() }; }
  catch (error) { return { state: "unreadable", error }; }
}

export function composeProfileSettings(input: Parameters<typeof createSettingsRuntimeReader>[0] & {
  readonly database: Pick<AuthorityDatabase, "withAuthorityReadSnapshot" | "authority">;
}) {
  const reader = createSettingsRuntimeReader(input);
  return Object.freeze({ read: () => input.database.withAuthorityReadSnapshot(() => reader.read(input.database.authority)) });
}

export function composeSettings(input: Parameters<typeof createSettingsRuntimeReader>[0] & {
  database: Pick<AuthorityDatabase, "withAuthorityReadSnapshot" | "authority">;
  environment: Readonly<Record<string, string | undefined>>; credentials: ReturnType<typeof createCredentialStore>;
  readProtectedSettings?: () => Promise<ProtectedSettingsEditorFacts>;
  assertCurrent?: () => void;
  resolveSettings?: Parameters<typeof createSettingsApplicationExecutor>[0];
  /** Seam for the settings store-part lane read and the stream row. */
  readLanes?: Pick<DashboardReadLanes, "read">;
  /** The profile's browser-root custody check, run on main for each lane resolution at every editor read. */
  assertBrowserRoot?: (path: string) => void;
  /** Builds the editor document on main; the G6 bench times it through this. */
  buildEditor?: typeof buildSettingsEditor;
  /** Runs `task` every `ms` until the returned stop; the fiscal-year watch's timer. */
  every?: (ms: number, task: () => void) => () => void;
}) {
  const { database, clock, hostFacts } = input;
  const reader = createSettingsRuntimeReader(input);
  const resolveSettings = input.resolveSettings ?? (settings => resolveConfigWithProvenance(settings, hostFacts, clock, input.runtimeStoragePair));
  // Protected commits and the fiscal-year rollover change the editor without an ordinary settings commit.
  const listeners = new Set<() => void>();
  const notify = () => { for (const listener of [...listeners]) listener(); };
  const every = input.every ?? ((ms, task) => { const timer = setInterval(task, ms); timer.unref(); return () => { clearInterval(timer); }; });
  let stopRollover: (() => void) | undefined;
  const onChange = (listener: () => void) => {
    listeners.add(listener);
    if (stopRollover === undefined) {
      let watched = clock.fiscalYear();
      // shortcut: polls once a minute, so the rollover reaches subscribers up to a minute late; schedule the boundary if that matters.
      stopRollover = every(60_000, () => { const fiscalYear = clock.fiscalYear(); if (fiscalYear !== watched) { watched = fiscalYear; notify(); } });
    }
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) { stopRollover?.(); stopRollover = undefined; }
    };
  };
  const applications = createSettingsApplicationExecutor(resolveSettings, input.credentials);
  const executor = Object.freeze<SettingsApplicationExecutor>({ ...applications, commitPrivate: command => {
    const refusal = applications.commitPrivate(command);
    // The private store commits here, ahead of the kernel's SQLite transaction; subscribers read after it settles.
    if (refusal === undefined) queueMicrotask(notify);
    return refusal;
  } });
  const read = <T>(project: (repositories: AuthorityDatabase["authority"]) => T) => database.withAuthorityReadSnapshot(() => {
    input.assertCurrent?.();
    const result = project(database.authority);
    input.assertCurrent?.();
    return result;
  });
  const routes: SettingsRouteDeps = {
    nativePathPicker: createNativePathPicker(),
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
    return { routes, editable, onChange, executor };
  }
  // Reused while the store part, the protected facts and the fiscal year are unchanged; any of them changing builds again.
  let last: { key: string; browserRoots: readonly string[]; document: EditableSettingsWire } | undefined;
  const readProtected = input.readProtectedSettings ?? (() => routes.settingsEditor.protectedSettings.read());
  // The root on disk can stop qualifying after startup, so a reused document is checked again.
  const assertBrowserRoots = (roots: readonly string[]) => { for (const root of roots) input.assertBrowserRoot?.(root); };
  const editable = async (): Promise<EditableSettingsWire> => {
    input.assertCurrent?.();
    const { body } = await lanes.read(settingsStorePartRead, { hostFacts, ...(input.runtimeStoragePair === undefined ? {} : { runtimeStoragePair: input.runtimeStoragePair }) });
    input.assertCurrent?.();
    const protectedFacts = await readProtectedFacts(readProtected);
    input.assertCurrent?.();
    const key = canonicalJsonStringify({ body, protectedFacts: protectedFacts.state === "read" ? protectedFacts.facts : null, fiscalYear: clock.fiscalYear() });
    if (last?.key === key) {
      assertBrowserRoots(last.browserRoots);
      return last.document;
    }
    const { record, active, activeConfig, activePreferences, resolutions } = SettingsStorePartSchema.parse(JSON.parse(body));
    const browserRoots = [resolutions.record.config.paths.browserProfileRoot, resolutions.defaults.config.paths.browserProfileRoot];
    assertBrowserRoots(browserRoots);
    const document = (input.buildEditor ?? buildSettingsEditor)({ ...routes.settingsEditor, resolutions,
      settings: { read: () => ({ record, runtimeStatus: settingsRuntimeStatusOf(record, active, resolutions.record.fingerprint), activeConfig, activePreferences }) },
      // The editor shows an unreadable protected store as unknown; the read's own error is what it sees.
      protectedSettings: { read: () => {
        if (protectedFacts.state === "unreadable") throw protectedFacts.error;
        return protectedFacts.facts;
      } } });
    last = { key, browserRoots, document };
    return document;
  };
  return { routes: { ...routes, settingsLane: { editable } }, editable, onChange, executor };
}
