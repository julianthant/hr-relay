import { Pencil } from "lucide-react";
import { useState } from "react";
import { Button, Dialog, DialogContent, DialogFooter, IconButton, ResultRow, dsIcon } from "../../../ds/ui.js";
import type { useEditableSettings } from "../editor/settings-editor-model.js";
import { formatSetting } from "../editor/settings-draft-model.js";
import { ProtectedSettingField } from "./settings-protected-field.js";

type Editor = ReturnType<typeof useEditableSettings>;
type Name = Parameters<Editor["protectedEditor"]["update"]>[0];

/** A saved protected value shown as a row; the pencil opens a dialog over the same draft and Save command. */
export function ProtectedPencilRow({ editor, name, label, description, onRemove }: {
  editor: Editor; name: Name; label: string; description: string;
  onRemove: (hasSaved: boolean, label: string) => void;
}) {
  const [open, setOpen] = useState(false);
  if (editor.editor.state !== "loaded") return null;
  const authority = editor.editor.document.protectedSettings;
  const credentials = editor.protectedEditor;
  const stored = authority.state === "available" ? authority.entries[name] : undefined;
  const shown = stored === undefined ? "Not set" : name === "ucpathUserId" ? formatSetting(stored.value) : "••••••••";
  const disabled = credentials.locked || authority.state !== "available" || editor.readProblem !== undefined;
  const close = (): void => { credentials.reset(name); setOpen(false); };
  return <div data-settings-path={`protected.${name}`}>
    <ResultRow label={label} value={<span className="inline-flex items-center justify-end gap-3">
      <span className="text-ui-muted">{shown}</span>
      <IconButton type="button" label={`Edit ${label}`} variant="ghost" size="sm" disabled={disabled} icon={<Pencil aria-hidden className={dsIcon.sm} />} onClick={() => setOpen(true)} />
    </span>} />
    <Dialog open={open} onOpenChange={next => { if (!next) close(); }}>
      <DialogContent size="sm" title={label} description="Saved for this account only.">
        <ProtectedSettingField editor={editor} name={name} description={description} onRemove={onRemove} />
        <DialogFooter>
          <Button variant="secondary" onClick={close}>Cancel</Button>
          <Button onClick={() => { credentials.submit(); setOpen(false); }}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}
