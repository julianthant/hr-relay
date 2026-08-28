/**
 * The closed browser projection for Settings editing. The server owns the
 * inventory: the browser receives leaves, provenance and editability, but
 * never infers a setting name or a default of its own.
 */
import { z } from "zod";
import { SettingsRuntimeStatusSchema } from "../config/settings.js";
import { ConfigProvenanceSchema } from "../config/resolve.js";
import { FingerprintSchema, PositiveIntSchema } from "../ids.js";

export const EditableSettingsSectionIdSchema = z.enum(["general", "display", "performance", "paths"]);
export type EditableSettingsSectionId = z.infer<typeof EditableSettingsSectionIdSchema>;

export const EditableSettingsPathSchema = z.enum([
  "actor.label",
  "display.screenWidth",
  "display.screenHeight",
  "ocr.pageConcurrency",
  "ocr.maxValidationRetries",
  "timeouts.duoApprovalSeconds",
  "concurrency.defaultWorkers",
  "paths.reportsDir",
]);
export type EditableSettingsPath = z.infer<typeof EditableSettingsPathSchema>;

const TextLeafSchema = z.strictObject({
  path: EditableSettingsPathSchema,
  input: z.literal("text"),
  label: z.string().min(1),
  description: z.string().min(1),
  effectiveValue: z.string().min(1),
  defaultValue: z.string().min(1),
  settingsValue: z.string().min(1).optional(),
  source: ConfigProvenanceSchema,
  environmentVariable: z.string().regex(/^[A-Z][A-Z0-9_]*$/).optional(),
  editable: z.boolean(),
  hazard: z.string().min(1).optional(),
});

const NumberLeafSchema = z.strictObject({
  path: EditableSettingsPathSchema,
  input: z.literal("number"),
  label: z.string().min(1),
  description: z.string().min(1),
  effectiveValue: z.number().int().nonnegative(),
  defaultValue: z.number().int().nonnegative(),
  settingsValue: z.number().int().nonnegative().optional(),
  source: ConfigProvenanceSchema,
  environmentVariable: z.string().regex(/^[A-Z][A-Z0-9_]*$/).optional(),
  editable: z.boolean(),
  minimum: z.number().int().nonnegative(),
  unit: z.string().min(1).optional(),
  hazard: z.string().min(1).optional(),
});

export const EditableSettingsLeafWireSchema = z.discriminatedUnion("input", [TextLeafSchema, NumberLeafSchema]).superRefine((leaf, context) => {
  if (leaf.source === "env" && leaf.environmentVariable === undefined) {
    context.addIssue({ code: "custom", path: ["environmentVariable"], message: "environment-owned leaf must name its environment variable" });
  }
  if (leaf.source !== "env" && leaf.environmentVariable !== undefined) {
    context.addIssue({ code: "custom", path: ["environmentVariable"], message: "only an environment-owned leaf may name an environment variable" });
  }
  if (leaf.editable !== (leaf.source !== "env")) {
    context.addIssue({ code: "custom", path: ["editable"], message: "environment-owned values are not editable from Settings" });
  }
  if (leaf.source === "settings" && leaf.settingsValue === undefined) {
    context.addIssue({ code: "custom", path: ["settingsValue"], message: "settings provenance requires the persisted settings value" });
  }
});
export type EditableSettingsLeafWire = z.infer<typeof EditableSettingsLeafWireSchema>;

export const EditableSettingsSectionWireSchema = z.strictObject({
  id: EditableSettingsSectionIdSchema,
  label: z.string().min(1),
  description: z.string().min(1),
  leaves: z.array(EditableSettingsLeafWireSchema).min(1),
});
export type EditableSettingsSectionWire = z.infer<typeof EditableSettingsSectionWireSchema>;

function duplicates(values: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    if (seen.has(value)) return true;
    seen.add(value);
    return false;
  });
}

export const EditableSettingsWireSchema = z.strictObject({
  revision: PositiveIntSchema,
  settingsSchemaHash: FingerprintSchema,
  settingsFingerprint: FingerprintSchema,
  /** The running process identity used by the strict preflight rerun command. */
  activeConfigFingerprint: FingerprintSchema,
  runtimeStatus: SettingsRuntimeStatusSchema,
  sections: z.array(EditableSettingsSectionWireSchema).min(1),
}).superRefine((document, context) => {
  const paths = document.sections.flatMap((section) => section.leaves.map((leaf) => leaf.path));
  const duplicatePaths = duplicates(paths);
  if (duplicatePaths.length > 0) {
    context.addIssue({ code: "custom", path: ["sections"], message: `editable settings inventory repeats ${duplicatePaths.join(", ")}` });
  }
  const expected = new Set(EditableSettingsPathSchema.options);
  const actual = new Set(paths);
  if (expected.size !== actual.size || [...expected].some((path) => !actual.has(path))) {
    context.addIssue({ code: "custom", path: ["sections"], message: "editable settings inventory does not match the closed server-owned leaf set" });
  }
});
export type EditableSettingsWire = z.infer<typeof EditableSettingsWireSchema>;
