import { DESCRIPTORS } from "../../registries/workflow-registry.js";
import { selectActiveRunSettings } from "../../../runs/settings/run-settings.js";
import { resolveConfigWithProvenance } from "../../config/resolve.js";
import type { createCredentialStore } from "../../../storage/configuration/credential-store.js";
import { activeSettingsConfig, createProtectedSettingsRuntimeReader, createSettingsRuntimeReader } from "../../../runtime/settings/settings-runtime.js";
import { createSettingsApplicationExecutor } from "../../../runs/commands/settings-service.js";
import type { SettingsRouteDeps } from "../../../transports/http/routes/settings-types.js";
import type { StorageRelocationPlanReader } from "../../../storage/maintenance/storage-relocation-plans.js";
import { createNativePathPicker } from "../../../transports/http/native-path-picker.js";
import type { CommandAuthority } from "../../../runs/commands/command-kernel.js";
import type { AuthorityDatabase } from "../../../storage/sqlite/authority-database.js";

export function composeProfileSettings(input: Parameters<typeof createSettingsRuntimeReader>[0] & {
  readonly database: Pick<AuthorityDatabase, "withAuthorityReadSnapshot" | "authority">;
}) {
  const reader = createSettingsRuntimeReader(input);
  return Object.freeze({ read: () => input.database.withAuthorityReadSnapshot(() => reader.read(input.database.authority)) });
}

export function composeSettings(input: Parameters<typeof createSettingsRuntimeReader>[0] & {
  database: CommandAuthority;
  environment: Readonly<Record<string, string | undefined>>; credentials: ReturnType<typeof createCredentialStore>;
  storageRelocationPlans?: Pick<StorageRelocationPlanReader, "read">;
  assertCurrent?: () => void;
  resolveSettings?: Parameters<typeof createSettingsApplicationExecutor>[0];
}) {
  const { database, clock, hostFacts } = input;
  const reader = createSettingsRuntimeReader(input);
  const resolveSettings = input.resolveSettings ?? (settings => resolveConfigWithProvenance(settings, hostFacts, clock, input.runtimeStoragePair));
  const routes: SettingsRouteDeps = {
    nativePathPicker: createNativePathPicker(),
    ...(input.storageRelocationPlans === undefined ? {} : { storageRelocationPlans: input.storageRelocationPlans }),
    settings: { readConfig: () => database.withAuthorityTransaction(repositories => { input.assertCurrent?.(); const result = activeSettingsConfig(repositories); input.assertCurrent?.(); return result; }), descriptors: DESCRIPTORS },
    settingsEditor: {
      settings: { read: () => database.withAuthorityTransaction(repositories => { input.assertCurrent?.(); const result = { ...reader.read(repositories), activeConfig: selectActiveRunSettings(repositories).config }; input.assertCurrent?.(); return result; }) },
      protectedSettings: createProtectedSettingsRuntimeReader({ read: () => { input.assertCurrent?.(); const result = input.credentials.read(); input.assertCurrent?.(); return result; } }), environment: input.environment, clock,
      resolve: resolveSettings,
    },
  };
  return { routes, executor: createSettingsApplicationExecutor(resolveSettings, input.credentials) };
}
