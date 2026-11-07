import { ProtectedInputBindingsSchema, PublicTransactionKeyDigestSchema, publicTransactionKeyDigest,
  valueFreeProtectedData, type ProtectedInputBinding } from "../write-safety/protected-input.js";
import { z } from "zod";
import { CommandIdSchema, FingerprintSchema, NodeIdSchema, PositiveIntSchema, RunIdSchema, TaskIdSchema, WriteIntentIdSchema, BrowserSystemIdSchema } from "../../rules/identity/ids.js";
import { canonicalJsonStringify } from "../../rules/validation/canonical-json.js";
import { sha256Hex } from "../../rules/validation/sha256.js";
import type { SchemaBoundCanonicalValue } from "../validation/schema-bound-value.js";
import { ContractFieldPathSchema } from "../task/task-contract.js";

/** Refusals of the source-bound plan service, shared with its HTTP consumer. */
export const RerunPlanRefusalCodeSchema = z.enum(["target-deleted", "target-not-found", "source-stale", "invalid-state", "schema-mismatch", "invalid-value"]);
export type RerunPlanRefusalCode = z.infer<typeof RerunPlanRefusalCodeSchema>;

/** Coordinates are optional attribution, never permission to replay a checkpoint. */
export const RerunSourceSchema = z.strictObject({
  runId: RunIdSchema,
  expectedVersion: PositiveIntSchema,
  intent: z.literal("rerun"),
  failureCorrection: z.strictObject({ failureId: z.string().min(1), inputField: z.string().min(1) }).optional(),
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
  protectedBindings: ProtectedInputBindingsSchema.optional(),
});
export type RerunPlan = z.infer<typeof RerunPlanSchema>;

/** Private consent retains natural keys; the browser receives only the permitted reference. */
export const PublicRerunPlanSchema = RerunPlanSchema.extend({
  warnings: z.array(RepeatWarningSchema.extend({ businessKeyDigest: PublicTransactionKeyDigestSchema })),
});
export function projectRerunPlanForOperator(plan: RerunPlan): z.infer<typeof PublicRerunPlanSchema> {
  const withheld = plan.protectedBindings?.some(({ inputPath }) => inputPath !== "timekeeperName") === true;
  return PublicRerunPlanSchema.parse({ ...plan, warnings: plan.warnings.map((warning) => ({ ...warning,
    businessKeyDigest: publicTransactionKeyDigest(warning.businessKeyDigest, withheld) })) });
}

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
  protectedBindings: ProtectedInputBindingsSchema.optional(),
});
export type RepeatOccurrence = z.infer<typeof RepeatOccurrenceSchema>;

/** The same final command/node can never mint a second write lane. */
export function repeatOccurrenceKey(businessKeyDigest: string, confirmationCommandId: string, nodeId: string): string {
  return `hrauto-repeat:v1:${businessKeyDigest}:${confirmationCommandId}:${nodeId}`;
}

/** Exact schema-bound proof identity, independent of intent storage status. */
export function repeatEvidenceDigest(intent: Readonly<{ status: string; completionProof?: SchemaBoundCanonicalValue; observedProof?: SchemaBoundCanonicalValue }>,
  bindings?: readonly ProtectedInputBinding[]): string {
  const proof = intent.status === "committed" ? intent.completionProof : intent.status === "observed-present" ? intent.observedProof : undefined;
  if (proof === undefined) throw new Error("repeat warning requires settled evidence");
  return sha256Hex(canonicalJsonStringify(valueFreeProtectedData(proof, bindings)));
}
