import type { EditableSettingsLeafWire } from "../../domain/dashboard/settings-editor.js";
import { Field, Input, Select, Textarea, dsText } from "../ds/ui.js";
import { cn } from "../lib/utils.js";
import { settingInput, type SettingsDraftInput, type SettingsDraftOperation } from "./settings-draft-model.js";

export function SettingsValueControl({ leaf, operation, error, disabled, update }: {
  leaf: EditableSettingsLeafWire; operation: SettingsDraftOperation | undefined; error: string | undefined;
  disabled: boolean; update: (raw: SettingsDraftInput) => void;
}) {
  const raw = operation?.kind === "set" ? operation.raw : settingInput(leaf);
  if (leaf.control.input === "object") {
    if (typeof raw === "string") throw new Error("settings-object-draft-invalid");
    return <fieldset disabled={disabled} className="flex min-w-0 flex-col gap-[var(--ds-space-base)]">
      <legend className={cn(dsText.ui, "font-semibold text-[color:var(--ds-fg)]")}>{leaf.label}</legend>
      <div className="grid grid-cols-2 gap-[var(--ds-space-base)]">
        {leaf.control.fields.map(field => <Field key={field.name} label={field.name} required={field.required}>
          <Input type={field.input === "number" ? "number" : "url"} min={field.minimum} step={field.input === "number" ? 1 : undefined}
            aria-label={`${leaf.label}: ${field.name}`} value={raw[field.name] ?? ""} aria-invalid={error !== undefined || undefined}
            onChange={event => update({ ...raw, [field.name]: event.target.value })} />
        </Field>)}
      </div>
      {error !== undefined && <p role="alert" className={cn(dsText.meta, "text-[color:var(--ds-danger)]")}>{error}</p>}
    </fieldset>;
  }
  if (typeof raw !== "string") throw new Error("settings-scalar-draft-invalid");
  return <Field label={leaf.label} error={error} disabled={disabled} hint={leaf.input === "number" ? leaf.unit : leaf.input === "date" ? "M/D/YYYY" : undefined}>
    {leaf.input === "boolean" ? <Select value={raw} onChange={event => update(event.target.value)}><option value="true">Enabled</option><option value="false">Disabled</option></Select>
      : leaf.input === "models" ? <Textarea value={raw} rows={3} placeholder="One model per line, in order" onChange={event => update(event.target.value)} />
      : <Input type={leaf.input === "number" ? "number" : leaf.input === "url" ? "url" : "text"}
        value={raw} min={leaf.minimum} step={leaf.input === "number" ? 1 : undefined} onChange={event => update(event.target.value)} />}
  </Field>;
}
