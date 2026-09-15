import { canonicalJsonStringify } from "../../domain/canonical-json.js";
import { SettingsPatchSchema, type SettingsPatch } from "../../domain/config/settings.js";
import type { EditableSettingsLeafWire, EditableSettingsWire, EditorValue } from "../../domain/dashboard/settings-editor.js";

export type SettingsDraftInput = string | Readonly<Record<string, string>>;
export type SettingsDraftOperation = { readonly kind: "set"; readonly raw: SettingsDraftInput; readonly companion?: true } | { readonly kind: "clear" };
export type SettingsDraft = Readonly<Record<string, SettingsDraftOperation>>;
export function formatSetting(value: EditorValue | undefined): string {
  if (value === undefined) return "not set";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}
export function settingInput(leaf: EditableSettingsLeafWire): SettingsDraftInput {
  const value = leaf.effectiveValue;
  if (leaf.input === "object") {
    if (leaf.control.input !== "object") throw new Error("settings-control-mismatch");
    return Object.fromEntries(leaf.control.fields.map(field => [field.name, value !== undefined && typeof value === "object" && !Array.isArray(value) && value[field.name] !== undefined ? String(value[field.name]) : ""]));
  }
  if (leaf.input === "models") return Array.isArray(value) ? value.join("\n") : "";
  if (value !== undefined && typeof value === "object") throw new Error("settings-scalar-value-invalid");
  return value === undefined ? "" : String(value);
}
function integer(raw: string): number {
  if (!/^(?:0|[1-9]\d*)$/u.test(raw) || !Number.isSafeInteger(Number(raw))) throw new Error("invalid-number");
  return Number(raw);
}
export function valueFromSettingInput(leaf: EditableSettingsLeafWire, raw: SettingsDraftInput): EditorValue {
  if (leaf.control.input === "object") {
    if (typeof raw === "string") throw new Error("invalid-object");
    return Object.fromEntries(leaf.control.fields.flatMap(field => {
      const value = raw[field.name];
      if (value === undefined) throw new Error("missing-field");
      if (value === "" && !field.required) return [];
      return [[field.name, field.input === "number" ? integer(value) : value]];
    }));
  }
  if (typeof raw !== "string") throw new Error("invalid-scalar");
  if (leaf.input === "number") return integer(raw);
  if (leaf.input === "boolean") {
    if (raw !== "true" && raw !== "false") throw new Error("invalid-boolean");
    return raw === "true";
  }
  if (leaf.input === "models") return raw.split("\n");
  return raw;
}
export function draftError(leaf: EditableSettingsLeafWire, operation: SettingsDraftOperation): string | undefined {
  if (operation.kind === "clear") return undefined;
  try {
    const value = valueFromSettingInput(leaf, operation.raw);
    if (!SettingsPatchSchema.safeParse({ [leaf.path]: { set: value } }).success) throw new Error("invalid-value");
    return undefined;
  } catch {
    if (leaf.input === "number") return `Enter a whole number of at least ${String(leaf.minimum)}.`;
    if (leaf.input === "date") return "Enter a date as M/D/YYYY or MM/DD/YYYY.";
    if (leaf.input === "models") return "Enter one model per line, in order; no blank lines, spaces or commas.";
    if (leaf.input === "object") return "Check the fields; required fields and numeric limits must all be valid.";
    if (leaf.input === "path") return "Enter an absolute path.";
    if (leaf.input === "url") return "Enter a valid URL.";
    return "Enter a valid value.";
  }
}
export function settingsLeaves(document: EditableSettingsWire, added: readonly EditableSettingsLeafWire[] = []): readonly EditableSettingsLeafWire[] {
  const served = document.sections.flatMap(section => section.leaves);
  return [...served, ...added.filter(leaf => !served.some(current => current.path === leaf.path))];
}
export function coupledSettingsLeaves(leaf: EditableSettingsLeafWire, leaves: readonly EditableSettingsLeafWire[]): readonly EditableSettingsLeafWire[] {
  const prefix = leaf.path.startsWith("display.") ? "display." : leaf.path.startsWith("annualDates.") ? `${leaf.path.split(".").slice(0, 2).join(".")}.` : undefined;
  return prefix === undefined ? [leaf] : leaves.filter(candidate => candidate.path.startsWith(prefix));
}
export function patchFromSettingsDraft(leaves: readonly EditableSettingsLeafWire[], draft: SettingsDraft): SettingsPatch {
  const patch = Object.fromEntries(Object.entries(draft).map(([path, operation]) => {
    const leaf = leaves.find(candidate => candidate.path === path);
    if (leaf === undefined) throw new Error("settings-draft-path-not-served");
    return [path, operation.kind === "clear" ? { clear: true } : { set: valueFromSettingInput(leaf, operation.raw) }];
  }));
  return SettingsPatchSchema.parse(patch);
}
export function ordinaryReadbackConfirms(document: EditableSettingsWire, patch: SettingsPatch): boolean {
  const leaves = settingsLeaves(document);
  return Object.entries(patch).every(([path, operation]) => {
    const leaf = leaves.find(candidate => candidate.path === path);
    if ("clear" in operation) return leaf === undefined ? path.startsWith("annualDates.") : leaf.settingsValue === undefined;
    return leaf !== undefined && leaf.settingsValue !== undefined && canonicalJsonStringify(leaf.settingsValue) === canonicalJsonStringify(operation.set);
  });
}
export function fiscalYearLeaves(document: EditableSettingsWire, year: string): readonly EditableSettingsLeafWire[] {
  if (!new RegExp(document.fiscalYearTemplate.keyPattern, "u").test(year)) throw new Error("invalid-fiscal-year");
  const leaves = document.fiscalYearTemplate.leaves.map(leaf => ({ ...leaf, path: leaf.path.replace("*", year), label: leaf.label.replace("*", year) }));
  if (leaves.some(leaf => document.sections.some(section => section.leaves.some(current => current.path === leaf.path)))) throw new Error("fiscal-year-exists");
  return leaves;
}
