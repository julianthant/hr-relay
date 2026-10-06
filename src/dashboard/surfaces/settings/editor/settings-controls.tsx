import type { EditableSettingsLeafWire } from "../../../../domain/dashboard/settings-editor.js";
import { Field, Input, Switch, Textarea, UnitField, dsText } from "../../../ds/ui.js";
import { cn } from "../../../lib/utils.js";
import { settingInput, type SettingsDraftInput, type SettingsDraftOperation } from "./settings-draft-model.js";
import { settingNote, settingObjectFieldTitle, settingTitle } from "../settings-presentation.js";
import { timeoutSetting } from "../general/settings-timeouts-model.js";
import { providerFieldPresentation } from "./ui-settings-records-labels.js";

export function SettingsValueControl({ leaf, operation, error, disabled, update }: {
  leaf: EditableSettingsLeafWire; operation: SettingsDraftOperation | undefined; error: string | undefined;
  disabled: boolean; update: (raw: SettingsDraftInput) => void;
}) {
  const raw = operation?.kind === "set" ? operation.raw : settingInput(leaf, operation?.kind === "clear" ? leaf.defaultValue ?? "" : leaf.effectiveValue);
  if (leaf.control.input === "object") {
    if (typeof raw === "string") throw new Error("settings-object-draft-invalid");
    return <fieldset disabled={disabled} className="settings-object-field flex min-w-0 flex-col gap-[var(--ds-space-base)]">
      <legend className={cn(dsText.ui, "font-semibold text-[color:var(--ds-fg)]")}>{settingTitle(leaf)}</legend>
      {settingNote(leaf) !== undefined && <p className={cn(dsText.body, "m-0 text-[color:var(--ds-fg-muted)]")}>{settingNote(leaf)}</p>}
      <div className="settings-object-fields grid grid-cols-2 gap-[var(--ds-space-base)]">
        {leaf.control.fields.map(field => <Field key={field.name} orientation="horizontal" label={settingObjectFieldTitle(field.name)} hint={providerFieldPresentation(field.name).unit} required={field.required} className="settings-object-subfield">
          <Input name={`${leaf.path}.${field.name}`} autoComplete="off" type={field.input === "number" ? "number" : "url"} min={field.minimum} step={field.input === "number" ? 1 : undefined}
            aria-label={`${settingTitle(leaf)}: ${settingObjectFieldTitle(field.name)}`} value={raw[field.name] ?? ""} aria-invalid={error !== undefined || undefined}
            onChange={event => update({ ...raw, [field.name]: event.target.value })} />
        </Field>)}
      </div>
      {error !== undefined && <p role="alert" className={cn(dsText.meta, "text-[color:var(--ds-danger)]")}>{error}</p>}
    </fieldset>;
  }
  if (typeof raw !== "string") throw new Error("settings-scalar-draft-invalid");
  const timeout = timeoutSetting(leaf.path);
  if (timeout !== undefined) {
    return <Field orientation="horizontal" label={timeout.title} description={timeout.description} error={error} disabled={disabled} className="settings-row-field">
      <UnitField name={leaf.path} autoComplete="off" type="text" inputMode="decimal" aria-label={`${timeout.title} in seconds`} unit="seconds" value={raw} onChange={event => update(event.target.value)} />
    </Field>;
  }
  if (leaf.input === "boolean") {
    return <div className="settings-row-field settings-switch-control">
      <Switch name={leaf.path} checked={raw === "true"} label={settingTitle(leaf)} description={settingNote(leaf)} disabled={disabled}
        onCheckedChange={checked => update(String(checked))} />
      {error !== undefined && <p role="alert" className={cn(dsText.meta, "text-[color:var(--ds-danger)]")}>{error}</p>}
    </div>;
  }
  return <Field orientation="horizontal" label={settingTitle(leaf)} description={settingNote(leaf)} error={error} disabled={disabled} required={leaf.path.startsWith("annualDates.") && leaf.path.endsWith(".jobEndDate")} hint={leaf.input === "number" ? leaf.unit : leaf.input === "date" ? "M/D/YYYY" : leaf.input === "models" ? "One model per line; order is fallback priority." : undefined} className="settings-row-field">
    {leaf.input === "models" ? <Textarea name={leaf.path} autoComplete="off" value={raw} rows={3} placeholder="One model per line, in order" onChange={event => update(event.target.value)} />
      : <Input name={leaf.path} autoComplete="off" type={leaf.input === "number" ? "number" : leaf.input === "url" ? "url" : "text"}
        required={leaf.path.startsWith("annualDates.") && leaf.path.endsWith(".jobEndDate")}
        value={raw} min={leaf.minimum} step={leaf.input === "number" ? 1 : undefined} onChange={event => update(event.target.value)} />}
  </Field>;
}
