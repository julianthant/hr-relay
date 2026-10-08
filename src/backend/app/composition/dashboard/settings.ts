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

export function composeSettings(input: Parameters<typeof createSettingsRuntimeReader>[0] & {
  database: CommandAuthority;
  environment: Readonly<Record<string, string | undefined>>; credentials: ReturnType<typeof createCredentialStore>;
  storageRelocationPlans?: Pick<StorageRelocationPlanReader, "read">;
}) {
  const { database, clock, hostFacts } = input;
  const reader = createSettingsRuntimeReader(input);
  const routes: SettingsRouteDeps = {
    nativePathPicker: createNativePathPicker(),
    ...(input.storageRelocationPlans === undefined ? {} : { storageRelocationPlans: input.storageRelocationPlans }),
    settings: { readConfig: () => database.withAuthorityTransaction(activeSettingsConfig), descriptors: DESCRIPTORS },
    settingsEditor: {
      settings: { read: () => database.withAuthorityTransaction(repositories => ({ ...reader.read(repositories), activeConfig: selectActiveRunSettings(repositories).config })) },
      protectedSettings: createProtectedSettingsRuntimeReader(input.credentials), environment: input.environment, clock,
      resolve: settings => resolveConfigWithProvenance(settings, hostFacts, clock, input.runtimeStoragePair),
    },
  };
  return { routes, executor: createSettingsApplicationExecutor(settings => resolveConfigWithProvenance(settings, hostFacts, clock, input.runtimeStoragePair), input.credentials, ) };
}
