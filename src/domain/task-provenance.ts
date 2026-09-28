/**
 * Task-execution provenance collection (refs task-contract/workflow-model, D115).
 *
 * `recordData` accepts only the small, strict point below. The executor-owned
 * collector adds the run/node/task identity and Clock timestamp, then refuses
 * to finalize a read whose output is not completely covered by the contract's
 * declared provenance policy. Log prose is never inspected and a missing
 * collector is not representable in `TaskCtxCommon`.
 */
import { z } from "zod";
import { GateIdSchema } from "./ids.js";
import { JsonValueSchema } from "./canonical-json.js";
import { ContractFieldPathSchema } from "./contracts/base.js";
import { ProtectedInputBindingSchema } from "./protected-input.js";
import {
  ConfigurationReferenceKeySchema,
  OperationActionIdSchema,
  OperationIdSchema,
  OperationOccurrenceSegmentSchema,
  OperationSessionIdSchema,
  OperationTransformIdSchema,
  OperationValueIdSchema,
} from "./workflow/operation-display.js";
import {
  BrowserSessionIdSchema,
  DelegationEdgeIdSchema,
  FingerprintSchema,
  IsoInstantSchema,
  NodeIdSchema,
  PositiveIntSchema,
  RunIdSchema,
  TaskIdSchema,
  TraceIdSchema,
  WorkflowIdSchema,
} from "./ids.js";
import { GateResultRecordSchema } from "./gates.js";
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

/**
 * The immediate source a declared browser field consumed.  A task-output or
 * transformation reference remains a navigable source reference; it never
 * pretends an older page observation is the later value actually entered.
 */
export const ActionValueProducerSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("run-input"), path: ContractFieldPathSchema }),
  z.strictObject({ kind: z.literal("configuration"), key: ConfigurationReferenceKeySchema, schemaHash: FingerprintSchema }),
  z.strictObject({ kind: z.literal("constant"), valueDigest: FingerprintSchema }),
  z.strictObject({ kind: z.literal("task-output"), entryId: NodeIdSchema, path: ContractFieldPathSchema }),
  z.strictObject({ kind: z.literal("transformation"), transformId: OperationTransformIdSchema, path: ContractFieldPathSchema }),
  z.strictObject({ kind: z.literal("child-output"), entryId: NodeIdSchema, path: ContractFieldPathSchema }),
]);
export type ActionValueProducer = z.infer<typeof ActionValueProducerSchema>;

/** Exact local value when safe, otherwise the retained protected-source identity. */
export const ActionConsumedValueSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("observed"), value: JsonValueSchema }),
  z.strictObject({ state: z.literal("redacted"), binding: ProtectedInputBindingSchema }),
]);
export type ActionConsumedValue = z.infer<typeof ActionConsumedValueSchema>;

export const ActionValueProvenanceSchema = z.strictObject({
  slot: OperationValueIdSchema,
  fieldPath: ContractFieldPathSchema,
  producer: ActionValueProducerSchema,
  consumed: ActionConsumedValueSchema,
});
export type ActionValueProvenance = z.infer<typeof ActionValueProvenanceSchema>;

/**
 * Identity for one completed declared driver gesture.  It is self-contained so
 * a retained note can be joined to its frozen structure without current code.
 */
export const DeclaredActionOccurrenceSchema = z.strictObject({
  runId: RunIdSchema,
  definitionFingerprint: FingerprintSchema,
  nodeId: NodeIdSchema,
  taskId: TaskIdSchema,
  childInvocation: z.strictObject({ parentRunId: RunIdSchema, edgeId: DelegationEdgeIdSchema }).optional(),
  attempt: PositiveIntSchema,
  claimGeneration: PositiveIntSchema,
  taskAttempt: PositiveIntSchema,
  invocationId: OperationIdSchema,
  occurrencePath: z.array(OperationOccurrenceSegmentSchema).min(1),
  logicalActionId: OperationActionIdSchema,
  occurrence: PositiveIntSchema,
  logicalSessionId: OperationSessionIdSchema,
  physicalSessionId: BrowserSessionIdSchema,
  value: ActionValueProvenanceSchema.optional(),
});
export type DeclaredActionOccurrence = z.infer<typeof DeclaredActionOccurrenceSchema>;

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
  /** A false descriptor condition, re-evaluated by the collector; no operator fact. */
  skippedGates: z.array(GateIdSchema).default([]),
  /**
   * A GATE dependency's durable evidence, which is not a checkpoint and never
   * will be.
   *
   * A gate produces a `gate_results` row — an operator decision under the run's
   * identity — not a `run_checkpoints` row, so a task that declares a gate as a
   * dependency could not satisfy read-completion validation at all. The live
   * chunk-3 run found that: the post-gate node refused with "declared dependency
   * has no checkpoint record to hand to the provenance collector", which is a
   * true statement about a record that cannot exist.
   *
   * The fix is D144's shape read again: the READER moves. A gate's row is
   * admitted as its own kind of upstream evidence, contributing exactly one
   * `operator`-sourced fact dated at `resolvedAt`. It contributes no output
   * leaves, because a gate has none to date — what it dates is the DECISION.
   * Fabricating a checkpoint row for it would have made a durable record claim
   * a shape it does not have, which is what D144 refused.
   */
  gateResults: z.array(GateResultRecordSchema).default([]),
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
  for (const [index, gateId] of evidence.skippedGates.entries()) {
    if (checkpointNodes.has(gateId) || evidence.skippedGates.indexOf(gateId) !== index
      || evidence.gateResults.some((gate) => gate.gateId === gateId)) {
      context.addIssue({ code: "custom", path: ["skippedGates", index], message: `duplicate upstream evidence for node ${gateId}` });
    }
  }
  const gateNodes = new Set<string>();
  for (const [index, gate] of evidence.gateResults.entries()) {
    if (gateNodes.has(gate.gateId) || checkpointNodes.has(gate.gateId)) {
      context.addIssue({
        code: "custom",
        path: ["gateResults", index, "gateId"],
        message: `duplicate upstream evidence for node ${gate.gateId}`,
      });
    }
    gateNodes.add(gate.gateId);
  }
});
export type TaskUpstreamCheckpointEvidence = z.infer<typeof TaskUpstreamCheckpointEvidenceSchema>;
