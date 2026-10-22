import { z } from "zod";
import { CommandIdSchema, FingerprintSchema, IsoInstantSchema, PositiveIntSchema } from "../../rules/identity/ids.js";
import { deepFreeze } from "../../rules/validation/immutability.js";
import { deriveSchemaHash } from "../validation/schema-bound-value.js";

/** These schemas are shared by the writer and the accessor, with no coercion or trimming; test-target inputs are not protected Settings. */
export const ProtectedValueSchemas = Object.freeze({
  ucpathUserId: z.string().min(1).max(256),
  ucpathPassword: z.string().min(1).max(4096),
  timekeeperName: z.string().min(1).max(256),
  sharepointOnboardingRosterUrl: z.url().max(8192),
  activityPersonPseudonym: z.strictObject({
    keyHex: z.string().regex(/^[0-9a-f]{64}$/u),
    keyGeneration: z.string().regex(/^activity-person-[a-z0-9]+(?:-[a-z0-9]+)*$/u),
  }),
});

export const ProtectedSettingsNameSchema = z.strictObject(ProtectedValueSchemas).keyof();
export type ProtectedSettingsName = z.infer<typeof ProtectedSettingsNameSchema>;

function entry<Value extends z.ZodType>(value: Value) {
  return z.strictObject({ valueId: z.uuid(), value, updatedAt: IsoInstantSchema });
}

/** In-memory values retain this shape; authenticated disk ciphertext and its tag are not comparison surrogates. */
export const ProtectedStoreEntriesSchema = z.strictObject({
  ucpathUserId: entry(ProtectedValueSchemas.ucpathUserId).optional(),
  ucpathPassword: entry(ProtectedValueSchemas.ucpathPassword).optional(),
  timekeeperName: entry(ProtectedValueSchemas.timekeeperName).optional(),
  sharepointOnboardingRosterUrl: entry(ProtectedValueSchemas.sharepointOnboardingRosterUrl).optional(),
  activityPersonPseudonym: entry(ProtectedValueSchemas.activityPersonPseudonym).optional(),
});

function operation<Value extends z.ZodType>(value: Value) {
  return z.union([z.strictObject({ set: value }), z.strictObject({ clear: z.literal(true) })]).optional();
}

export const ProtectedSettingsPatchSchema = z.strictObject({
  ucpathUserId: operation(ProtectedValueSchemas.ucpathUserId),
  ucpathPassword: operation(ProtectedValueSchemas.ucpathPassword),
  timekeeperName: operation(ProtectedValueSchemas.timekeeperName),
  sharepointOnboardingRosterUrl: operation(ProtectedValueSchemas.sharepointOnboardingRosterUrl),
  activityPersonPseudonym: operation(ProtectedValueSchemas.activityPersonPseudonym),
});
export const CompleteProtectedSettingsPatchSchema = ProtectedSettingsPatchSchema.required();
export type CompleteProtectedSettingsPatch = z.infer<typeof CompleteProtectedSettingsPatchSchema>;
export const PROTECTED_SETTINGS_SCHEMA_HASH = deriveSchemaHash(ProtectedSettingsPatchSchema, "input");

export const PROTECTED_SETTINGS_SET_MARKER = "<set>" as const;

function markedOperation() {
  return z.union([
    z.strictObject({ set: z.literal(PROTECTED_SETTINGS_SET_MARKER) }),
    z.strictObject({ clear: z.literal(true) }),
  ]).optional();
}

/** The journal-safe form of a protected patch: the operation shape stays authenticated, and no submitted value or value-derived surrogate crosses. */
export const MarkedProtectedSettingsPatchSchema = z.strictObject({
  ucpathUserId: markedOperation(),
  ucpathPassword: markedOperation(),
  timekeeperName: markedOperation(),
  sharepointOnboardingRosterUrl: markedOperation(),
  activityPersonPseudonym: markedOperation(),
});
export type MarkedProtectedSettingsPatch = z.infer<typeof MarkedProtectedSettingsPatchSchema>;

export function markProtectedSettingsPatch(input: unknown): MarkedProtectedSettingsPatch {
  const entries = ProtectedSettingsPatchSchema.parse(input);
  return deepFreeze(MarkedProtectedSettingsPatchSchema.parse(Object.fromEntries(
    ProtectedSettingsNameSchema.options.flatMap((name) => {
      const entry = entries[name];
      if (entry === undefined) return [];
      return [[name, "set" in entry ? { set: PROTECTED_SETTINGS_SET_MARKER } : { clear: true }]];
    }),
  )));
}

export const ProtectedSettingsLastAppliedSchema = z.strictObject({
  commandId: CommandIdSchema,
  commandFingerprint: FingerprintSchema,
  expectedRevision: PositiveIntSchema,
  protectedSchemaHash: FingerprintSchema,
  writeId: z.uuid(),
});

/** Private executor input. It must never be used as the journal or wire readback schema. */
export const ProtectedSettingsApplyInputSchema = ProtectedSettingsLastAppliedSchema.extend({
  entries: ProtectedSettingsPatchSchema,
  updatedAt: IsoInstantSchema,
});
export type ProtectedSettingsApplyInput = z.infer<typeof ProtectedSettingsApplyInputSchema>;

export const ProtectedStoreRecordSchema = z.strictObject({
  schemaVersion: z.literal(1),
  revision: PositiveIntSchema.max(Number.MAX_SAFE_INTEGER),
  protectedSchemaHash: FingerprintSchema,
  entries: ProtectedStoreEntriesSchema,
  lastApplied: ProtectedSettingsLastAppliedSchema.optional(),
}).superRefine((record, context) => {
  if (record.protectedSchemaHash !== PROTECTED_SETTINGS_SCHEMA_HASH) {
    context.addIssue({ code: "custom", path: ["protectedSchemaHash"], message: "protected.json schema-mismatch" });
  }
  if (record.revision === 1) {
    if (record.lastApplied !== undefined || Object.keys(record.entries).length !== 0) {
      context.addIssue({ code: "custom", message: "protected.json revision 1 must be empty and never applied" });
    }
  } else if (record.lastApplied === undefined
    || record.lastApplied.expectedRevision + 1 !== record.revision
    || record.lastApplied.protectedSchemaHash !== record.protectedSchemaHash) {
    context.addIssue({ code: "custom", path: ["lastApplied"], message: "protected.json must bind its exact revision and schema" });
  }
  const identities = Object.values(record.entries).map((value) => value.valueId);
  if (new Set(identities).size !== identities.length) {
    context.addIssue({ code: "custom", path: ["entries"], message: "protected.json valueId identities must be unique" });
  }
});
export type ProtectedStoreRecord = z.infer<typeof ProtectedStoreRecordSchema>;
export type ProtectedSettingsPatch = z.infer<typeof ProtectedSettingsPatchSchema>;

export const ProtectedSettingsPresenceSchema = z.discriminatedUnion("present", [
  z.strictObject({ present: z.literal(false) }),
  z.strictObject({ present: z.literal(true), valueId: z.uuid(), updatedAt: IsoInstantSchema }),
]);

export const ProtectedSettingsReadbackSchema = z.strictObject({
  revision: PositiveIntSchema,
  entries: z.record(ProtectedSettingsNameSchema, ProtectedSettingsPresenceSchema),
});
export type ProtectedSettingsReadback = z.infer<typeof ProtectedSettingsReadbackSchema>;

export function protectedSettingsReadback(input: unknown): ProtectedSettingsReadback {
  const record = ProtectedStoreRecordSchema.parse(input);
  return deepFreeze(ProtectedSettingsReadbackSchema.parse({
    revision: record.revision,
    entries: Object.fromEntries(ProtectedSettingsNameSchema.options.map((name) => {
      const stored = record.entries[name];
      return [name, stored === undefined ? { present: false } : {
        present: true, valueId: stored.valueId, updatedAt: stored.updatedAt,
      }];
    })),
  }));
}

export function initialProtectedStoreRecord(): ProtectedStoreRecord {
  return deepFreeze(ProtectedStoreRecordSchema.parse({
    schemaVersion: 1, revision: 1, protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH, entries: {},
  }));
}

/** Doctor/preflight expose only catalog names and presence, never entry identities. */
export const ProtectedSettingsPresenceEntriesSchema = z.array(z.strictObject({
  name: ProtectedSettingsNameSchema, present: z.boolean(),
})).superRefine((entries, context) => {
  if (entries.length !== ProtectedSettingsNameSchema.options.length
    || entries.some((entry, index) => entry.name !== ProtectedSettingsNameSchema.options[index]))
    context.addIssue({ code: "custom", message: "protected presence must enumerate the catalog exactly in order" });
});
