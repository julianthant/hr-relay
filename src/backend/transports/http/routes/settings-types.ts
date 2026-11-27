import type { SettingsEditorQueryDeps } from "../../../runs/queries/settings-editor.js";
import type { NativePathPicker } from "../native-path-picker.js";
import type { EditableSettingsWire } from "../../../../models/dashboard/settings-editor.js";

export interface SettingsRouteDeps {
  readonly settingsEditor: SettingsEditorQueryDeps;
  readonly nativePathPicker?: NativePathPicker;
  /** The editor is built on main over the lane's store part. */
  readonly settingsLane?: Readonly<{ editable(): Promise<EditableSettingsWire> }>;
}
