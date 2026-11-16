import { z } from "zod";
import { RunContinuationSchema } from "./continuation.js";
import { ConfigSnapshotIdSchema, FingerprintSchema, PositiveIntSchema, RunIdSchema } from "../../rules/identity/ids.js";

/** Server-derived checkpoint recovery, distinct from ordinary source-bound Rerun. */
export const RunRecoveryPlanSchema = z.strictObject({
  kind: z.literal("checkpoint-recovery"),
  source: z.strictObject({ runId: RunIdSchema, expectedVersion: PositiveIntSchema, attempt: PositiveIntSchema,
    inputDigest: FingerprintSchema }),
  descriptorVersion: PositiveIntSchema, descriptorFingerprint: FingerprintSchema,
  configSnapshotId: ConfigSnapshotIdSchema, configFingerprint: FingerprintSchema,
  continuation: RunContinuationSchema,
});
export type RunRecoveryPlan = z.infer<typeof RunRecoveryPlanSchema>;
