import { Trash2 } from "lucide-react";
import { Field, IconButton, Input, SecretField, dsIcon } from "../../../ds/ui.js";
import type { useEditableSettings } from "../editor/settings-editor-model.js";
import { formatSetting } from "../editor/settings-draft-model.js";

type Editor = ReturnType<typeof useEditableSettings>;

export function ProtectedSettingField({ editor, name, description, controlWidth = "medium", className, onRemove }: {
  editor: Editor;
  name: Parameters<Editor["protectedEditor"]["update"]>[0];
  description: string;
  controlWidth?: "medium" | "wide";
  className?: string;
  onRemove: (hasSaved: boolean, label: string) => void;
}) {
  if (editor.editor.state !== "loaded") return null;
  const authority = editor.editor.document.protectedSettings;
  const row = authority.rows.find(candidate => candidate.name === name);
  if (row === undefined) throw new Error(`protected-setting-row-missing:${name}`);
  const credentials = editor.protectedEditor;
  const operation = credentials.draft[name];
  const stored = authority.state === "available" ? authority.entries[name] : undefined;
  const value = operation?.kind === "set" ? operation.raw : operation?.kind === "clear" ? "" : stored === undefined ? "" : formatSetting(stored.value);
  const disabled = credentials.locked || authority.state !== "available" || editor.readProblem !== undefined;
  const canRemove = stored !== undefined || operation?.kind === "set";
  const visible = name === "ucpathUserId" || name === "timekeeperName";
  const label = name === "ucpathUserId" ? "UCPath username" : row.label;
  return <Field data-settings-path={`protected.${name}`} label={label} description={description} error={credentials.errors[name]}
    orientation="horizontal" controlWidth={controlWidth} className={className}
    disabled={disabled}>
    {visible ? <div className="ds-secret-field">
      <Input type="text" value={value} disabled={disabled} autoComplete="off" spellCheck={false} placeholder="Enter value"
        onChange={event => credentials.update(name, event.target.value)} />
      {canRemove && <IconButton type="button" label={`Remove ${label}`} disabled={disabled} variant="danger-outline" size="sm"
        className="ds-secret-remove" icon={<Trash2 aria-hidden className={dsIcon.sm} />}
        onClick={() => onRemove(stored !== undefined, label)} />}
    </div> : <SecretField label={label} identity={`${name}:${stored?.valueId ?? "empty"}`} value={value}
      autoComplete="new-password" spellCheck={false} placeholder="Enter value"
      onChange={event => credentials.update(name, event.target.value)}
      {...(canRemove ? { onRemove: () => onRemove(stored !== undefined, label) } : {})} />}
  </Field>;
}
