import { z } from "zod";
import { canonicalJsonStringify } from "../canonical-json.js";
import { FingerprintSchema, PositiveIntSchema } from "../ids.js";
import { deepFreeze } from "../immutability.js";
import { deriveSchemaHash } from "../schema-bound-value.js";
import { sha256Hex } from "../sha256.js";
import { SettingsOverrideSchema, type SettingsOverride } from "./schema.js";

/** The exact settings-patch schema this build accepts at the command boundary. */
export const SETTINGS_SCHEMA_HASH = deriveSchemaHash(SettingsOverrideSchema, "input");

export function deriveSettingsPatchFingerprint(patch: unknown): string {
  const parsed = SettingsOverrideSchema.parse(patch);
  return FingerprintSchema.parse(sha256Hex(
    `hrauto:settings-patch:v1\0${canonicalJsonStringify(parsed)}`,
  ));
}

export function derivePersistedSettingsFingerprint(settings: unknown): string {
  const parsed = SettingsOverrideSchema.parse(settings);
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
  settings: SettingsOverrideSchema,
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
});

export const SettingsApplyInputSchema = z.strictObject({
  expectedRevision: PositiveIntSchema,
  settingsSchemaHash: FingerprintSchema,
  patchFingerprint: FingerprintSchema,
  patch: SettingsOverrideSchema,
});

export const SettingsApplyRefusalSchema = z.discriminatedUnion("state", [
  z.strictObject({
    state: z.literal("conflict"),
    currentRevision: PositiveIntSchema,
    message: z.string().min(1),
  }),
  z.strictObject({
    state: z.literal("rejected"),
    code: z.literal("schema-mismatch"),
    message: z.string().min(1),
  }),
]);

export type SettingsFileRecord = z.infer<typeof SettingsFileRecordSchema>;
export type SettingsApplyInput = z.infer<typeof SettingsApplyInputSchema>;
export type SettingsApplyRefusal = z.infer<typeof SettingsApplyRefusalSchema>;

export function initialSettingsFileRecord(): SettingsFileRecord {
  const settings = SettingsOverrideSchema.parse({});
  return deepFreeze(SettingsFileRecordSchema.parse({
    revision: 1,
    settingsSchemaHash: SETTINGS_SCHEMA_HASH,
    settingsFingerprint: derivePersistedSettingsFingerprint(settings),
    settings,
  }));
}

function mergeObjects(base: unknown, patch: unknown): unknown {
  if (base === null || patch === null || Array.isArray(base) || Array.isArray(patch)
    || typeof base !== "object" || typeof patch !== "object") {
    return patch;
  }
  const baseRecord = z.record(z.string(), z.unknown()).parse(base);
  const patchRecord = z.record(z.string(), z.unknown()).parse(patch);
  const merged = new Map(Object.entries(baseRecord));
  for (const [key, value] of Object.entries(patchRecord)) {
    merged.set(key, Object.hasOwn(baseRecord, key) ? mergeObjects(baseRecord[key], value) : value);
  }
  return Object.fromEntries(merged);
}

/** Deep merge preserves untouched sparse leaves while applying one atomic N-leaf patch. */
export function mergeSettingsPatch(current: SettingsOverride, patch: SettingsOverride): SettingsOverride {
  return SettingsOverrideSchema.parse(mergeObjects(current, patch));
}

