/**
 * Task-execution provenance collection (docs 01/02, D115).
 *
 * `recordData` accepts only the small, strict point below. The executor-owned
 * collector adds the run/node/task identity and Clock timestamp, then refuses
 * to finalize a read whose output is not completely covered by the contract's
 * declared provenance policy. Log prose is never inspected and a missing
 * collector is not representable in `TaskCtxCommon`.
 */
import { z } from "zod";
import { JsonValueSchema } from "./canonical-json.js";
import { ContractFieldPathSchema } from "./contracts/base.js";
import {
  IsoInstantSchema,
  NodeIdSchema,
  PositiveIntSchema,
  RunIdSchema,
  TaskIdSchema,
  TraceIdSchema,
  WorkflowIdSchema,
} from "./ids.js";
import {
  FactProvenanceSchema,
  RunCheckpointRecordSchema,
} from "./workflow/checkpoint.js";

export const DataPointSchema = z.strictObject({
  direction: z.enum(["read", "write"]),
  field: ContractFieldPathSchema,
  value: JsonValueSchema,
});
/** Task-facing input; `recordData` performs the branding parse itself. */
export type DataPoint = z.input<typeof DataPointSchema>;

export const TaskExecutionIdentitySchema = z.strictObject({
  runId: RunIdSchema,
  traceId: TraceIdSchema,
  attempt: PositiveIntSchema,
  workflowId: WorkflowIdSchema,
  nodeId: NodeIdSchema,
  taskId: TaskIdSchema,
});
export type TaskExecutionIdentity = z.infer<typeof TaskExecutionIdentitySchema>;

export const RecordedDataPointSchema = DataPointSchema.extend({
  execution: TaskExecutionIdentitySchema,
  recordedAt: IsoInstantSchema,
});
export type RecordedDataPoint = z.infer<typeof RecordedDataPointSchema>;

export const TaskProvenanceResultSchema = z.strictObject({
  points: z.array(RecordedDataPointSchema).min(1),
  provenance: z.array(FactProvenanceSchema).min(1),
});
export type TaskProvenanceResult = z.infer<typeof TaskProvenanceResultSchema>;

/**
 * Whole authority checkpoints supplied as evidence by the later executor.
 * The expected dependency ids deliberately do not live in this caller-owned
 * boundary: the collector resolves them from factory-authenticated descriptor
 * metadata and checks this evidence against that authoritative set.
 */
export const TaskUpstreamCheckpointEvidenceSchema = z.strictObject({
  checkpoints: z.array(RunCheckpointRecordSchema),
}).superRefine((evidence, context) => {
  const checkpointNodes = new Set<string>();
  for (const [index, checkpoint] of evidence.checkpoints.entries()) {
    if (checkpointNodes.has(checkpoint.nodeId)) {
      context.addIssue({
        code: "custom",
        path: ["checkpoints", index, "nodeId"],
        message: `duplicate upstream checkpoint ${checkpoint.nodeId}`,
      });
    }
    checkpointNodes.add(checkpoint.nodeId);
  }
});
export type TaskUpstreamCheckpointEvidence = z.infer<typeof TaskUpstreamCheckpointEvidenceSchema>;
