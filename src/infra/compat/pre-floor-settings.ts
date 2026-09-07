// A0 frozen envelope: aaffe367084c95e06606a3b42cb058b541acd1a8 src/domain/config/settings.ts. Phase 2.6 deletes this adapter.
import { z } from "zod";
import { canonicalJsonStringify } from "../../domain/canonical-json.js";
import { CommandIdSchema, FingerprintSchema, PositiveIntSchema } from "../../domain/ids.js";
import { sha256Hex } from "../../domain/sha256.js";
import {
  EditableSettingsOverrideSchema,
} from "../../domain/config/settings-v29-schema.js";

/** The exact settings-patch schema this build accepts at the command boundary. */
export const SETTINGS_SCHEMA_HASH = "aa49b924a6acd011954066a5ca78117eb6f7c1f1cee4f08eb3fef3c20d577b80";
/** Existing editor consumers share the same closed command schema identity. */
export const CURRENT_SETTINGS_SCHEMA_HASH = SETTINGS_SCHEMA_HASH;

export function deriveSettingsPatchFingerprint(patch: unknown): string {
  const parsed = EditableSettingsOverrideSchema.parse(patch);
  return FingerprintSchema.parse(sha256Hex(
    `hrauto:settings-patch:v1\0${canonicalJsonStringify(parsed)}`,
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
