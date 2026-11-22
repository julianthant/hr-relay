import type { EditableSettingsWire } from "../../../../models/dashboard/settings-editor.js";
import type { useEditableSettings } from "../editor/settings-editor-model.js";
import { formatSetting } from "../editor/settings-draft-model.js";

/** The Relay username is the saved UCPath username; undefined until the protected readback is available. */
export function relayUsername(editor: ReturnType<typeof useEditableSettings>): string | undefined {
  return editor.editor.state === "loaded" ? relayUsernameIn(editor.editor.document) : undefined;
}

export function relayUsernameIn(document: EditableSettingsWire): string | undefined {
  const authority = document.protectedSettings;
  const stored = authority.state === "available" ? authority.entries["ucpathUserId"] : undefined;
  return stored === undefined ? undefined : formatSetting(stored.value);
}
