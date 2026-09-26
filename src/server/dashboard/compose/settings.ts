import { DESCRIPTORS } from "../../../control/workflow-registry.js";
import { selectActiveRunSettings } from "../../../core/run-settings.js";
import { resolveConfigWithProvenance } from "../../../domain/config/resolve.js";
import type { createCredentialStore } from "../../../infra/config/credential-store.js";
import { activeSettingsConfig, createProtectedSettingsRuntimeReader, createSettingsRuntimeReader } from "../../settings-runtime.js";
import { createSettingsApplicationExecutor } from "../commands/settings-service.js";
import type { SettingsRouteDeps } from "../routes/settings-types.js";

export function composeSettings(input: Parameters<typeof createSettingsRuntimeReader>[0] & {
  environment: Readonly<Record<string, string | undefined>>; credentials: ReturnType<typeof createCredentialStore>;
}) {
  const { database, clock, hostFacts } = input;
  const reader = createSettingsRuntimeReader(input);
  const routes: SettingsRouteDeps = {
    settings: { get config() { return database.withAuthorityTransaction(activeSettingsConfig); }, descriptors: DESCRIPTORS },
    settingsEditor: {
      settings: { read: () => database.withAuthorityTransaction(repositories => ({ ...reader.read(), activeConfig: selectActiveRunSettings(repositories).config })) },
      protectedSettings: createProtectedSettingsRuntimeReader(input.credentials), environment: input.environment, clock,
    },
  };
  return { routes, executor: createSettingsApplicationExecutor(settings => resolveConfigWithProvenance(settings, hostFacts, clock), input.credentials) };
}
