import type { SettingsQueryDeps } from "../../../runs/queries/settings.js";
import type { SettingsEditorQueryDeps } from "../../../runs/queries/settings-editor.js";
import type { StorageRelocationPlanView } from "../../../../rules/commands/commands.js";
import type { NativePathPicker } from "../native-path-picker.js";

export interface SettingsRouteDeps {
  readonly settings: SettingsQueryDeps;
  readonly settingsEditor: SettingsEditorQueryDeps;
  readonly storageRelocationPlans?: Readonly<{ read(): StorageRelocationPlanView }>;
  readonly nativePathPicker?: NativePathPicker;
}
