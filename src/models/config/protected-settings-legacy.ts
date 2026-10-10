import { z } from "zod";
import { CommandIdSchema, EidSchema, FingerprintSchema, IsoInstantSchema, PositiveIntSchema } from "../../rules/identity/ids.js";
import { deepFreeze } from "../../rules/validation/immutability.js";
import { deriveSchemaHash } from "../validation/schema-bound-value.js";
import { KualiDocumentNumberSchema } from "../ui/kuali-document-identity.js";
import { PROTECTED_SETTINGS_SET_MARKER } from "./protected-settings.js";

/** The FROZEN protected-settings schema family that carried the two test-target canaries; migration-only, and no runtime reader or wire surface may import it. */
export const LegacyProtectedValueSchemas = Object.freeze({
  ucpathUserId: z.string().min(1).max(256),
  ucpathPassword: z.string().min(1).max(4096),
  timekeeperName: z.string().min(1).max(256),
  sharepointOnboardingRosterUrl: z.url().max(8192),
  activityPersonPseudonym: z.strictObject({
    keyHex: z.string().regex(/^[0-9a-f]{64}$/u),
    keyGeneration: z.string().regex(/^activity-person-[a-z0-9]+(?:-[a-z0-9]+)*$/u),
  }),
  separationsKualiFinalizationCanaryDocumentNumber: KualiDocumentNumberSchema,
  personLookupCanaryEid: EidSchema,
});

export const LegacyProtectedSettingsNameSchema = z.strictObject(LegacyProtectedValueSchemas).keyof();
export type LegacyProtectedSettingsName = z.infer<typeof LegacyProtectedSettingsNameSchema>;

/** The two names the legacy family carried that the live family retired. */
export const RETIRED_TEST_TARGET_PROTECTED_NAMES = deepFreeze([
  "separationsKualiFinalizationCanaryDocumentNumber",
  "personLookupCanaryEid",
] as const);
export const RetiredTestTargetProtectedNameSchema = z.enum(RETIRED_TEST_TARGET_PROTECTED_NAMES);
export type RetiredTestTargetProtectedName = z.infer<typeof RetiredTestTargetProtectedNameSchema>;

function entry<Value extends z.ZodType>(value: Value) {
  return z.strictObject({ valueId: z.uuid(), value, updatedAt: IsoInstantSchema });
}

export const LegacyProtectedStoreEntriesSchema = z.strictObject({
  ucpathUserId: entry(LegacyProtectedValueSchemas.ucpathUserId).optional(),
  ucpathPassword: entry(LegacyProtectedValueSchemas.ucpathPassword).optional(),
  timekeeperName: entry(LegacyProtectedValueSchemas.timekeeperName).optional(),
  sharepointOnboardingRosterUrl: entry(LegacyProtectedValueSchemas.sharepointOnboardingRosterUrl).optional(),
  activityPersonPseudonym: entry(LegacyProtectedValueSchemas.activityPersonPseudonym).optional(),
  separationsKualiFinalizationCanaryDocumentNumber: entry(LegacyProtectedValueSchemas.separationsKualiFinalizationCanaryDocumentNumber).optional(),
  personLookupCanaryEid: entry(LegacyProtectedValueSchemas.personLookupCanaryEid).optional(),
});

function operation<Value extends z.ZodType>(value: Value) {
  return z.union([z.strictObject({ set: value }), z.strictObject({ clear: z.literal(true) })]).optional();
}

export const LegacyProtectedSettingsPatchSchema = z.strictObject({
  ucpathUserId: operation(LegacyProtectedValueSchemas.ucpathUserId),
  ucpathPassword: operation(LegacyProtectedValueSchemas.ucpathPassword),
  timekeeperName: operation(LegacyProtectedValueSchemas.timekeeperName),
  sharepointOnboardingRosterUrl: operation(LegacyProtectedValueSchemas.sharepointOnboardingRosterUrl),
  activityPersonPseudonym: operation(LegacyProtectedValueSchemas.activityPersonPseudonym),
  separationsKualiFinalizationCanaryDocumentNumber: operation(LegacyProtectedValueSchemas.separationsKualiFinalizationCanaryDocumentNumber),
  personLookupCanaryEid: operation(LegacyProtectedValueSchemas.personLookupCanaryEid),
});
export type LegacyProtectedSettingsPatch = z.infer<typeof LegacyProtectedSettingsPatchSchema>;

function markedOperation() {
  return z.union([
    z.strictObject({ set: z.literal(PROTECTED_SETTINGS_SET_MARKER) }),
    z.strictObject({ clear: z.literal(true) }),
  ]).optional();
}

/** The journal-safe form every pre-split protected command was written in; historical readers parse them here, and the live patch refuses them. */
export const LegacyMarkedProtectedSettingsPatchSchema = z.strictObject({
  ucpathUserId: markedOperation(),
  ucpathPassword: markedOperation(),
  timekeeperName: markedOperation(),
  sharepointOnboardingRosterUrl: markedOperation(),
  activityPersonPseudonym: markedOperation(),
  separationsKualiFinalizationCanaryDocumentNumber: markedOperation(),
  personLookupCanaryEid: markedOperation(),
});
export type LegacyMarkedProtectedSettingsPatch = z.infer<typeof LegacyMarkedProtectedSettingsPatchSchema>;

/** Test-only replay of the legacy marking step; never emits a value. */
export function legacyMarkProtectedSettingsPatch(input: unknown): LegacyMarkedProtectedSettingsPatch {
  const entries = LegacyProtectedSettingsPatchSchema.parse(input);
  return deepFreeze(LegacyMarkedProtectedSettingsPatchSchema.parse(Object.fromEntries(
    LegacyProtectedSettingsNameSchema.options.flatMap((name) => {
      const entry = entries[name];
      if (entry === undefined) return [];
      return [[name, "set" in entry ? { set: PROTECTED_SETTINGS_SET_MARKER } : { clear: true }]];
    }),
  )));
}

/** The exact hash every legacy `protected.json`, journal and credential history entry carries, pinned so a drift in the frozen schema is a load-time defect. */
export const LEGACY_PROTECTED_SETTINGS_SCHEMA_HASH = deriveSchemaHash(LegacyProtectedSettingsPatchSchema, "input");
const PINNED_LEGACY_PROTECTED_SETTINGS_SCHEMA_HASH = "2de4abeb58bd98da2aa2154fa3488e80895b046a406fccdd744924a08ceaf477";
if (LEGACY_PROTECTED_SETTINGS_SCHEMA_HASH !== PINNED_LEGACY_PROTECTED_SETTINGS_SCHEMA_HASH) {
  throw new Error("legacy protected-settings schema drifted from its pinned hash");
}

export const LegacyProtectedSettingsLastAppliedSchema = z.strictObject({
  commandId: CommandIdSchema,
  commandFingerprint: FingerprintSchema,
  expectedRevision: PositiveIntSchema,
  protectedSchemaHash: FingerprintSchema,
  writeId: z.uuid(),
});

/** Legacy private executor input; replayed only by the migration reader. */
export const LegacyProtectedSettingsApplyInputSchema = LegacyProtectedSettingsLastAppliedSchema.extend({
  entries: LegacyProtectedSettingsPatchSchema,
  updatedAt: IsoInstantSchema,
});
export type LegacyProtectedSettingsApplyInput = z.infer<typeof LegacyProtectedSettingsApplyInputSchema>;

export const LegacyProtectedStoreRecordSchema = z.strictObject({
  schemaVersion: z.literal(1),
  revision: PositiveIntSchema,
  protectedSchemaHash: FingerprintSchema,
  entries: LegacyProtectedStoreEntriesSchema,
  lastApplied: LegacyProtectedSettingsLastAppliedSchema.optional(),
}).superRefine((record, context) => {
  if (record.protectedSchemaHash !== LEGACY_PROTECTED_SETTINGS_SCHEMA_HASH) {
    context.addIssue({ code: "custom", path: ["protectedSchemaHash"], message: "legacy protected.json schema-mismatch" });
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
export type LegacyProtectedStoreRecord = z.infer<typeof LegacyProtectedStoreRecordSchema>;

export const LegacyProtectedSettingsPresenceSchema = z.discriminatedUnion("present", [
  z.strictObject({ present: z.literal(false) }),
  z.strictObject({ present: z.literal(true), valueId: z.uuid(), updatedAt: IsoInstantSchema }),
]);
export const LegacyProtectedSettingsReadbackSchema = z.strictObject({
  revision: PositiveIntSchema,
  entries: z.record(LegacyProtectedSettingsNameSchema, LegacyProtectedSettingsPresenceSchema),
});
export type LegacyProtectedSettingsReadback = z.infer<typeof LegacyProtectedSettingsReadbackSchema>;

/** Value-free presence readback over a legacy record; used by the frozen migration readers only. */
export function legacyProtectedSettingsReadback(input: unknown): LegacyProtectedSettingsReadback {
  const record = LegacyProtectedStoreRecordSchema.parse(input);
  return deepFreeze(LegacyProtectedSettingsReadbackSchema.parse({
    revision: record.revision,
    entries: Object.fromEntries(LegacyProtectedSettingsNameSchema.options.map((name) => {
      const stored = record.entries[name];
      return [name, stored === undefined ? { present: false } : {
        present: true, valueId: stored.valueId, updatedAt: stored.updatedAt,
      }];
    })),
  }));
}

export function initialLegacyProtectedStoreRecord(): LegacyProtectedStoreRecord {
  return deepFreeze(LegacyProtectedStoreRecordSchema.parse({
    schemaVersion: 1, revision: 1, protectedSchemaHash: LEGACY_PROTECTED_SETTINGS_SCHEMA_HASH, entries: {},
  }));
}
