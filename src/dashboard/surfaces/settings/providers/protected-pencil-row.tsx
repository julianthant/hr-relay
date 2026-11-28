import { Pencil } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button, Dialog, DialogBody, DialogContent, DialogFooter, IconButton, ResultRow, dsIcon } from "../../../ds/ui.js";
import type { useEditableSettings } from "../editor/settings-editor-model.js";
import { formatSetting } from "../editor/settings-draft-model.js";
import { SavingMark } from "../editor/settings-controls.js";
import { ProtectedSettingField } from "./settings-protected-field.js";

type Editor = ReturnType<typeof useEditableSettings>;
type Name = Parameters<Editor["protectedEditor"]["update"]>[0];

/** A saved protected value shown as a row; the pencil opens a dialog over the same draft and Save command. */
export function ProtectedPencilRow({ editor, name, label, thing, description }: {
  editor: Editor; name: Name; label: string; thing: string; description: string;
}) {
  const [open, setOpen] = useState(false);
  const pencil = useRef<HTMLButtonElement>(null);
  const { setExplicitSave } = editor.protectedEditor;
  useEffect(() => { setExplicitSave(open); return () => setExplicitSave(false); }, [open, setExplicitSave]);
  if (editor.editor.state !== "loaded") return null;
  const authority = editor.editor.document.protectedSettings;
  const credentials = editor.protectedEditor;
  const stored = authority.state === "available" ? authority.entries[name] : undefined;
  const disabled = credentials.locked || authority.state !== "available" || editor.readProblem !== undefined;
  const operation = credentials.draft[name];
  const typed = operation?.kind === "set" ? operation.raw.trim() : "";
  const changed = typed !== "" && !(name === "ucpathUserId" && stored !== undefined && typed === formatSetting(stored.value));
  // A username waiting for a fresh revision, or being saved, shows what was typed; after this credential's save fails the row shows the served value and the draft waits for an explicit Save in the dialog.
  const waiting = name === "ucpathUserId" && !open && typed !== "" && !credentials.failedNames.includes(name) ? typed : undefined;
  const shown = stored === undefined && waiting === undefined ? "Not set" : name === "ucpathUserId" ? waiting ?? formatSetting(stored?.value) : "••••••••";
  const close = (): void => { credentials.reset(name); setOpen(false); };
  return <div data-settings-path={`protected.${name}`}>
    <ResultRow label={label} value={<span className="inline-flex items-center justify-end gap-3">
      <span className="text-ui-primary">{shown}</span>
      <IconButton ref={pencil} type="button" label={`Edit ${thing}`} variant="ghost" size="sm" disabled={disabled} icon={<Pencil aria-hidden className={dsIcon.sm} />} onClick={() => setOpen(true)} />
    </span>} />
    <Dialog open={open} onOpenChange={next => { if (!next) close(); }}>
      <DialogContent size="sm" className="settings-edit-dialog" title={`Edit ${thing}`} onCloseAutoFocus={event => { event.preventDefault(); pencil.current?.focus({ preventScroll: true }); }}>
        <DialogBody><ProtectedSettingField editor={editor} name={name} description={description} inDialog /></DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={close}>Cancel</Button>
          <Button variant="primary" disabled={disabled || !changed} onClick={() => { credentials.submit(); setOpen(false); }}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <SavingMark editor={{ savingPaths: credentials.savingNames }} path={name} />
  </div>;
}
