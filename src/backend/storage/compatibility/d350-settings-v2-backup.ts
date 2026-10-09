import { RetiredAiProviderConfigSchema } from "../../../models/config/retired-ai-config.js";
import { z } from "zod";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { derivePersistedSettingsFingerprint, SETTINGS_SCHEMA_HASH } from "../../../models/config/settings.js";
import { AbsolutePathSchema, EditableSettingsOverrideSchema, FiscalYearKeySchema, UsDateSchema } from "../../../models/config/schema.js";
import { CommandIdSchema, FingerprintSchema, PositiveIntSchema } from "../../../rules/identity/ids.js";
import { deriveSchemaHash } from "../../../models/validation/schema-bound-value.js";
import { sha256Hex } from "../../../rules/validation/sha256.js";
import { PROTECTED_SETTINGS_SCHEMA_HASH } from "../../../models/config/protected-settings.js";

export const D350_HISTORICAL_SETTINGS_SCHEMA_HASH = "b8cd5d1b0056fceb020df20e0682762b2de53d8efa8dd9109c835d0fc0e9908a";

const HistoricalAnnualDateEntrySchema = z.strictObject({
  jobEndDate: UsDateSchema,
  kronosDefaultEndDate: UsDateSchema,
  kronosDefaultStartDate: UsDateSchema,
});

const HistoricalPathsSchema = z.strictObject({
  reportsDir: AbsolutePathSchema.optional(),
  downloadsDir: AbsolutePathSchema.optional(),
  onboardingDocsDir: AbsolutePathSchema.optional(),
  i9CheckTrackerPath: AbsolutePathSchema.optional(),
}).optional();

const D350HistoricalSettingsSchema = z.strictObject({
  ...EditableSettingsOverrideSchema.shape,
  providers: RetiredAiProviderConfigSchema.partial().optional(),
  paths: HistoricalPathsSchema,
  annualDates: z.record(FiscalYearKeySchema, HistoricalAnnualDateEntrySchema).optional(),
});

if (deriveSchemaHash(D350HistoricalSettingsSchema, "input") !== D350_HISTORICAL_SETTINGS_SCHEMA_HASH) {
  throw new Error("Historical Settings shape does not match its pinned schema hash");
}

export const D350HistoricalSettingsFileRecordSchema = z.strictObject({
  revision: PositiveIntSchema,
  settingsSchemaHash: z.literal(D350_HISTORICAL_SETTINGS_SCHEMA_HASH),
  settingsFingerprint: FingerprintSchema,
  settings: D350HistoricalSettingsSchema,
  lastApplied: z.strictObject({
    commandId: CommandIdSchema,
    commandFingerprint: FingerprintSchema,
    expectedRevision: PositiveIntSchema,
    settingsSchemaHash: z.literal(D350_HISTORICAL_SETTINGS_SCHEMA_HASH),
    patchFingerprint: FingerprintSchema,
  }).optional(),
}).superRefine((record, context) => {
  if (record.settingsFingerprint !== derivePersistedSettingsFingerprint(record.settings)) {
    context.addIssue({ code: "custom", path: ["settingsFingerprint"], message: "historical settings fingerprint mismatch" });
  }
  if (record.revision === 1) {
    if (record.lastApplied !== undefined) context.addIssue({ code: "custom", path: ["lastApplied"], message: "baseline settings cannot name a command" });
    if (record.settingsFingerprint !== derivePersistedSettingsFingerprint({})) context.addIssue({ code: "custom", path: ["settings"], message: "baseline settings must be empty" });
    return;
  }
  if (record.lastApplied === undefined) {
    context.addIssue({ code: "custom", path: ["lastApplied"], message: "applied historical settings must name their command" });
    return;
  }
  if (record.lastApplied.expectedRevision + 1 !== record.revision) {
    context.addIssue({ code: "custom", path: ["lastApplied", "expectedRevision"], message: "historical settings revision must advance exactly once" });
  }
});

const HistoricalSettingsRootTupleSchema = z.strictObject({
  schemaVersion: z.literal(1),
  settingsSchemaHash: z.enum([SETTINGS_SCHEMA_HASH, D350_HISTORICAL_SETTINGS_SCHEMA_HASH]),
  protectedSchemaHash: z.literal(PROTECTED_SETTINGS_SCHEMA_HASH),
  ordinary: z.enum(["virgin", "initialized"]),
  protected: z.enum(["virgin", "initialized"]),
});

export const D350HistoricalSettingsRootAuthoritySchema = HistoricalSettingsRootTupleSchema.extend({
  rootFingerprint: FingerprintSchema,
}).superRefine((record, context) => {
  const tuple = HistoricalSettingsRootTupleSchema.parse({
    schemaVersion: record.schemaVersion,
    settingsSchemaHash: record.settingsSchemaHash,
    protectedSchemaHash: record.protectedSchemaHash,
    ordinary: record.ordinary,
    protected: record.protected,
  });
  if (record.rootFingerprint !== sha256Hex(canonicalJsonStringify(tuple))) {
    context.addIssue({ code: "custom", path: ["rootFingerprint"], message: "historical authority tuple fingerprint mismatch" });
  }
});
