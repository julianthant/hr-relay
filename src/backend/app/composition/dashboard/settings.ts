import type { DashboardReadLanes } from "../../../storage/sqlite/dashboard-read-host.js";
import { createSettingsApplicationExecutor } from "../../../runs/commands/settings-service.js";
import { selectActiveRunSettings } from "../../../runs/settings/run-settings.js";
import { createProtectedSettingsRuntimeReader,createSettingsRuntimeReader } from "../../../runtime/settings/settings-runtime.js";
import type { createCredentialStore } from "../../../storage/configuration/credential-store.js";
import type { AuthorityDatabase } from "../../../storage/sqlite/authority-database.js";
import { createNativePathPicker } from "../../../transports/http/native-path-picker.js";
import type { SettingsRouteDeps } from "../../../transports/http/routes/settings-types.js";
import { resolveConfigWithProvenance } from "../../config/resolve.js";
import { buildSettingsEditor } from "../../../runs/queries/settings-editor.js";

export function composeProfileSettings(input: Parameters<typeof createSettingsRuntimeReader>[0] & {
  readonly database: Pick<AuthorityDatabase, "withAuthorityReadSnapshot" | "authority">;
}) {
  const reader = createSettingsRuntimeReader(input);
  return Object.freeze({ read: () => input.database.withAuthorityReadSnapshot(() => reader.read(input.database.authority)) });
}

export function composeSettings(input: Parameters<typeof createSettingsRuntimeReader>[0] & {
  database: Pick<AuthorityDatabase, "withAuthorityReadSnapshot" | "authority">;
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
  const editable = () => buildSettingsEditor(routes.settingsEditor);
  return { routes, editable, executor: createSettingsApplicationExecutor(resolveSettings, input.credentials) };
}
