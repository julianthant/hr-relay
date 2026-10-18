import { OperationChildResultReferenceSchema } from "../../models/workflow/operation-action-identity.js";
import { RunResultRecordSchema } from "../../models/run/result.js";
import { SnapshotWorkflowValueReferenceSchema } from "../../models/workflow/operation-display-snapshot.js";
import { OperationInputLineageSchema, OperationChildResultIdentitySchema, DeclaredActionIdentitySchema } from "../../models/workflow/operation-action-identity.js";
export { DeclaredActionIdentitySchema } from "../../models/workflow/operation-action-identity.js";
export type { DeclaredActionIdentity } from "../../models/workflow/operation-action-identity.js";
/** Finalize reads only when declared provenance covers the complete output. */
import { z } from "zod";
import { DataObservationAliasSchema, DataObservationOriginsSchema } from "../../models/events/data-observation-origin.js";
import { GateIdSchema } from "../identity/ids.js";
import { JsonValueSchema } from "../validation/canonical-json.js";
import { ContractFieldPathSchema } from "../../models/task/task-contract.js";
import { ProtectedInputBindingSchema } from "../../models/write-safety/protected-input.js";
import {
  ConfigurationReferenceKeySchema,
  OperationTransformIdSchema,
  OperationValueIdSchema,
} from "../../models/workflow/operation-display.js";
import {
  DelegationEdgeIdSchema,
  FingerprintSchema,
  IsoInstantSchema,
  NodeIdSchema,
  PositiveIntSchema,
  RunIdSchema,
  TaskIdSchema,
  TraceIdSchema,
  WorkflowIdSchema,
} from "../identity/ids.js";
import { GateResultRecordSchema } from "../../models/workflow/gates.js";
import {
  FactProvenanceSchema,
  RunCheckpointRecordSchema,
} from "../../models/workflow/checkpoint.js";

export const DataPointSchema = z.strictObject({
  direction: z.enum(["read", "write"]),
  field: ContractFieldPathSchema,
  value: JsonValueSchema,
  aliases: z.array(DataObservationAliasSchema).optional(),
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

/** The immediate source a declared browser field consumed; a task-output or transformation reference never pretends an older page observation is the later value entered. */
export const ActionValueProducerSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("run-input"), path: ContractFieldPathSchema }),
  z.strictObject({ kind: z.literal("configuration"), key: ConfigurationReferenceKeySchema, schemaHash: FingerprintSchema }),
  z.strictObject({ kind: z.literal("constant"), valueDigest: FingerprintSchema }),
  z.strictObject({ kind: z.literal("task-output"), entryId: NodeIdSchema, path: ContractFieldPathSchema, source: DeclaredActionIdentitySchema.optional() }),
  z.strictObject({ kind: z.literal("transformation"), transformId: OperationTransformIdSchema, path: ContractFieldPathSchema,
    inputs: z.array(z.strictObject({ inputId: OperationValueIdSchema, source: SnapshotWorkflowValueReferenceSchema, childResults: z.array(OperationChildResultReferenceSchema).max(256).optional(), identities: z.array(DeclaredActionIdentitySchema),
      state: z.enum(["retained", "definition-source", "unavailable"]), reason: z.literal("exact-input-occurrence-not-retained").optional() }).superRefine((input, context) => {
      if (input.state === "unavailable" ? input.identities.length !== 0 || input.reason === undefined
        : input.reason !== undefined || (input.state === "retained" ? input.identities.length === 0 : input.identities.length !== 0)) context.addIssue({ code: "custom", message: "transformation input lineage contradicts its state" });
    })).optional() }),
  z.strictObject({ kind: z.literal("child-output"), entryId: NodeIdSchema, path: ContractFieldPathSchema, source: DeclaredActionIdentitySchema.optional(), result: OperationChildResultIdentitySchema.optional(), inputs: z.array(OperationInputLineageSchema).optional() }),
]);
export type ActionValueProducer = z.infer<typeof ActionValueProducerSchema>;

/** Exact local value when safe, otherwise the retained protected-source identity. */
export const ActionConsumedValueSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("withheld"), reason: z.enum(["protection-unresolved", "classification-required"]) }),
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

/** Identity for one completed declared driver gesture, self-contained so a retained note can be joined to its frozen structure without current code. */
export const DeclaredActionOccurrenceSchema = DeclaredActionIdentitySchema.safeExtend({
  value: ActionValueProvenanceSchema.optional(),
});
export type DeclaredActionOccurrence = z.infer<typeof DeclaredActionOccurrenceSchema>;

export const RecordedDataPointSchema = DataPointSchema.extend({
  execution: TaskExecutionIdentitySchema,
  recordedAt: IsoInstantSchema,
  origins: DataObservationOriginsSchema.optional(),
});
export type RecordedDataPoint = z.infer<typeof RecordedDataPointSchema>;

export const TaskProvenanceResultSchema = z.strictObject({
  points: z.array(RecordedDataPointSchema).min(1),
  provenance: z.array(FactProvenanceSchema).min(1),
});
export type TaskProvenanceResult = z.infer<typeof TaskProvenanceResultSchema>;

/** Whole authority checkpoints supplied as evidence by the later executor; the collector resolves the expected dependency ids from factory-authenticated descriptor metadata. */
export const TaskUpstreamCheckpointEvidenceSchema = z.strictObject({
  conditionEvidence: z.strictObject({ checkpoints: z.array(RunCheckpointRecordSchema), gateResults: z.array(GateResultRecordSchema),
    skippedTasks: z.array(NodeIdSchema), skippedGates: z.array(GateIdSchema) }).default({ checkpoints: [], gateResults: [], skippedTasks: [], skippedGates: [] }),
  checkpoints: z.array(RunCheckpointRecordSchema),
  children: z.array(z.strictObject({ nodeId: NodeIdSchema, parentRunId: RunIdSchema, edgeId: DelegationEdgeIdSchema,
    result: RunResultRecordSchema, results: z.array(RunResultRecordSchema).max(16), checkpoints: z.array(RunCheckpointRecordSchema).max(256) })).max(16).optional(),
  /** A false descriptor condition, re-evaluated by the collector; no operator fact. */
  skippedGates: z.array(GateIdSchema).default([]),
  skippedTasks: z.array(NodeIdSchema).default([]),
    /* A GATE dependency's durable evidence: a gate produces an operator decision, not a checkpoint row, so it is admitted as its own kind of upstream evidence contributing one `operator`-sourced fact. */
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
  for (const [index, nodeId] of evidence.skippedTasks.entries()) {
    if (checkpointNodes.has(nodeId) || evidence.skippedTasks.indexOf(nodeId) !== index
      || evidence.skippedGates.some((gateId) => String(gateId) === String(nodeId))
      || evidence.gateResults.some((gate) => String(gate.gateId) === String(nodeId))) {
      context.addIssue({ code: "custom", path: ["skippedTasks", index], message: `duplicate upstream evidence for node ${nodeId}` });
    }
  }
  const childNodes = new Set<string>();
  for (const child of evidence.children ?? []) {
    if (childNodes.has(child.nodeId) || checkpointNodes.has(child.nodeId) || evidence.skippedTasks.includes(child.nodeId)
      || evidence.skippedGates.some((gateId) => String(gateId) === String(child.nodeId))) context.addIssue({ code: "custom", message: "duplicate child upstream evidence" });
    childNodes.add(child.nodeId);
  }
  const gateNodes = new Set<string>();
  for (const [index, gate] of evidence.gateResults.entries()) {
    if (gateNodes.has(gate.gateId) || checkpointNodes.has(gate.gateId) || childNodes.has(gate.gateId)) {
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
