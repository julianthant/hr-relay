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
 * Exact graph-declaration/checkpoint pairing supplied by the later executor.
 * `declaredDependencyNodeIds` comes directly from `RuntimeFlowNode.dependsOn`;
 * each id must have exactly one whole authority checkpoint and no other
 * checkpoint may enter the provenance union.
 */
export const TaskUpstreamCheckpointSetSchema = z.strictObject({
  declaredDependencyNodeIds: z.array(NodeIdSchema),
  checkpoints: z.array(RunCheckpointRecordSchema),
}).superRefine((upstream, context) => {
  const declared = new Set<string>();
  for (const [index, nodeId] of upstream.declaredDependencyNodeIds.entries()) {
    if (declared.has(nodeId)) {
      context.addIssue({
        code: "custom",
        path: ["declaredDependencyNodeIds", index],
        message: `duplicate declared dependency ${nodeId}`,
      });
    }
    declared.add(nodeId);
  }

  const checkpointNodes = new Set<string>();
  for (const [index, checkpoint] of upstream.checkpoints.entries()) {
    if (checkpointNodes.has(checkpoint.nodeId)) {
      context.addIssue({
        code: "custom",
        path: ["checkpoints", index, "nodeId"],
        message: `duplicate upstream checkpoint ${checkpoint.nodeId}`,
      });
    }
    checkpointNodes.add(checkpoint.nodeId);
    if (!declared.has(checkpoint.nodeId)) {
      context.addIssue({
        code: "custom",
        path: ["checkpoints", index, "nodeId"],
        message: `undeclared upstream checkpoint ${checkpoint.nodeId}`,
      });
    }
  }

  for (const [index, nodeId] of upstream.declaredDependencyNodeIds.entries()) {
    if (!checkpointNodes.has(nodeId)) {
      context.addIssue({
        code: "custom",
        path: ["declaredDependencyNodeIds", index],
        message: `declared dependency ${nodeId} has no checkpoint provenance`,
      });
    }
  }
});
export type TaskUpstreamCheckpointSet = z.infer<typeof TaskUpstreamCheckpointSetSchema>;
