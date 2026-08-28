import { z } from "zod";
import { canonicalJsonStringify } from "../canonical-json.js";
import { CommandIdSchema, FingerprintSchema, PositiveIntSchema } from "../ids.js";
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
  lastApplied: z.strictObject({
    commandId: CommandIdSchema,
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
