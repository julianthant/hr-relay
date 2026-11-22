import type { SettingsEditorQueryDeps } from "../../../runs/queries/settings-editor.js";
import type { SettingsQueryDeps } from "../../../runs/queries/settings.js";
import type { NativePathPicker } from "../native-path-picker.js";
import type { SettingsFactsWire } from "../../../../models/dashboard/settings.js";
import type { PositionedRead } from "../read-reuse.js";

export interface SettingsRouteDeps {
  readonly settings: SettingsQueryDeps;
  readonly withSettingsFacts?: (respond: PositionedRead<SettingsFactsWire>) => Response;
  readonly settingsEditor: SettingsEditorQueryDeps;
  readonly nativePathPicker?: NativePathPicker;
}
