import { SETTINGS_CATALOG } from "../../../src/models/config/catalog.js";
import { SettingsPatchSchema, type SettingsPatch } from "../../../src/models/config/settings.js";

/** Adapt persisted-settings-shaped test input into D331 leaf set operations. */
export function settingsSetOperations(settings: unknown): SettingsPatch {
  const existing = SettingsPatchSchema.safeParse(settings);
  if (existing.success) return existing.data;
  if (settings === null || Array.isArray(settings) || typeof settings !== "object") {
    throw new Error("settings fixture must be an object");
  }
  const operations: Record<string, { set: unknown }> = {};
  const walk = (value: unknown, path: string): void => {
    const catalogKey = path.replace(/^annualDates\.FY\d{4}\./u, "annualDates.*.");
    if (SETTINGS_CATALOG.some((row) => row.key === catalogKey && row.sourceClass === "ordinary-settings")) {
      operations[path] = { set: value };
      return;
    }
    if (value === null || Array.isArray(value) || typeof value !== "object") {
      operations[path] = { set: value };
      return;
    }
    for (const [key, nested] of Object.entries(value)) {
      walk(nested, path.length === 0 ? key : `${path}.${key}`);
    }
  };
  walk(settings, "");
  delete operations[""];
  return SettingsPatchSchema.parse(operations);
}
