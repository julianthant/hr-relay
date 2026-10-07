import { canonicalJsonStringify } from "../../rules/validation/canonical-json.js";
import { SettingsPatchSchema, type SettingsPatch } from "../../models/config/settings.js";
import type { EditableSettingsLeafWire, EditableSettingsWire, EditorValue } from "../../models/dashboard/settings-editor.js";
import { timeoutInput, timeoutSetting, timeoutValue } from "./settings-timeouts-model.js";
import { performanceSectionGroups } from "./settings-performance-model.js";

export type SettingsDraftInput = string | Readonly<Record<string, string>>;
export type SettingsDraftOperation = { readonly kind: "set"; readonly raw: SettingsDraftInput; readonly companion?: true } | { readonly kind: "clear" };
export type SettingsDraft = Readonly<Record<string, SettingsDraftOperation>>;
export function formatSetting(value: EditorValue | undefined): string {
  if (value === undefined) return "not set";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}
export function settingInput(leaf: EditableSettingsLeafWire, value = leaf.effectiveValue): SettingsDraftInput {
  if (leaf.input === "object") {
    if (leaf.control.input !== "object") throw new Error("settings-control-mismatch");
    return Object.fromEntries(leaf.control.fields.map(field => [field.name, value !== undefined && typeof value === "object" && !Array.isArray(value) && value[field.name] !== undefined ? String(value[field.name]) : ""]));
  }
  if (leaf.input === "models") return Array.isArray(value) ? value.join("\n") : "";
  if (value !== undefined && typeof value === "object") throw new Error("settings-scalar-value-invalid");
  if (timeoutSetting(leaf.path) !== undefined && value !== undefined) {
    if (typeof value !== "number") throw new Error("settings-timeout-value-invalid");
    return timeoutInput(leaf, value);
  }
  return value === undefined ? "" : String(value);
}
export function settingsSectionGroups(sectionId: string, leaves: readonly EditableSettingsLeafWire[]): readonly { title: string; leaves: readonly EditableSettingsLeafWire[] }[] {
  if (sectionId === "performance") return performanceSectionGroups(leaves);
  const groupTitle = (path: string): string => {
    if (sectionId === "general") return path.startsWith("features.") ? "Features" : path.startsWith("annualDates.") ? "Employment" : path.startsWith("display.") ? "Display" : "Everyday operation";
    if (sectionId === "providers") return path.endsWith(".models") ? "Model order" : "Provider budgets";
    return { paths: "Working locations", routes: "System destinations" }[sectionId] ?? "Settings";
  };
  const groups = new Map<string, EditableSettingsLeafWire[]>();
  for (const leaf of leaves) {
    const title = groupTitle(leaf.path);
    const group = groups.get(title) ?? [];
    group.push(leaf);
    groups.set(title, group);
  }
  return [...groups].map(([title, groupedLeaves]) => ({ title, leaves: groupedLeaves }));
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
  if (timeoutSetting(leaf.path) !== undefined) return timeoutValue(leaf, raw);
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
    const timeout = timeoutSetting(leaf.path);
    if (timeout !== undefined) return `Enter a positive duration that resolves to a whole ${timeout.storedUnit === "milliseconds" ? "millisecond" : "second"}.`;
    if (leaf.input === "number") return `Enter a whole number of at least ${String(leaf.minimum)}.`;
    if (leaf.input === "date") return "Enter a date as M/D/YYYY or MM/DD/YYYY.";
    if (leaf.input === "models") return "Enter one model per line, in order; no blank lines, spaces or commas.";
    if (leaf.input === "object") return "Check the fields; required fields and numeric limits must all be valid.";
    if (leaf.input === "path") return "Enter an absolute path.";
    if (leaf.input === "url") return "Enter a valid URL.";
    return "Enter a valid value.";
  }
}
export function settingsLeaves(document: EditableSettingsWire): readonly EditableSettingsLeafWire[] {
  return document.sections.flatMap(section => section.leaves);
}
export function coupledSettingsLeaves(leaf: EditableSettingsLeafWire, leaves: readonly EditableSettingsLeafWire[]): readonly EditableSettingsLeafWire[] {
  const prefix = leaf.path.startsWith("display.") ? "display." : undefined;
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
