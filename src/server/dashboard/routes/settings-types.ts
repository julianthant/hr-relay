import type { SettingsQueryDeps } from "../queries/settings.js";
import type { SettingsEditorQueryDeps } from "../queries/settings-editor.js";
import type { StorageRelocationPlanView } from "../../../domain/commands.js";

export interface SettingsRouteDeps {
  readonly settings: SettingsQueryDeps;
  readonly settingsEditor: SettingsEditorQueryDeps;
  readonly storageRelocationPlans?: Readonly<{ read(): StorageRelocationPlanView }>;
}
