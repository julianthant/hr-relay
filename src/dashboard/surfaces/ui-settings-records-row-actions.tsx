import { Ellipsis } from "lucide-react";
import type { EditableSettingsLeafWire } from "../../domain/dashboard/settings-editor.js";
import { Button, IconButton, Popover, PopoverContent, PopoverTrigger, dsIcon } from "../ds/ui.js";
import { formatSetting } from "./settings-draft-model.js";
import type { useEditableSettings } from "./settings-editor-model.js";
import { settingTitle } from "./settings-presentation.js";

type Editor = ReturnType<typeof useEditableSettings>;

export function SettingsRowActions({ editor, leaf, companion, standardValue }: { editor: Editor; leaf: EditableSettingsLeafWire; companion?: EditableSettingsLeafWire; standardValue?: string }) {
  const operation = editor.draft[leaf.path];
  const companionOperation = companion === undefined ? undefined : editor.draft[companion.path];
  const jobEndDate = leaf.path.endsWith(".jobEndDate");
  const restorable = (leaf.source === "settings" || companion?.source === "settings") && !jobEndDate && operation?.kind !== "clear";
  if (!restorable && operation === undefined && companionOperation === undefined) return null;
  return <Popover><PopoverTrigger asChild><IconButton size="xs" label={`Actions for ${companion === undefined ? settingTitle(leaf) : "browser viewport"}`} icon={<Ellipsis aria-hidden className={dsIcon.sm} />} /></PopoverTrigger>
    <PopoverContent title="Value actions" width="sm" align="end"><div className="settings-compact-actions">
      {restorable && <Button size="sm" variant="ghost" title={`Standard value: ${standardValue ?? formatSetting(leaf.defaultValue)}`} onClick={() => editor.clear(leaf.path)} disabled={editor.locked}>Restore standard</Button>}
      {operation !== undefined && <Button size="sm" variant="ghost" onClick={() => editor.reset(leaf.path)} disabled={editor.locked}>{companion === undefined ? "Undo edit" : "Undo width edit"}</Button>}
      {companion !== undefined && companionOperation !== undefined && <Button size="sm" variant="ghost" onClick={() => editor.reset(companion.path)} disabled={editor.locked}>Undo height edit</Button>}
    </div></PopoverContent>
  </Popover>;
}
