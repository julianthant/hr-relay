import { Field, Input, SecretField } from "../../../ds/ui.js";
import type { useEditableSettings } from "../editor/settings-editor-model.js";
import { formatSetting } from "../editor/settings-draft-model.js";
import { SavingMark } from "../editor/settings-controls.js";

type Editor = ReturnType<typeof useEditableSettings>;

export function ProtectedSettingField({ editor, name, description, controlWidth = "medium", className, inDialog = false }: {
  editor: Editor;
  name: Parameters<Editor["protectedEditor"]["update"]>[0];
  description: string;
  controlWidth?: "medium" | "wide";
  className?: string;
  /** Inside an edit dialog: label above the input and no helper line. The UCPath sign-in is required, so nothing offers to remove it. */
  inDialog?: boolean;
}) {
  if (editor.editor.state !== "loaded") return null;
  const authority = editor.editor.document.protectedSettings;
  const row = authority.rows.find(candidate => candidate.name === name);
  if (row === undefined) throw new Error(`protected-setting-row-missing:${name}`);
  const credentials = editor.protectedEditor;
  const operation = credentials.draft[name];
  const stored = authority.state === "available" ? authority.entries[name] : undefined;
  const value = operation?.kind === "set" ? operation.raw : operation?.kind === "clear" ? "" : stored === undefined || name !== "ucpathUserId" ? "" : formatSetting(stored.value);
  const disabled = credentials.locked || authority.state !== "available" || editor.readProblem !== undefined;
  const visible = name === "ucpathUserId";
  const label = name === "ucpathUserId" ? "UCPath username" : row.label;
  const field = <Field {...inDialog ? { "data-settings-path": `protected.${name}` } : {}} label={label} {...inDialog ? {} : { description }} error={credentials.errors[name]}
    orientation={inDialog ? "vertical" : "horizontal"} controlWidth={controlWidth} className={className}
    disabled={disabled}>
    {visible ? <div className="ds-secret-field">
      <Input type="text" name={name} value={value} disabled={disabled} autoComplete={name === "ucpathUserId" ? "section-ucpath username" : "off"} spellCheck={false} placeholder="Enter value"
        onChange={event => credentials.update(name, event.target.value)} />
    </div> : <SecretField label={label} identity={`${name}:${stored?.valueId ?? "empty"}`} value={value}
      name={name} autoComplete={name === "ucpathPassword" ? "section-ucpath new-password" : "off"} spellCheck={false} placeholder="Enter value"
      onChange={event => credentials.update(name, event.target.value)} />}
  </Field>;
  return inDialog ? field : <div data-settings-path={`protected.${name}`}>{field}<SavingMark editor={{ savingPaths: credentials.savingNames }} path={name} /></div>;
}
