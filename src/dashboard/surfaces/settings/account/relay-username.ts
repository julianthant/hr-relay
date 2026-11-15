import type { useEditableSettings } from "../editor/settings-editor-model.js";
import { formatSetting } from "../editor/settings-draft-model.js";

/** The Relay username is the saved UCPath username; undefined until the protected readback is available. */
export function relayUsername(editor: ReturnType<typeof useEditableSettings>): string | undefined {
  if (editor.editor.state !== "loaded") return undefined;
  const authority = editor.editor.document.protectedSettings;
  const stored = authority.state === "available" ? authority.entries["ucpathUserId"] : undefined;
  return stored === undefined ? undefined : formatSetting(stored.value);
}
