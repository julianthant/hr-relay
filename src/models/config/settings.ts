import { z } from "zod";
import { canonicalJsonStringify } from "../../rules/validation/canonical-json.js";
import { CommandIdSchema, FingerprintSchema, PositiveIntSchema } from "../../rules/identity/ids.js";
import { deepFreeze } from "../../rules/validation/immutability.js";
import { deriveSchemaHash } from "../validation/schema-bound-value.js";
import { sha256Hex } from "../../rules/validation/sha256.js";
import { SETTINGS_CATALOG } from "./catalog.js";
import {
  CONFIG_ROUTE_SCHEMAS,
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

/** Schema-checked mutable staging object; final values still pass the generated override schema. */
const MutableSettingsObjectSchema = z.record(z.string(), z.unknown());
type MutableSettingsObject = z.infer<typeof MutableSettingsObjectSchema>;

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

export function isRetiredSettingsPath(path: string): boolean {
  const parts = path.split(".");
  return path === "paths.duoCredential" || parts.length === 3 && parts[0] === "urls" && parts[2] === "test"
    && Object.hasOwn(CONFIG_ROUTE_SCHEMAS, parts[1] ?? "");
}

/** Old journal commands must remain parseable; the application boundary refuses these paths. */
export function containsRetiredSettingsPatch(patch: SettingsPatch): boolean {
  return Object.keys(patch).some(isRetiredSettingsPath);
}

function unwrappedSchema(schema: z.core.$ZodType): z.core.$ZodType {
  let current = schema;
  while (current instanceof z.ZodOptional
    || current instanceof z.ZodDefault
    || current instanceof z.ZodReadonly) {
    current = current.unwrap();
  }
  return current;
}

/** Resolve the executable schema behind one catalogued ordinary leaf. */
function ordinarySettingsLeafSchema(path: string): z.core.$ZodType | undefined {
  let schema: z.core.$ZodType = EditableSettingsOverrideSchema;
  for (const part of path.split(".")) {
    schema = unwrappedSchema(schema);
    if (schema instanceof z.ZodObject) {
      const next: unknown = Reflect.get(schema.shape, part);
      if (!(next instanceof z.ZodType)) return undefined;
      schema = next;
      continue;
    }
    if (schema instanceof z.ZodRecord) {
      if (!z.safeParse(schema.keyType, part).success) return undefined;
      schema = schema.valueType;
      continue;
    }
    return undefined;
  }
  return unwrappedSchema(schema);
}

function setNestedLeaf(target: MutableSettingsObject, path: string, value: unknown): void {
  const parts = path.split(".");
  let cursor = target;
  for (const part of parts.slice(0, -1)) {
    const existing = cursor[part];
    let nested: MutableSettingsObject;
    if (existing === undefined) {
      nested = MutableSettingsObjectSchema.parse({});
    } else {
      const parsed = MutableSettingsObjectSchema.safeParse(existing);
      if (!parsed.success) {
        throw new Error(`settings path ${path} collides with a non-object member`);
      }
      nested = parsed.data;
    }
    cursor[part] = nested;
    cursor = nested;
  }
  const leaf = parts.at(-1);
  if (leaf === undefined) throw new Error("settings path cannot be empty");
  cursor[leaf] = value;
}

function deleteNestedLeaf(target: MutableSettingsObject, path: string): void {
  const parts = path.split(".");
  const parents: Array<{ readonly value: MutableSettingsObject; readonly key: string }> = [];
  let cursor = target;
  for (const part of parts.slice(0, -1)) {
    const next = cursor[part];
    const nested = MutableSettingsObjectSchema.safeParse(next);
    if (!nested.success) return;
    cursor[part] = nested.data;
    parents.push({ value: cursor, key: part });
    cursor = nested.data;
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
    for (const [path, operation] of Object.entries(patch)) {
      if (!isOrdinarySettingsPath(path) && !isRetiredSettingsPath(path)) {
        context.addIssue({ code: "custom", path: [path], message: `settings path ${path} is not an editable ordinary setting` });
        continue;
      }
      if ("set" in operation) {
        const leafSchema = ordinarySettingsLeafSchema(path);
        if (leafSchema === undefined || !z.safeParse(leafSchema, operation.set).success) {
          context.addIssue({ code: "custom", path: [path], message: `settings path ${path} has an invalid value` });
        }
      }
    }
  });

export function deriveRawSettingsPatchFingerprint(patch: unknown): string {
  return FingerprintSchema.parse(sha256Hex(
    `hrauto:settings-patch:v2\0${canonicalJsonStringify(patch)}`,
  ));
}

export function deriveSettingsPatchFingerprint(patch: unknown): string {
  return deriveRawSettingsPatchFingerprint(SettingsPatchSchema.parse(patch));
}

export function derivePersistedSettingsFingerprint(settings: unknown): string {
  const parsed = EditableSettingsOverrideSchema.parse(settings);
  return FingerprintSchema.parse(sha256Hex(
    `hrauto:persisted-settings:v1\0${canonicalJsonStringify(parsed)}`,
  ));
}

/** The one durable `config/settings.json` envelope: revision and both identities live beside the sparse overrides, so a restart cannot invent any of them. */
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

/** The complete caller-actionable settings refusal vocabulary. */
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

/** Value projection used by runtime identities; journal metadata stays in SQLite. */
export const SettingsRecordSchema = z.strictObject({
  revision: PositiveIntSchema,
  settingsSchemaHash: FingerprintSchema,
  settingsFingerprint: FingerprintSchema,
  settings: EditableSettingsOverrideSchema,
}).superRefine((record, context) => {
  if (record.settingsSchemaHash !== SETTINGS_SCHEMA_HASH
    || record.settingsFingerprint !== derivePersistedSettingsFingerprint(record.settings)
    || (record.revision === 1 && record.settingsFingerprint !== derivePersistedSettingsFingerprint({}))) {
    context.addIssue({ code: "custom", message: "settings value identity is invalid" });
  }
});

export function settingsRuntimeIdentity(
  recordInput: unknown,
  configFingerprint: string,
): SettingsRuntimeIdentity {
  const record = SettingsRecordSchema.parse(recordInput);
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
  if (containsRetiredSettingsPatch(patch)) throw new Error("retired settings cannot be edited");
  const candidate = MutableSettingsObjectSchema.parse(structuredClone(current));
  const existingUrls = MutableSettingsObjectSchema.safeParse(candidate.urls);
  if (existingUrls.success) {
    for (const [system, value] of Object.entries(existingUrls.data)) {
      const endpoints = MutableSettingsObjectSchema.safeParse(value);
      if (endpoints.success) {
        delete endpoints.data.test;
        existingUrls.data[system] = endpoints.data;
      }
    }
    candidate.urls = existingUrls.data;
  }
  for (const [path, operation] of Object.entries(patch)) {
    if ("set" in operation) setNestedLeaf(candidate, path, operation.set);
    else deleteNestedLeaf(candidate, path);
  }
  return EditableSettingsOverrideSchema.parse(candidate);
}
