import { Field, SecretField } from "../ds/ui.js";
import type { useEditableSettings } from "./settings-editor-model.js";
import { formatSetting } from "./settings-draft-model.js";

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
  return <Field label={row.label} description={description} error={credentials.errors[name]}
    orientation="horizontal" controlWidth={controlWidth} className={className}
    disabled={credentials.locked || authority.state !== "available" || editor.readProblem !== undefined}>
    <SecretField label={row.label} identity={`${name}:${stored?.valueId ?? "empty"}`} value={value}
      autoComplete="new-password" spellCheck={false} placeholder="Enter value"
      onChange={event => credentials.update(name, event.target.value)}
      {...(stored !== undefined || operation?.kind === "set" ? { onRemove: () => onRemove(stored !== undefined, row.label) } : {})} />
  </Field>;
}
