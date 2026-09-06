import { valueFreeProtectedData } from "../protected-input.js";
import { z } from "zod";
import { CommandIdSchema, FingerprintSchema, NodeIdSchema, PositiveIntSchema, RunIdSchema, TaskIdSchema, WriteIntentIdSchema, BrowserSystemIdSchema } from "../ids.js";
import { canonicalJsonStringify } from "../canonical-json.js";
import { sha256Hex } from "../sha256.js";
import type { SchemaBoundCanonicalValue } from "../schema-bound-value.js";
import { ContractFieldPathSchema } from "../contracts/base.js";

/** Coordinates are optional attribution, never permission to replay a checkpoint. */
export const RerunSourceSchema = z.strictObject({
  runId: RunIdSchema,
  expectedVersion: PositiveIntSchema,
  intent: z.literal("rerun"),
  selectedStepKeys: z.array(z.string().min(1)).min(1),
  copiedFrom: z.array(z.strictObject({
    nodeId: NodeIdSchema,
    fieldPath: ContractFieldPathSchema,
    targetFieldPath: ContractFieldPathSchema,
    targetStepKey: z.string().min(1).optional(),
  })).optional(),
});
export type RerunSource = z.infer<typeof RerunSourceSchema>;

export const RepeatWarningSchema = z.strictObject({
  nodeId: NodeIdSchema,
  taskId: TaskIdSchema,
  system: BrowserSystemIdSchema,
  businessKeyDigest: FingerprintSchema,
  writeIntentId: WriteIntentIdSchema,
  evidenceDigest: FingerprintSchema,
});
export type RepeatWarning = z.infer<typeof RepeatWarningSchema>;

export const RerunPlanSchema = z.strictObject({
  source: RerunSourceSchema,
  warnings: z.array(RepeatWarningSchema),
  warningDigest: FingerprintSchema,
  acknowledgment: FingerprintSchema.optional(),
});
export type RerunPlan = z.infer<typeof RerunPlanSchema>;

/** Only final plan consumption stamps a command-bound execution authorization. */
export const SourceBoundRunSchema = z.strictObject({
  ...RerunPlanSchema.shape,
  confirmationCommandId: CommandIdSchema,
});
export const RepeatOccurrenceSchema = z.strictObject({
  ...RepeatWarningSchema.shape,
  confirmationCommandId: CommandIdSchema,
  sourceRunId: RunIdSchema,
  sourceVersion: PositiveIntSchema,
  warningDigest: FingerprintSchema,
  baselineEvidence: z.array(z.strictObject({ writeIntentId: WriteIntentIdSchema, evidenceDigest: FingerprintSchema })).min(1),
});
export type RepeatOccurrence = z.infer<typeof RepeatOccurrenceSchema>;

/** The same final command/node can never mint a second write lane. */
export function repeatOccurrenceKey(businessKeyDigest: string, confirmationCommandId: string, nodeId: string): string {
  return `hrauto-repeat:v1:${businessKeyDigest}:${confirmationCommandId}:${nodeId}`;
}

/** Exact schema-bound proof identity, independent of intent storage status. */
export function repeatEvidenceDigest(intent: Readonly<{ status: string; completionProof?: SchemaBoundCanonicalValue; observedProof?: SchemaBoundCanonicalValue }>): string {
  const proof = intent.status === "committed" ? intent.completionProof : intent.status === "observed-present" ? intent.observedProof : undefined;
  if (proof === undefined) throw new Error("repeat warning requires settled evidence");
  return sha256Hex(canonicalJsonStringify(valueFreeProtectedData(proof)));
}
