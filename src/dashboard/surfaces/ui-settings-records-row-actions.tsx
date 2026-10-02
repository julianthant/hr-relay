import type { EditableSettingsLeafWire } from "../../models/dashboard/settings-editor.js";
import { Button } from "../ds/ui.js";
import type { useEditableSettings } from "./settings-editor-model.js";

type Editor = ReturnType<typeof useEditableSettings>;

export function SettingsRowActions({ editor, leaf, companion, textEntry }: {
  editor: Editor;
  leaf: EditableSettingsLeafWire;
  companion?: EditableSettingsLeafWire;
  textEntry: boolean;
}) {
  if (!textEntry || (editor.draft[leaf.path] === undefined && (companion === undefined || editor.draft[companion.path] === undefined))) return null;
  return <Button size="sm" variant="ghost" disabled={editor.locked} onClick={() => {
    editor.reset(leaf.path);
    if (companion !== undefined) editor.reset(companion.path);
  }}>Undo</Button>;
}
