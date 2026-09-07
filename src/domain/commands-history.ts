/**
 * Immutable journal readers. Frozen arms from aaffe367084c95e06606a3b42cb058b541acd1a8
 * src/domain/commands.ts: ordinary nested patches and the retired edit-checkpoint door.
 * These schemas never admit a new command. Historical journal readability is permanent.
 */
import { z } from "zod";
import { CommandAuditRecordSchema, CommandEnvelopeSchema } from "./commands.js";
import { FingerprintSchema, PositiveIntSchema, RunIdSchema } from "./ids.js";
import { CheckpointPatchSchema } from "./workflow/checkpoint.js";
import { EditableSettingsOverrideSchema } from "./config/settings-v29-schema.js";
import { canonicalJsonStringify } from "./canonical-json.js";
import { sha256Hex } from "./sha256.js";
const SETTINGS_SCHEMA_HASH = "aa49b924a6acd011954066a5ca78117eb6f7c1f1cee4f08eb3fef3c20d577b80";
function deriveSettingsPatchFingerprint(patch: unknown): string {
  return sha256Hex(`hrauto:settings-patch:v1\0${canonicalJsonStringify(EditableSettingsOverrideSchema.parse(patch))}`);
}

export const PreFloorSettingsCommandSchema = CommandEnvelopeSchema.extend({
  family: z.literal("settings"), type: z.literal("apply-settings"),
  target: z.strictObject({ expectedRevision: PositiveIntSchema }),
  payload: z.strictObject({ settingsSchemaHash: z.literal(SETTINGS_SCHEMA_HASH), patchFingerprint: FingerprintSchema, patch: EditableSettingsOverrideSchema }),
}).superRefine((command, context) => {
  if (deriveSettingsPatchFingerprint(command.payload.patch) !== command.payload.patchFingerprint) {
    context.addIssue({ code: "custom", message: "historical settings patch fingerprint mismatch" });
  }
});
const PreFloorEditCheckpointCommandSchema = CommandEnvelopeSchema.extend({
  family: z.literal("run"), type: z.literal("edit-checkpoint"),
  target: z.strictObject({ runId: RunIdSchema, expectedVersion: PositiveIntSchema }),
  payload: z.strictObject({ patches: z.array(CheckpointPatchSchema).min(1) }),
});
export const PreFloorCommandSchema = z.union([PreFloorSettingsCommandSchema, PreFloorEditCheckpointCommandSchema]);
export const PreFloorCommandAuditSchema = CommandAuditRecordSchema.extend({ request: PreFloorCommandSchema });
