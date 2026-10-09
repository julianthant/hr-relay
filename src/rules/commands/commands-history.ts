/**
 * Immutable journal readers. Frozen arms from aaffe367084c95e06606a3b42cb058b541acd1a8
 * src/domain/commands.ts: ordinary nested patches and the retired edit-checkpoint door, plus
 * the pre-D341 marked protected-settings command (seven-name family, legacy schema hash).
 * These schemas never admit a new command. Historical journal readability is permanent.
 */
import { z } from "zod";
import { CommandAuditRecordSchema, CommandEnvelopeSchema, CommandResultSchema, markSettingsCommand } from "./commands.js";
import { LEGACY_PROTECTED_SETTINGS_SCHEMA_HASH, LegacyMarkedProtectedSettingsPatchSchema } from "../../models/config/protected-settings-legacy.js";
import { deepFreeze } from "../validation/immutability.js";
import { ActorIdSchema, FingerprintSchema, IsoInstantSchema, NotificationIdSchema, PositiveIntSchema, RunIdSchema } from "../identity/ids.js";
import { CheckpointPatchSchema } from "../../models/workflow/checkpoint.js";
import { EditableSettingsOverrideSchema } from "../../models/config/settings-v29-schema.js";
import { canonicalJsonStringify } from "../validation/canonical-json.js";
import { sha256Hex } from "../validation/sha256.js";
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

/** The pre-W2 Snooze envelope is retained only for immutable journal and audit reads. */
export const HistoricalNotificationSnoozeCommandSchema = CommandEnvelopeSchema.extend({
  family: z.literal("notification"), type: z.literal("notification-snooze"),
  target: z.strictObject({ notificationId: NotificationIdSchema, actorId: ActorIdSchema, expectedVersion: PositiveIntSchema }),
  payload: z.strictObject({ until: IsoInstantSchema }),
});
export const HistoricalNotificationSnoozeAuditSchema = CommandAuditRecordSchema.extend({ request: HistoricalNotificationSnoozeCommandSchema });
export type HistoricalNotificationSnoozeCommand = z.infer<typeof HistoricalNotificationSnoozeCommandSchema>;

/**
 * D341: the marked protected-settings command as every pre-D341 journal wrote it. The schema
 * hash is pinned to the frozen legacy family, so a live command can never parse here, and the
 * retired canary names are admitted only in their value-free marked form. Historical readers
 * (D331 journal authentication, settings history, backup authentication) union this arm with
 * the live grammar; the D341 refusal by name then happens AFTER the row is read, never as an
 * opaque parse failure.
 */
export const HistoricalProtectedSettingsCommandSchema = CommandEnvelopeSchema.extend({
  family: z.literal("settings"), type: z.literal("apply-protected-settings"),
  target: z.strictObject({ expectedRevision: PositiveIntSchema }),
  payload: z.strictObject({
    protectedSchemaHash: z.literal(LEGACY_PROTECTED_SETTINGS_SCHEMA_HASH),
    writeId: z.uuid(),
    entries: LegacyMarkedProtectedSettingsPatchSchema,
  }),
});
export type HistoricalProtectedSettingsCommand = z.infer<typeof HistoricalProtectedSettingsCommandSchema>;
export const HistoricalProtectedSettingsAuditSchema = CommandAuditRecordSchema.extend({ request: HistoricalProtectedSettingsCommandSchema });
export type HistoricalProtectedSettingsAudit = z.infer<typeof HistoricalProtectedSettingsAuditSchema>;

/** The exact journal form of a live or historical settings command (historical rows are already marked). */
export function journaledSettingsCommand(command: unknown): ReturnType<typeof markSettingsCommand> | HistoricalProtectedSettingsCommand {
  const historical = HistoricalProtectedSettingsCommandSchema.safeParse(command);
  return historical.success ? deepFreeze(historical.data) : markSettingsCommand(command);
}

/** Same formula as `deriveSettingsCommandFingerprint`, extended to the frozen protected arm. */
export function deriveJournaledSettingsCommandFingerprint(command: unknown): string {
  return FingerprintSchema.parse(sha256Hex(`hrauto:settings-command:v1\0${canonicalJsonStringify(journaledSettingsCommand(command))}`));
}

/** Immutable, value-free provider-key journal evidence; never an executable command. */
const HistoricalProviderKeySlotSchema = z.enum(["GEMINI_API_KEY", "GROQ_API_KEY", "MISTRAL_API_KEY", "OPEN_ROUTER_API_KEY", "SAMBANOVA_API_KEY"].flatMap(prefix => Array.from({ length: 8 }, (_, index) => index === 0 ? prefix : prefix + String(index + 1))));
export const HistoricalProviderKeysCommandSchema = CommandEnvelopeSchema.extend({
  family: z.literal("settings"), type: z.literal("apply-provider-keys"),
  target: z.strictObject({ expectedRevision: PositiveIntSchema, sourceVersionToken: FingerprintSchema }),
  payload: z.strictObject({ providerSchemaHash: FingerprintSchema, writeId: z.uuid(), operations: z.partialRecord(HistoricalProviderKeySlotSchema, z.union([z.strictObject({ set: z.literal("<set>") }), z.strictObject({ clear: z.literal(true) })])) }),
});
const HistoricalProviderKeyTargetSchema = z.strictObject({ family: z.literal("provider-keys"), revision: PositiveIntSchema });
const HistoricalProviderKeysResultSchema = z.union([CommandResultSchema,
  z.strictObject({ state: z.enum(["applied", "already-applied"]), commandId: HistoricalProviderKeysCommandSchema.shape.commandId,
    affectedTargets: z.tuple([HistoricalProviderKeyTargetSchema]), restartRequired: z.boolean(),
    providerRevision: PositiveIntSchema, providerReceiptId: z.uuid(), providerSourceVersionToken: FingerprintSchema,
  }).refine(result => result.providerRevision === result.affectedTargets[0].revision, "provider revision mismatch"),
]);
export const HistoricalProviderKeysAuditSchema = CommandAuditRecordSchema.extend({
  request: HistoricalProviderKeysCommandSchema, result: HistoricalProviderKeysResultSchema,
  versionChanges: z.array(z.strictObject({ target: HistoricalProviderKeyTargetSchema, before: z.number().int().nonnegative(), after: PositiveIntSchema })),
});
