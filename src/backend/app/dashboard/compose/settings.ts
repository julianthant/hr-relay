import { DESCRIPTORS } from "../../control/workflow-registry.js";
import { selectActiveRunSettings } from "../../../runs/run-settings.js";
import { resolveConfigWithProvenance } from "../../config/resolve.js";
import type { createCredentialStore } from "../../../storage/config/credential-store.js";
import type { createProviderKeyStore } from "../../../storage/config/provider-key-store.js";
import type { ProviderBootProvenance } from "../../../../domain/config/provider-boot-provenance.js";
import { ProviderKeySlotSchema } from "../../../../domain/config/provider-keys.js";
import { activeProviderKeySlots } from "../../../../domain/secrets.js";
import { activeSettingsConfig, createProtectedSettingsRuntimeReader, createSettingsRuntimeReader } from "../../../runtime/settings/settings-runtime.js";
import { createSettingsApplicationExecutor } from "../../../runs/dashboard/commands/settings-service.js";
import type { SettingsRouteDeps } from "../../../transports/dashboard/routes/settings-types.js";
import type { StorageRelocationPlanReader } from "../../../storage/storage-relocation-plans.js";
import { createNativePathPicker } from "../../../transports/dashboard/native-path-picker.js";

export function composeSettings(input: Parameters<typeof createSettingsRuntimeReader>[0] & {
  environment: Readonly<Record<string, string | undefined>>; credentials: ReturnType<typeof createCredentialStore>;
  providerKeys?: ReturnType<typeof createProviderKeyStore>; providerBoot?: ProviderBootProvenance;
  storageRelocationPlans?: Pick<StorageRelocationPlanReader, "read">;
}) {
  const { database, clock, hostFacts } = input;
  const activeProviderSlots = activeProviderKeySlots(input.environment);
  const reader = createSettingsRuntimeReader(input);
  const routes: SettingsRouteDeps = {
    nativePathPicker: createNativePathPicker(),
    ...(input.storageRelocationPlans === undefined ? {} : { storageRelocationPlans: input.storageRelocationPlans }),
    settings: { get config() { return database.withAuthorityTransaction(activeSettingsConfig); }, descriptors: DESCRIPTORS },
    settingsEditor: {
      settings: { read: () => database.withAuthorityTransaction(repositories => ({ ...reader.read(), activeConfig: selectActiveRunSettings(repositories).config })) },
      protectedSettings: createProtectedSettingsRuntimeReader(input.credentials), environment: input.environment, clock,
      providerKeys: input.providerKeys, providerBoot: input.providerBoot, activeProviderSlots,
      resolve: settings => resolveConfigWithProvenance(settings, hostFacts, clock, input.runtimeStoragePair),
    },
  };
  return { routes, executor: createSettingsApplicationExecutor(settings => resolveConfigWithProvenance(settings, hostFacts, clock, input.runtimeStoragePair), input.credentials,
    input.providerKeys === undefined ? undefined : { store: input.providerKeys, bootKnown: input.providerBoot !== undefined, restartRequired: (slots) => {
      if (input.providerBoot === undefined) throw new Error("provider-boot-provenance-unavailable");
      const parent = new Set(input.providerBoot.parentSlotNames);
      const candidateSlots = activeProviderKeySlots(slots);
      return ProviderKeySlotSchema.options.some(slot => !parent.has(slot)
        && activeProviderSlots[slot] !== candidateSlots[slot]);
    } }) };
}
