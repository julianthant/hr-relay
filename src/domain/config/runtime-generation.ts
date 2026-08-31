import { z } from "zod";
import {
  ConfigSnapshotIdSchema,
  FingerprintSchema,
  IsoInstantSchema,
  PositiveIntSchema,
} from "../ids.js";

/** The dashboard-activated config identity workers must match at boot and claim. */
export const ActiveRuntimeConfigRecordSchema = z.strictObject({
  generation: PositiveIntSchema,
  settingsRevision: PositiveIntSchema,
  settingsFingerprint: FingerprintSchema,
  configSnapshotId: ConfigSnapshotIdSchema,
  configFingerprint: FingerprintSchema,
  activatedAt: IsoInstantSchema,
});
export type ActiveRuntimeConfigRecord = z.infer<typeof ActiveRuntimeConfigRecordSchema>;

export const ActiveRuntimeConfigActivationSchema = ActiveRuntimeConfigRecordSchema.omit({
  generation: true,
});

export const ActiveRuntimeConfigExpectationSchema = z.strictObject({
  settingsRevision: PositiveIntSchema,
  settingsFingerprint: FingerprintSchema,
  configFingerprint: FingerprintSchema,
});

export const RuntimeConfigClaimTokenSchema = ActiveRuntimeConfigRecordSchema.pick({
  generation: true,
  settingsRevision: true,
  settingsFingerprint: true,
  configFingerprint: true,
});
export type RuntimeConfigClaimToken = z.infer<typeof RuntimeConfigClaimTokenSchema>;
