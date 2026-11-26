import type { SettingsEditorQueryDeps } from "../../../runs/queries/settings-editor.js";
import type { SettingsQueryDeps } from "../../../runs/queries/settings.js";
import type { NativePathPicker } from "../native-path-picker.js";
import type { SettingsFactsWire } from "../../../../models/dashboard/settings.js";
import type { PositionedRead } from "../read-reuse.js";
import type { EditableSettingsWire } from "../../../../models/dashboard/settings-editor.js";

export interface SettingsRouteDeps {
  readonly settings: SettingsQueryDeps;
  readonly withSettingsFacts?: (respond: PositionedRead<SettingsFactsWire>) => Response;
  readonly settingsEditor: SettingsEditorQueryDeps;
  readonly nativePathPicker?: NativePathPicker;
  /** Both GETs on a read lane: the facts as the lane's body, the editor built on main over the lane's store part. */
  readonly settingsLane?: Readonly<{ facts(): Promise<string>; editable(): Promise<EditableSettingsWire> }>;
}
