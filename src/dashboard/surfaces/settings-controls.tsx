import type { EditableSettingsLeafWire } from "../../domain/dashboard/settings-editor.js";
import { Field, Input, Select, Textarea, dsText } from "../ds/ui.js";
import { cn } from "../lib/utils.js";
import { settingInput, type SettingsDraftInput, type SettingsDraftOperation } from "./settings-draft-model.js";
import { settingNote, settingObjectFieldTitle, settingTitle } from "./settings-presentation.js";
import { timeoutDisplayUnit, timeoutInput, timeoutSetting, timeoutValue, type TimeoutUnit } from "./settings-timeouts-model.js";
import { providerFieldPresentation } from "./ui-settings-records-labels.js";

export function SettingsValueControl({ leaf, operation, error, disabled, update }: {
  leaf: EditableSettingsLeafWire; operation: SettingsDraftOperation | undefined; error: string | undefined;
  disabled: boolean; update: (raw: SettingsDraftInput, unit?: TimeoutUnit) => void;
}) {
  const raw = operation?.kind === "set" ? operation.raw : settingInput(leaf, operation?.kind === "clear" ? leaf.defaultValue ?? "" : leaf.effectiveValue);
  if (leaf.control.input === "object") {
    if (typeof raw === "string") throw new Error("settings-object-draft-invalid");
    return <fieldset disabled={disabled} className="settings-object-field flex min-w-0 flex-col gap-[var(--ds-space-base)]">
      <legend className={cn(dsText.ui, "font-semibold text-[color:var(--ds-fg)]")}>{settingTitle(leaf)}</legend>
      <div className="settings-object-fields grid grid-cols-2 gap-[var(--ds-space-base)]">
        {leaf.control.fields.map(field => <Field key={field.name} label={settingObjectFieldTitle(field.name)} hint={providerFieldPresentation(field.name).unit} required={field.required} className="settings-object-subfield">
          <Input type={field.input === "number" ? "number" : "url"} min={field.minimum} step={field.input === "number" ? 1 : undefined}
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
    const unit = operation?.kind === "set" ? operation.timeoutUnit ?? timeoutDisplayUnit(leaf) : timeoutDisplayUnit(leaf);
    let minuteValue: string | undefined;
    if (error === undefined) {
      try { minuteValue = timeoutInput(leaf, timeoutValue(leaf, raw, unit), "minutes"); }
      catch { minuteValue = undefined; }
    }
    return <Field label={timeout.title} description={timeout.description} error={error} disabled={disabled} className="settings-row-field">
      <div className="settings-timeout-input">
        <Input type="text" inputMode="decimal" aria-label={`${timeout.title} in ${unit}`} value={raw} onChange={event => update(event.target.value, unit)} />
        <select aria-label={`${timeout.title} unit`} value={unit} disabled={disabled || error !== undefined}
          onChange={event => {
            const nextUnit = event.target.value as TimeoutUnit;
            const value = timeoutValue(leaf, raw, unit);
            update(nextUnit === "minutes" && minuteValue !== undefined ? minuteValue : timeoutInput(leaf, value, nextUnit), nextUnit);
          }}>
          <option value="seconds">seconds</option>
          <option value="minutes" disabled={minuteValue === undefined}>minutes</option>
        </select>
      </div>
    </Field>;
  }
  return <Field label={settingTitle(leaf)} description={settingNote(leaf)} error={error} disabled={disabled} hint={leaf.input === "number" ? leaf.unit : leaf.input === "date" ? "M/D/YYYY" : leaf.input === "models" ? "One model per line; order is fallback priority." : undefined} className="settings-row-field">
    {leaf.input === "boolean" ? <Select value={raw} onChange={event => update(event.target.value)}><option value="true">Enabled</option><option value="false">Disabled</option></Select>
      : leaf.input === "models" ? <Textarea value={raw} rows={3} placeholder="One model per line, in order" onChange={event => update(event.target.value)} />
      : <Input type={leaf.input === "number" ? "number" : leaf.input === "url" ? "url" : "text"}
        value={raw} min={leaf.minimum} step={leaf.input === "number" ? 1 : undefined} onChange={event => update(event.target.value)} />}
  </Field>;
}
