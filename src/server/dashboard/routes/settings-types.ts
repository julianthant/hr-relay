import type { SettingsQueryDeps } from "../queries/settings.js";
import type { SettingsEditorQueryDeps } from "../queries/settings-editor.js";

export interface SettingsRouteDeps {
  readonly settings: SettingsQueryDeps;
  readonly settingsEditor: SettingsEditorQueryDeps;
}
