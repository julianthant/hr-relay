import { z } from "zod";
import { canonicalJsonStringify } from "../canonical-json.js";
import { CommandIdSchema, FingerprintSchema, PositiveIntSchema } from "../ids.js";
import { deepFreeze } from "../immutability.js";
import { deriveSchemaHash } from "../schema-bound-value.js";
import { sha256Hex } from "../sha256.js";
import { SETTINGS_CATALOG } from "./catalog.js";
import {
  EditableSettingsOverrideSchema,
  type EditableSettingsOverride,
} from "./schema.js";

/** The exact settings-patch schema this build accepts at the command boundary. */
export const SETTINGS_SCHEMA_HASH = deriveSchemaHash(EditableSettingsOverrideSchema, "input");
/** Existing editor consumers share the same closed command schema identity. */
export const CURRENT_SETTINGS_SCHEMA_HASH = SETTINGS_SCHEMA_HASH;

export const SettingsLeafOperationSchema = z.union([
  z.strictObject({ set: z.unknown() }),
  z.strictObject({ clear: z.literal(true) }),
]);

function catalogKeyForPath(path: string): string {
  const parts = path.split(".");
  if (parts[0] === "annualDates" && parts.length === 3 && /^FY\d{4}$/u.test(parts[1] ?? "")) {
    return `annualDates.*.${String(parts[2])}`;
  }
  return path;
}

function isOrdinarySettingsPath(path: string): boolean {
  const key = catalogKeyForPath(path);
  return SETTINGS_CATALOG.some((row) => row.key === key && row.sourceClass === "ordinary-settings");
}

function setNestedLeaf(target: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".");
  let cursor = target;
  for (const part of parts.slice(0, -1)) {
    const existing = cursor[part];
    if (existing === undefined) {
      cursor[part] = {};
    } else if (existing === null || Array.isArray(existing) || typeof existing !== "object") {
      throw new Error(`settings path ${path} collides with a non-object member`);
    }
    cursor = cursor[part] as Record<string, unknown>;
  }
  const leaf = parts.at(-1);
  if (leaf === undefined) throw new Error("settings path cannot be empty");
  cursor[leaf] = value;
}

function deleteNestedLeaf(target: Record<string, unknown>, path: string): void {
  const parts = path.split(".");
  const parents: Array<{ readonly value: Record<string, unknown>; readonly key: string }> = [];
  let cursor = target;
  for (const part of parts.slice(0, -1)) {
    const next = cursor[part];
    if (next === null || Array.isArray(next) || typeof next !== "object") return;
    parents.push({ value: cursor, key: part });
    cursor = next as Record<string, unknown>;
  }
  const leaf = parts.at(-1);
  if (leaf === undefined) return;
  delete cursor[leaf];
  for (const parent of parents.reverse()) {
    const child = parent.value[parent.key];
    if (child !== null && !Array.isArray(child) && typeof child === "object"
      && Object.keys(child).length === 0) {
      delete parent.value[parent.key];
    }
  }
}

export const SettingsPatchSchema = z.record(z.string().min(1), SettingsLeafOperationSchema)
  .refine((patch) => Object.keys(patch).length > 0, "settings patch must contain at least one leaf operation")
  .superRefine((patch, context) => {
    const setValues: Record<string, unknown> = {};
    for (const [path, operation] of Object.entries(patch)) {
      if (!isOrdinarySettingsPath(path)) {
        context.addIssue({ code: "custom", path: [path], message: `settings path ${path} is not an editable ordinary setting` });
        continue;
      }
      if ("set" in operation) setNestedLeaf(setValues, path, operation.set);
    }
    const displayPaths = ["display.screenWidth", "display.screenHeight"] as const;
    if (displayPaths.some((path) => Object.hasOwn(patch, path))
      && !displayPaths.every((path) => Object.hasOwn(patch, path))) {
      context.addIssue({ code: "custom", path: ["display"], message: "display updates must include both screenWidth and screenHeight operations" });
    }
    if (Object.keys(setValues).length > 0) {
      const parsed = EditableSettingsOverrideSchema.safeParse(setValues);
      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          context.addIssue({ ...issue, path: issue.path.map(String) });
        }
      }
    }
  });

export function deriveSettingsPatchFingerprint(patch: unknown): string {
  const parsed = SettingsPatchSchema.parse(patch);
  return FingerprintSchema.parse(sha256Hex(
    `hrauto:settings-patch:v2\0${canonicalJsonStringify(parsed)}`,
  ));
}

export function derivePersistedSettingsFingerprint(settings: unknown): string {
  const parsed = EditableSettingsOverrideSchema.parse(settings);
  return FingerprintSchema.parse(sha256Hex(
    `hrauto:persisted-settings:v1\0${canonicalJsonStringify(parsed)}`,
  ));
}

/**
 * The one durable `config/settings.json` envelope. Revision and both identities
 * live beside the sparse overrides so a restart cannot invent any of them.
 */
export const SettingsFileRecordSchema = z.strictObject({
  revision: PositiveIntSchema,
  settingsSchemaHash: FingerprintSchema,
  settingsFingerprint: FingerprintSchema,
  settings: EditableSettingsOverrideSchema,
  lastApplied: z.strictObject({
    commandId: CommandIdSchema,
    commandFingerprint: FingerprintSchema,
    expectedRevision: PositiveIntSchema,
    settingsSchemaHash: FingerprintSchema,
    patchFingerprint: FingerprintSchema,
  }).optional(),
}).superRefine((record, context) => {
  if (record.settingsSchemaHash !== SETTINGS_SCHEMA_HASH) {
    context.addIssue({
      code: "custom",
      path: ["settingsSchemaHash"],
      message: `persisted settings schema ${record.settingsSchemaHash} does not match this build's ${SETTINGS_SCHEMA_HASH}`,
    });
  }
  const expectedFingerprint = derivePersistedSettingsFingerprint(record.settings);
  if (record.settingsFingerprint !== expectedFingerprint) {
    context.addIssue({
      code: "custom",
      path: ["settingsFingerprint"],
      message: `persisted settings fingerprint ${record.settingsFingerprint} does not match its strict settings value`,
    });
  }
  if (record.revision === 1) {
    if (record.lastApplied !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["lastApplied"],
        message: "settings revision 1 is the never-applied baseline and cannot name a last command",
      });
    }
    if (record.settingsFingerprint !== derivePersistedSettingsFingerprint({})) {
      context.addIssue({
        code: "custom",
        path: ["settings"],
        message: "settings revision 1 is the never-applied baseline and must contain empty overrides",
      });
    }
    return;
  }
  if (record.lastApplied === undefined) {
    context.addIssue({
      code: "custom",
      path: ["lastApplied"],
      message: `settings revision ${String(record.revision)} must name the command that produced it`,
    });
    return;
  }
  if (record.lastApplied.expectedRevision + 1 !== record.revision) {
    context.addIssue({
      code: "custom",
      path: ["lastApplied", "expectedRevision"],
      message: `last applied settings revision ${String(record.lastApplied.expectedRevision)} must advance exactly to ${String(record.revision)}`,
    });
  }
  if (record.lastApplied.settingsSchemaHash !== record.settingsSchemaHash) {
    context.addIssue({
      code: "custom",
      path: ["lastApplied", "settingsSchemaHash"],
      message: "last applied settings schema must equal the persisted record schema",
    });
  }
});

export const SettingsApplyInputSchema = z.strictObject({
  commandId: CommandIdSchema,
  commandFingerprint: FingerprintSchema,
  expectedRevision: PositiveIntSchema,
  settingsSchemaHash: FingerprintSchema,
  patchFingerprint: FingerprintSchema,
  patch: SettingsPatchSchema,
});

/** D331.5's complete caller-actionable settings refusal vocabulary. */
export const SettingsApplyRejectionCodeSchema = z.enum([
  "schema-mismatch",
  "patch-fingerprint-mismatch",
  "envelope-fingerprint-mismatch",
  "not-editable",
  "invalid-value",
  "cross-field-invalid",
  "document-too-large",
  "authority-unjournaled",
  "authority-uncertain",
  "directory-integrity",
  "lock-unavailable",
  "command-divergent",
  "write-id-reused",
]);

export const SettingsApplyRefusalSchema = z.discriminatedUnion("state", [
  z.strictObject({
    state: z.literal("conflict"),
    currentRevision: PositiveIntSchema,
    message: z.string().min(1),
  }),
  z.strictObject({
    state: z.literal("rejected"),
    code: SettingsApplyRejectionCodeSchema,
    message: z.string().min(1),
  }),
]);

export type SettingsFileRecord = z.infer<typeof SettingsFileRecordSchema>;
export type SettingsApplyInput = z.infer<typeof SettingsApplyInputSchema>;
export type SettingsApplyRejectionCode = z.infer<typeof SettingsApplyRejectionCodeSchema>;
export type SettingsApplyRefusal = z.infer<typeof SettingsApplyRefusalSchema>;
export type SettingsPatch = z.infer<typeof SettingsPatchSchema>;

export const SettingsRuntimeIdentitySchema = z.strictObject({
  settingsRevision: PositiveIntSchema,
  settingsSchemaHash: FingerprintSchema,
  settingsFingerprint: FingerprintSchema,
  configFingerprint: FingerprintSchema,
});
export type SettingsRuntimeIdentity = z.infer<typeof SettingsRuntimeIdentitySchema>;

export const SettingsRuntimeStatusSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("current"), identity: SettingsRuntimeIdentitySchema }),
  z.strictObject({
    state: z.literal("restart-required"),
    active: SettingsRuntimeIdentitySchema,
    persisted: SettingsRuntimeIdentitySchema,
  }),
]);
export type SettingsRuntimeStatus = z.infer<typeof SettingsRuntimeStatusSchema>;

export function settingsRuntimeIdentity(
  recordInput: unknown,
  configFingerprint: string,
): SettingsRuntimeIdentity {
  const record = SettingsFileRecordSchema.parse(recordInput);
  return deepFreeze(SettingsRuntimeIdentitySchema.parse({
    settingsRevision: record.revision,
    settingsSchemaHash: record.settingsSchemaHash,
    settingsFingerprint: record.settingsFingerprint,
    configFingerprint,
  }));
}

export function initialSettingsFileRecord(): SettingsFileRecord {
  const settings = EditableSettingsOverrideSchema.parse({});
  return deepFreeze(SettingsFileRecordSchema.parse({
    revision: 1,
    settingsSchemaHash: SETTINGS_SCHEMA_HASH,
    settingsFingerprint: derivePersistedSettingsFingerprint(settings),
    settings,
  }));
}

/** Leaf operations preserve untouched leaves and make omission/return-to-default explicit. */
export function mergeSettingsPatch(
  current: EditableSettingsOverride,
  patchInput: SettingsPatch,
): EditableSettingsOverride {
  const patch = SettingsPatchSchema.parse(patchInput);
  const candidate = structuredClone(current) as Record<string, unknown>;
  for (const [path, operation] of Object.entries(patch)) {
    if ("set" in operation) setNestedLeaf(candidate, path, operation.set);
    else deleteNestedLeaf(candidate, path);
  }
  return EditableSettingsOverrideSchema.parse(candidate);
}
