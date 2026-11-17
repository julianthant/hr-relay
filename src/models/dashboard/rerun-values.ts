import { z } from "zod";
import { JsonValueSchema } from "../../rules/validation/canonical-json.js";
import { FingerprintSchema, IsoInstantSchema, NodeIdSchema, PositiveIntSchema, RunIdSchema,
  TaskIdSchema, WorkflowIdSchema, WriteIntentIdSchema } from "../../rules/identity/ids.js";
import { FactProvenanceSchema } from "../workflow/checkpoint.js";
import { RerunValueMappingSchema } from "../workflow/rerun-values.js";
import { StepOmissionsSchema } from "../workflow/step-omission.js";

export const RerunValuesRequestSchema = z.strictObject({ runId: RunIdSchema, expectedVersion: PositiveIntSchema });
const CompletionStateSchema = z.enum(["completed", "failed", "unfinished"]);
const NodeCompletionSchema = z.strictObject({
  nodeId: NodeIdSchema,
  /** A child transaction node's prepare or commit phase; a Start row can show each on its own. */
  phase: z.enum(["prepare", "commit"]).optional(),
  state: CompletionStateSchema,
  reason: z.enum(["checkpoint", "gate-result", "settled-transaction", "delegation-settled", "previewed", "prepared", "already-present",
    "failure", "incomplete-execution", "operator-asserted", "step-omitted", "not-recorded"]),
});
const StepCompletionSchema = z.strictObject({ key: z.string().min(1), state: CompletionStateSchema, nodes: z.array(NodeCompletionSchema).min(1) });
const CandidateCoordinatesSchema = RerunValueMappingSchema.extend({
  sourceStepKey: z.string().min(1),
});
const ValueCandidateSchema = z.discriminatedUnion("state", [
  CandidateCoordinatesSchema.extend({
    state: z.literal("available"),
    value: JsonValueSchema,
    checkpoint: z.strictObject({ attempt: PositiveIntSchema, claimGeneration: PositiveIntSchema.optional(), writtenAt: IsoInstantSchema }),
    provenance: FactProvenanceSchema,
  }),
  CandidateCoordinatesSchema.extend({
    state: z.literal("unavailable"),
    reason: z.enum(["not-completed", "not-recorded", "provenance-unavailable", "protected", "target-invalid"]),
  }),
]);

export const RerunValuesSnapshotSchema = z.strictObject({
  sourceInput: z.discriminatedUnion("state", [
    z.strictObject({ state: z.literal("available"), value: JsonValueSchema }),
    z.strictObject({ state: z.literal("partial"), value: z.record(z.string(), JsonValueSchema), identityCopied: z.boolean() }),
    z.strictObject({ state: z.literal("unavailable"), reason: z.literal("protected") }),
  ]),
  source: z.strictObject({
    runId: RunIdSchema, version: PositiveIntSchema, workflow: WorkflowIdSchema,
    descriptorVersion: PositiveIntSchema, contractFingerprint: FingerprintSchema,
    outcome: z.enum(["done", "failed", "interrupted"]),
  }),
  steps: z.array(StepCompletionSchema),
  /** Each delegated child workflow a Start row shows: per node, or per phase of a transaction node, the least advanced child run of that workflow. */
  children: z.array(z.strictObject({ workflow: WorkflowIdSchema, steps: z.array(StepCompletionSchema) })).optional(),
  values: z.array(ValueCandidateSchema),
  /** The source run's typed facts per step, for a step it had typed (a child step's under its workflow); offered as typed by hand. */
  typed: StepOmissionsSchema.optional(),
  transactions: z.array(z.strictObject({
    stepKey: z.string().min(1), nodeId: NodeIdSchema, taskId: TaskIdSchema,
    writeIntentId: WriteIntentIdSchema, evidenceDigest: FingerprintSchema,
    disposition: z.enum(["committed", "observed-present"]),
  })),
});
export type RerunValuesSnapshot = z.infer<typeof RerunValuesSnapshotSchema>;
export const RerunValuesRefusalCodeSchema = z.enum([
  "target-deleted", "target-not-found", "source-stale", "source-archived", "source-ineligible",
  "descriptor-mismatch", "source-invalid",
]);
export type RerunValuesRefusalCode = z.infer<typeof RerunValuesRefusalCodeSchema>;
export const RerunValuesResponseSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("available"), snapshot: RerunValuesSnapshotSchema }),
  z.strictObject({ state: z.literal("refused"), code: RerunValuesRefusalCodeSchema }),
]);
export type RerunValuesResponse = z.infer<typeof RerunValuesResponseSchema>;
