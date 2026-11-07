import { z } from "zod";
import { CommandAuditIdSchema, CommandIdSchema, ConfigSnapshotIdSchema, FingerprintSchema, IsoInstantSchema } from "../../rules/identity/ids.js";
import { SettingsFileRecordSchema } from "./settings.js";

export const SettingsInitializationCommandSchema = z.strictObject({
  kind: z.literal("settings-initialization"), commandId: CommandIdSchema,
  revision: z.literal(1), settings: SettingsFileRecordSchema,
  configSnapshotId: ConfigSnapshotIdSchema, configFingerprint: FingerprintSchema,
  initializedAt: IsoInstantSchema,
}).refine(record => record.settings.revision === 1 && record.settings.lastApplied === undefined
  && Object.keys(record.settings.settings).length === 0, "settings initialization must persist empty overrides without operator consent");
export const SettingsInitializationAuditSchema = z.strictObject({
  kind: z.literal("settings-initialization"), auditId: CommandAuditIdSchema,
  request: SettingsInitializationCommandSchema,
  result: z.strictObject({ state: z.literal("initialized"), revision: z.literal(1), snapshotId: ConfigSnapshotIdSchema, fingerprint: FingerprintSchema }),
  completedAt: IsoInstantSchema,
}).refine(record => record.completedAt === record.request.initializedAt
  && record.result.snapshotId === record.request.configSnapshotId && record.result.fingerprint === record.request.configFingerprint,
"settings initialization audit must bind its exact snapshot and time");
export const SettingsInitializationSchema = z.strictObject({
  commandId: CommandIdSchema, auditId: CommandAuditIdSchema,
  configSnapshotId: ConfigSnapshotIdSchema, configFingerprint: FingerprintSchema,
  initializedAt: IsoInstantSchema, settings: SettingsFileRecordSchema,
}).refine(record => record.settings.revision === 1 && record.settings.lastApplied === undefined
  && Object.keys(record.settings.settings).length === 0, "settings initialization must retain exact empty overrides");
