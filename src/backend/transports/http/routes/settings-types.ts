import type { SettingsEditorQueryDeps } from "../../../runs/queries/settings-editor.js";
import type { NativePathPicker } from "../native-path-picker.js";

export interface SettingsRouteDeps {
  readonly settingsEditor: SettingsEditorQueryDeps;
  readonly nativePathPicker?: NativePathPicker;
}
