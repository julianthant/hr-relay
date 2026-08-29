import { z } from "zod";
import { canonicalJsonStringify } from "../canonical-json.js";
import { CommandIdSchema, FingerprintSchema, PositiveIntSchema, type Fingerprint } from "../ids.js";
import { deriveSchemaHash } from "../schema-bound-value.js";
import { sha256Hex } from "../sha256.js";
import { deepFreeze } from "../immutability.js";
import { SettingsOverrideSchema, type SettingsOverride } from "./schema.js";

export const CURRENT_SETTINGS_SCHEMA_HASH = deriveSchemaHash(SettingsOverrideSchema, "input");

export function deriveSettingsPatchFingerprint(patchInput: unknown): Fingerprint {
  const patch = SettingsOverrideSchema.parse(patchInput);
  return FingerprintSchema.parse(sha256Hex(
    `hrauto:settings-patch:v1\0${canonicalJsonStringify(patch)}`,
  ));
}

export function deriveSettingsCommandFingerprint(commandInput: unknown): Fingerprint {
  return FingerprintSchema.parse(sha256Hex(
    `hrauto:settings-command:v1\0${canonicalJsonStringify(commandInput)}`,
  ));
}

export function derivePersistedSettingsFingerprint(settingsInput: unknown): Fingerprint {
  const settings = SettingsOverrideSchema.parse(settingsInput);
  return FingerprintSchema.parse(sha256Hex(
    `hrauto:persisted-settings:v1\0${canonicalJsonStringify(settings)}`,
  ));
}

function mergeValue(current: unknown, patch: unknown): unknown {
  if (patch === null || typeof patch !== "object" || Array.isArray(patch)) return patch;
  const currentEntries = current !== null && typeof current === "object" && !Array.isArray(current)
    ? Object.entries(current)
    : [];
  const merged = new Map<string, unknown>(currentEntries);
  for (const [key, value] of Object.entries(patch)) {
    merged.set(key, mergeValue(merged.get(key), value));
  }
  return Object.fromEntries(merged);
}

export function mergeSettingsPatch(currentInput: unknown, patchInput: unknown): SettingsOverride {
  const current = SettingsOverrideSchema.parse(currentInput);
  const patch = SettingsOverrideSchema.parse(patchInput);
  return SettingsOverrideSchema.parse(mergeValue(current, patch));
}

export const SettingsApplyInputSchema = z.strictObject({
  commandId: CommandIdSchema,
  commandFingerprint: FingerprintSchema,
  expectedRevision: PositiveIntSchema,
  settingsSchemaHash: FingerprintSchema,
  patchFingerprint: FingerprintSchema,
  patch: SettingsOverrideSchema,
});

export const SettingsFileRecordSchema = z.strictObject({
  revision: PositiveIntSchema,
  settingsSchemaHash: FingerprintSchema,
  settingsFingerprint: FingerprintSchema,
  settings: SettingsOverrideSchema,
}).superRefine((record, context) => {
  if (record.settingsSchemaHash !== CURRENT_SETTINGS_SCHEMA_HASH) {
    context.addIssue({
      code: "custom",
      path: ["settingsSchemaHash"],
      message: `persisted settings schema ${record.settingsSchemaHash} does not match this build's ${CURRENT_SETTINGS_SCHEMA_HASH}`,
    });
  }
  const expectedFingerprint = derivePersistedSettingsFingerprint(record.settings);
  if (record.settingsFingerprint !== expectedFingerprint) {
    context.addIssue({
      code: "custom",
      path: ["settingsFingerprint"],
      message: `persisted settings fingerprint ${record.settingsFingerprint} does not match the strict settings value`,
    });
  }
});

export type SettingsFileRecord = z.infer<typeof SettingsFileRecordSchema>;

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
  const settings = SettingsOverrideSchema.parse({});
  return deepFreeze(SettingsFileRecordSchema.parse({
    revision: 1,
    settingsSchemaHash: CURRENT_SETTINGS_SCHEMA_HASH,
    settingsFingerprint: derivePersistedSettingsFingerprint(settings),
    settings,
  }));
}

export type { SettingsOverride };
