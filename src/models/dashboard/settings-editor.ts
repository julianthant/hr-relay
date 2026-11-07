/** Complete Settings projection; auxiliary authorities remain independent. */
import { z } from "zod";
import { canonicalJsonStringify } from "../../rules/validation/canonical-json.js";
import { SETTINGS_CATALOG } from "../config/catalog.js";
import { isRetiredSettingsPath, SettingsPatchSchema, SettingsRuntimeStatusSchema } from "../config/settings.js";
import { HostConfigFactsSchema } from "../config/host-display.js";
import { PROTECTED_SETTINGS_SCHEMA_HASH, ProtectedSettingsNameSchema, ProtectedSettingsReadbackSchema, ProtectedStoreEntriesSchema } from "../config/protected-settings.js";
import { FingerprintSchema, PositiveIntSchema } from "../../rules/identity/ids.js";
import { EditableSettingsSectionIdSchema, SettingsCatalogWireSchema, SettingsControlSchema, deploymentLeafSchema, catalogKeyForEditorPath, settingsControlFor, settingsSectionFor } from "./settings-catalog.js";
export { EditableSettingsPathSchema, EditableSettingsSectionIdSchema } from "./settings-catalog.js";
export type { EditableSettingsPath, EditableSettingsSectionId } from "./settings-catalog.js";

const EditorValueSchema = z.union([z.string(), z.number().int(), z.boolean(), z.record(z.string(), z.union([z.string(), z.number().int(), z.boolean()])), z.array(z.string())]);
export type EditorValue = z.infer<typeof EditorValueSchema>;
export const EditableSettingsLeafWireSchema = z.strictObject({
  path: z.string().min(1),
  catalogKey: z.string().min(1),
  input: z.enum(["text", "number", "boolean", "date", "path", "url", "object", "models"]),
  control: SettingsControlSchema,
  label: z.string().min(1), description: z.string().min(1),
  effectiveValue: EditorValueSchema.optional(), activeValue: EditorValueSchema.optional(),
  defaultValue: EditorValueSchema.optional(), settingsValue: EditorValueSchema.optional(),
  source: z.enum(["settings", "default"]),
  editable: z.literal(true), validity: z.enum(["valid", "unset"]),
  sensitivity: z.literal("ordinary"), sourceClass: z.literal("ordinary-settings"),
  activationScope: z.enum(["new-runs", "next-idle"]),
  minimum: z.number().int().nonnegative().optional(), unit: z.string().min(1).optional(), hazard: z.string().min(1).optional(),
}).superRefine((leaf, context) => {
  const key = catalogKeyForEditorPath(leaf.path);
  const row = SETTINGS_CATALOG.find(candidate => candidate.key === key && candidate.sourceClass === "ordinary-settings");
  if (row === undefined || key !== leaf.catalogKey) {
    context.addIssue({ code: "custom", message: "settings leaf is not catalogued" }); return;
  }
  if (row.defaultKind !== "none" && (leaf.effectiveValue === undefined || leaf.defaultValue === undefined || leaf.activeValue === undefined)) context.addIssue({ code: "custom", message: "required settings value missing" });
  const control = settingsControlFor(key);
  if (canonicalJsonStringify(control) !== canonicalJsonStringify(leaf.control) || leaf.input !== control.input
    || leaf.minimum !== (control.input === "number" ? control.minimum : undefined)) {
    context.addIssue({ code: "custom", message: "settings input type mismatch" });
  }
  const valuePath = leaf.path.replace(".*.", ".FY2000.");
  for (const name of ["effectiveValue", "activeValue", "defaultValue", "settingsValue"] as const) {
    if (leaf[name] !== undefined && !SettingsPatchSchema.safeParse({ [valuePath]: { set: leaf[name] } }).success) {
      context.addIssue({ code: "custom", path: [name], message: "invalid settings value" });
    }
  }
  if ((leaf.source === "settings") !== (leaf.settingsValue !== undefined)
    || canonicalJsonStringify(leaf.effectiveValue ?? null) !== canonicalJsonStringify((leaf.source === "settings" ? leaf.settingsValue : leaf.defaultValue) ?? null)
    || leaf.validity !== (leaf.effectiveValue === undefined ? "unset" : "valid")
    || leaf.activationScope !== (key.startsWith("daemon.") ? "next-idle" : "new-runs")) {
    context.addIssue({ code: "custom", message: "settings value provenance mismatch" });
  }
});
export type EditableSettingsLeafWire = z.infer<typeof EditableSettingsLeafWireSchema>;
export const EditableSettingsSectionWireSchema = z.strictObject({
  id: EditableSettingsSectionIdSchema, label: z.string().min(1), description: z.string().min(1),
  leaves: z.array(EditableSettingsLeafWireSchema),
});
export type EditableSettingsSectionWire = z.infer<typeof EditableSettingsSectionWireSchema>;
const ProtectedRowSchema = z.strictObject({ name: ProtectedSettingsNameSchema, label: z.string().min(1), purpose: z.string().min(1), activationScope: z.literal("next-use") });
const ProtectedRowsSchema = z.array(ProtectedRowSchema).length(ProtectedSettingsNameSchema.options.length).superRefine((rows, context) => {
  if (new Set(rows.map(row => row.name)).size !== ProtectedSettingsNameSchema.options.length) context.addIssue({ code: "custom", message: "protected catalog membership mismatch" });
});
export const SettingsProtectedWireSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("available"), rows: ProtectedRowsSchema, protectedSchemaHash: z.literal(PROTECTED_SETTINGS_SCHEMA_HASH), readback: ProtectedSettingsReadbackSchema, entries: ProtectedStoreEntriesSchema }),
  z.strictObject({ state: z.literal("unknown"), rows: ProtectedRowsSchema, reason: z.literal("credential-store-unavailable") }),
]).superRefine((authority, context) => {
  if (authority.state !== "available") return;
  for (const name of ProtectedSettingsNameSchema.options) {
    const entry = authority.entries[name];
    const presence = authority.readback.entries[name];
    if ((entry === undefined) !== !presence.present
      || (entry !== undefined && presence.present
        && (entry.valueId !== presence.valueId || entry.updatedAt !== presence.updatedAt))) {
      context.addIssue({ code: "custom", path: ["entries", name], message: "credential value disagrees with readback" });
    }
  }
});
const DeploymentKeySchema = z.enum(SETTINGS_CATALOG.filter(row => row.sourceClass === "runtime-isolation").map(row => row.key));
export const EditableSettingsWireSchema = z.strictObject({
  revision: PositiveIntSchema, settingsSchemaHash: FingerprintSchema, settingsFingerprint: FingerprintSchema,
  activeConfigFingerprint: FingerprintSchema, runtimeStatus: SettingsRuntimeStatusSchema,
  catalog: SettingsCatalogWireSchema,
  sections: z.array(EditableSettingsSectionWireSchema).length(EditableSettingsSectionIdSchema.options.length),
  currentFiscalYear: PositiveIntSchema,
  protectedSettings: SettingsProtectedWireSchema,
  host: HostConfigFactsSchema,
  deployment: z.record(DeploymentKeySchema, EditorValueSchema),
}).superRefine((document, context) => {
  const issue = (message: string): void => context.addIssue({ code: "custom", message });
  const ids = document.sections.map(section => section.id);
  if (new Set(ids).size !== ids.length) issue(`editable settings inventory repeats section ${ids.find((id, index) => ids.indexOf(id) !== index) ?? "unknown"}`);
  const leaves = document.sections.flatMap(section => section.leaves);
  const keys = leaves.map(leaf => leaf.path);
  if (new Set(keys).size !== keys.length) issue("editable settings inventory repeats a path");
  const expected = SETTINGS_CATALOG.filter(row => row.sourceClass === "ordinary-settings" && !row.key.startsWith("annualDates.") && !isRetiredSettingsPath(row.key)).map(row => row.key);
  const currentJobEndDate = `annualDates.FY${String(document.currentFiscalYear)}.jobEndDate`;
  if (expected.some(key => !keys.includes(key)) || keys.filter(key => key.startsWith("annualDates.")).join("\0") !== currentJobEndDate
    || keys.some(key => !new Set<string>(expected).has(key) && key !== currentJobEndDate)) issue("editable settings inventory membership mismatch");
  for (const section of document.sections) for (const leaf of section.leaves) {
    if (settingsSectionFor(leaf.path) !== section.id) issue("editable setting is in the wrong section");
    if (document.runtimeStatus.state === "current" && canonicalJsonStringify(leaf.activeValue ?? null) !== canonicalJsonStringify(leaf.effectiveValue ?? null)) issue("current settings values disagree with active values");
  }
  for (const [key, value] of Object.entries(document.deployment)) if (!z.safeParse(deploymentLeafSchema(key), value).success) issue("invalid deployment fact type");
  const persisted = document.runtimeStatus.state === "current" ? document.runtimeStatus.identity : document.runtimeStatus.persisted;
  const active = document.runtimeStatus.state === "current" ? document.runtimeStatus.identity : document.runtimeStatus.active;
  if (document.revision !== persisted.settingsRevision || document.settingsSchemaHash !== persisted.settingsSchemaHash
    || document.settingsFingerprint !== persisted.settingsFingerprint || document.activeConfigFingerprint !== active.configFingerprint) issue("settings runtime identity mismatch");
});
export type EditableSettingsWire = z.infer<typeof EditableSettingsWireSchema>;
