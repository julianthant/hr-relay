import { Pencil } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button, Dialog, DialogBody, DialogContent, DialogFooter, IconButton, ResultRow, dsIcon } from "../../../ds/ui.js";
import type { useEditableSettings } from "../editor/settings-editor-model.js";
import { formatSetting } from "../editor/settings-draft-model.js";
import { ProtectedSettingField } from "./settings-protected-field.js";

type Editor = ReturnType<typeof useEditableSettings>;
type Name = Parameters<Editor["protectedEditor"]["update"]>[0];

/** A saved protected value shown as a row; the pencil opens a dialog over the same draft and Save command. */
export function ProtectedPencilRow({ editor, name, label, thing, description, onRemove }: {
  editor: Editor; name: Name; label: string; thing: string; description: string;
  onRemove: (hasSaved: boolean, label: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const pencil = useRef<HTMLButtonElement>(null);
  const { setExplicitSave } = editor.protectedEditor;
  useEffect(() => { setExplicitSave(open); return () => setExplicitSave(false); }, [open, setExplicitSave]);
  if (editor.editor.state !== "loaded") return null;
  const authority = editor.editor.document.protectedSettings;
  const credentials = editor.protectedEditor;
  const stored = authority.state === "available" ? authority.entries[name] : undefined;
  const shown = stored === undefined ? "Not set" : name === "ucpathUserId" ? formatSetting(stored.value) : "••••••••";
  const disabled = credentials.locked || authority.state !== "available" || editor.readProblem !== undefined;
  const canRemove = stored !== undefined || credentials.draft[name]?.kind === "set";
  const close = (): void => { credentials.reset(name); setOpen(false); };
  return <div data-settings-path={`protected.${name}`}>
    <ResultRow label={label} value={<span className="inline-flex items-center justify-end gap-3">
      <span className="text-ui-primary">{shown}</span>
      <IconButton ref={pencil} type="button" label={`Edit ${thing}`} variant="ghost" size="sm" disabled={disabled} icon={<Pencil aria-hidden className={dsIcon.sm} />} onClick={() => setOpen(true)} />
    </span>} />
    <Dialog open={open} onOpenChange={next => { if (!next) close(); }}>
      <DialogContent size="sm" className="settings-edit-dialog" title={`Edit ${thing}`} onCloseAutoFocus={event => { event.preventDefault(); pencil.current?.focus({ preventScroll: true }); }}>
        <DialogBody><ProtectedSettingField editor={editor} name={name} description={description} onRemove={onRemove} inDialog /></DialogBody>
        <DialogFooter meta={canRemove ? <Button variant="ghost" aria-label={`Remove ${thing}`} className="settings-edit-remove" disabled={disabled} onClick={() => onRemove(stored !== undefined, thing)}>Remove</Button> : undefined}>
          <Button variant="secondary" onClick={close}>Cancel</Button>
          <Button variant="primary" onClick={() => { credentials.submit(); setOpen(false); }}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}
