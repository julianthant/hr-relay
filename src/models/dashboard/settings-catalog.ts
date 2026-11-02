/** Settings-only presentation contracts, derived from the canonical catalog and executable schemas. */
import { z } from "zod";
import { canonicalJsonStringify } from "../../rules/validation/canonical-json.js";
import { SETTINGS_CATALOG, SettingsCatalogKeySchema, settingsCatalogRow, type SettingsCatalogRow } from "../config/catalog.js";
import { ConfigSchema, EditableSettingsOverrideSchema } from "../config/schema.js";

export const EditableSettingsSectionIdSchema = z.enum(["general", "display", "performance", "paths", "routes", "annual-dates", "providers"]);
export type EditableSettingsSectionId = z.infer<typeof EditableSettingsSectionIdSchema>;
export const EditableSettingsPathSchema = z.enum(SETTINGS_CATALOG.filter(row => row.sourceClass === "ordinary-settings").map(row => row.key));
export const EditableSettingsInstancePathSchema = z.string().min(1);
export type EditableSettingsPath = z.infer<typeof EditableSettingsInstancePathSchema>;

export function catalogKeyForEditorPath(path: string): string {
  return path.replace(/^annualDates\.FY\d{4}\./u, "annualDates.*.");
}
export function settingsSectionFor(key: string): EditableSettingsSectionId {
  if (key.startsWith("display.")) return "display";
  if (key.startsWith("paths.")) return "paths";
  if (key.startsWith("urls.")) return "routes";
  if (key.startsWith("annualDates.")) return "annual-dates";
  if (key.startsWith("providers.")) return "providers";
  if (key.startsWith("actor.") || key.startsWith("features.") || key === "browser.headless") return "general";
  return "performance";
}

const ScalarControlSchema = z.strictObject({
  input: z.enum(["text", "number", "boolean", "date", "path", "url"]),
  minimum: z.number().int().nonnegative().optional(),
});
export const SettingsControlSchema = z.union([
  ScalarControlSchema,
  z.strictObject({ input: z.literal("object"), fields: z.array(ScalarControlSchema.extend({ name: z.string().min(1), required: z.boolean() })).min(1) }),
  z.strictObject({ input: z.literal("models") }),
]);
export type SettingsControl = z.infer<typeof SettingsControlSchema>;

function unwrap(schema: z.core.$ZodType): z.core.$ZodType {
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodDefault || schema instanceof z.ZodReadonly) return unwrap(schema.unwrap());
  return schema;
}
/** Introspection selects widgets only; SettingsPatchSchema remains the value validator. */
function schemaAtPath(root: z.core.$ZodType, path: string): z.core.$ZodType {
  let schema: z.core.$ZodType = root;
  for (const part of path.split(".")) {
    schema = unwrap(schema);
    if (schema instanceof z.ZodObject) {
      const next: unknown = Reflect.get(schema.shape, part);
      if (!(next instanceof z.ZodType)) throw new Error("settings-editor-schema-missing");
      schema = next;
    } else if (schema instanceof z.ZodRecord && (part === "*" || z.safeParse(schema.keyType, part).success)) {
      schema = schema.valueType;
    } else throw new Error("settings-editor-schema-missing");
  }
  return unwrap(schema);
}
export function editorLeafSchema(path: string): z.core.$ZodType { return schemaAtPath(EditableSettingsOverrideSchema, path); }
export function deploymentLeafSchema(path: string): z.core.$ZodType { return schemaAtPath(ConfigSchema, path); }
function scalarControl(schema: z.core.$ZodType, key: string): z.infer<typeof ScalarControlSchema> {
  const value = unwrap(schema);
  if (value instanceof z.ZodNumber) return { input: "number", minimum: value.safeParse(0).success ? 0 : 1 };
  if (value instanceof z.ZodBoolean) return { input: "boolean" };
  if (value instanceof z.ZodString || value instanceof z.ZodURL) return { input: key.startsWith("annualDates.") ? "date" : key.startsWith("paths.") ? "path" : key.startsWith("urls.") ? "url" : "text" };
  throw new Error("settings-editor-control-missing");
}
export function settingsControlFor(key: string): SettingsControl {
  const schema = editorLeafSchema(key);
  if (schema instanceof z.ZodObject) {
    return SettingsControlSchema.parse({ input: "object", fields: Object.entries(schema.shape).map(([name, field]) => {
      if (!(field instanceof z.ZodType)) throw new Error("settings-editor-field-schema-missing");
      return { name, required: !field.safeParse(undefined).success, ...scalarControl(field, key) };
    }) });
  }
  if (schema instanceof z.ZodArray) return { input: "models" };
  return scalarControl(schema, key);
}

export const SettingsCatalogEntryWireSchema = z.strictObject({
  key: SettingsCatalogKeySchema,
  schema: z.string().min(1),
  sourceClass: z.enum(["ordinary-settings", "protected-store", "derived-host", "runtime-isolation"]),
  editability: z.enum(["operator", "deployment", "derived", "machine"]),
  sensitivity: z.enum(["ordinary", "protected-identifier", "protected-secret", "derived-host"]),
  activationScope: z.enum(["new-runs", "next-idle", "next-use", "process"]),
}).superRefine((row, context) => {
  if (canonicalJsonStringify(row) !== canonicalJsonStringify(settingsCatalogEntry(settingsCatalogRow(row.key)))) {
    context.addIssue({ code: "custom", message: "settings catalog classification mismatch" });
  }
});
export function settingsCatalogEntry(row: SettingsCatalogRow) {
  return { key: row.key, schema: row.schema, sourceClass: row.sourceClass, editability: row.editability,
    sensitivity: row.sensitivity, activationScope: row.sourceClass === "ordinary-settings"
      ? row.key.startsWith("daemon.") ? "next-idle" as const : "new-runs" as const
      : row.sourceClass === "protected-store" ? "next-use" as const : "process" as const };
}
export const SettingsCatalogWireSchema = z.array(SettingsCatalogEntryWireSchema).length(SETTINGS_CATALOG.length).superRefine((rows, context) => {
  if (new Set(rows.map(row => row.key)).size !== SETTINGS_CATALOG.length) context.addIssue({ code: "custom", message: "settings catalog membership mismatch" });
});
