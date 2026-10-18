/** The `RunEnvelope` — kernel-owned state beside the workflow-constant input: `dryRun` lives here, requested is not resolved, and resume affordances are attempt-scoped. */
import { SourceBoundRunSchema } from "./rerun.js";
import { z } from "zod";
import {
  BrowserSystemIdSchema,
  ConfigSnapshotIdSchema,
  DelegationEdgeIdSchema,
  FingerprintSchema,
  IsoInstantSchema,
  ItemIdSchema,
  NodeIdSchema,
  PositiveIntSchema,
  RunIdSchema,
  TraceIdSchema,
  WorkflowIdSchema,
} from "../../rules/identity/ids.js";
import { CheckpointPatchSchema, FreshnessOverrideSchema } from "../workflow/checkpoint.js";
import {
  WorkflowOperationDisplaySnapshotSchema,
  requireWorkflowOperationDisplaySnapshot,
} from "../workflow/operation-display-snapshot.js";
import { StepOmissionsSchema } from "../workflow/step-omission.js";

export const SystemInstanceSchema = z.enum(["prod", "test"]);
export type SystemInstance = z.infer<typeof SystemInstanceSchema>;

/** The SHAPE axis (ref dashboard-surfaces ) — stamped once at enqueue, never recomputed. */
export const RunShapeSchema = z.enum(["single", "preview", "operation", "operation-member"]);
export type RunShape = z.infer<typeof RunShapeSchema>;


/** Server-stamped from the run surface; children inherit their root's value. */
export const RunPrioritySchema = z.enum(["interactive", "bulk"]);
export type RunPriority = z.infer<typeof RunPrioritySchema>;

/** The browser presentation the operator chose for this immutable run. */
export const BrowserPresentationModeSchema = z.enum(["headless", "headed"]);
export type BrowserPresentationMode = z.infer<typeof BrowserPresentationModeSchema>;

/** A partial map over the closed browser-system set, so an unknown system id fails rather than riding along. */
export const InstanceSelectionSchema = z.partialRecord(BrowserSystemIdSchema, SystemInstanceSchema);
export type InstanceSelection = z.infer<typeof InstanceSelectionSchema>;

/** The operator's recovery choice for a NEW attempt: absent replays valid checkpoint ancestors, `restart-from-start` re-executes every read and computation. */
export const RunRecoveryModeSchema = z.enum(["restart-from-start"]);
export type RunRecoveryMode = z.infer<typeof RunRecoveryModeSchema>;

export const RunParentSchema = z.strictObject({
  runId: RunIdSchema,
  tracePrefix: TraceIdSchema,
  edgeId: DelegationEdgeIdSchema,
});
export type RunParent = z.infer<typeof RunParentSchema>;

export const RunEnvelopeSchema = z.strictObject({
  runId: RunIdSchema,
  workflow: WorkflowIdSchema,
  /** The logical-item key half: `(workflow, itemId)` — ref workflow-model. */
  itemId: ItemIdSchema,
  /** Frozen at enqueue; the join key for spans, notes, and the ledger. */
  traceId: TraceIdSchema,
  descriptorVersion: PositiveIntSchema,
  contractFingerprint: FingerprintSchema,
    /* Stamped for older enqueues so a missing complete snapshot cannot be quietly read as a legacy run. */
  operationDisplayCapability: z.enum(["legacy", "complete"]).optional(),
    /** Present only for a complete display minted with this exact run. */
  operationDisplaySnapshot: WorkflowOperationDisplaySnapshotSchema.optional(),
  requestedInstance: InstanceSelectionSchema.optional(),
  resolvedInstance: InstanceSelectionSchema,
  configFingerprint: FingerprintSchema,
  configSnapshotId: ConfigSnapshotIdSchema,
  parent: RunParentSchema.optional(),
  shape: RunShapeSchema,
  priority: RunPrioritySchema,
    /** The ONLY home of this flag. */
  dryRun: z.boolean(),
  /** Optional only so historical authority rows remain readable. */
  browserMode: BrowserPresentationModeSchema.optional(),
  /** Optional only so historical authority rows remain readable. */
  captureBrowserScreenshots: z.boolean().optional(),
    /** The steps this run omits, with the operator's typed facts; absent means every step runs. */
  stepOmissions: StepOmissionsSchema.optional(),
    /** Present only on a Restart-from-start attempt; carried unchanged through a requeue. */
  recovery: RunRecoveryModeSchema.optional(),
  sourceBound: SourceBoundRunSchema.optional(),
  /** A resumable graph-node id, never an internal transaction arm (ref workflow-model ). */
  startAt: NodeIdSchema.optional(),
  injected: z.array(CheckpointPatchSchema).min(1).optional(),
  freshnessOverride: z.array(FreshnessOverrideSchema).min(1).optional(),
  retryOf: RunIdSchema.optional(),
    /* The attempt at the ITEM, not at this run: every component of the `(workflow, itemId)` checkpoint key is item-scoped, so a new run for an item takes the item's NEXT attempt. */
  attempt: PositiveIntSchema,
  enqueuedAt: IsoInstantSchema,
}).superRefine((envelope, context) => {
  if (envelope.operationDisplayCapability === "complete" && envelope.operationDisplaySnapshot === undefined) {
    context.addIssue({
      code: "custom",
      path: ["operationDisplaySnapshot"],
      message: `complete run ${envelope.workflow} is missing its frozen operation display snapshot`,
    });
  }
  if (envelope.operationDisplayCapability === "legacy" && envelope.operationDisplaySnapshot !== undefined) {
    context.addIssue({
      code: "custom",
      path: ["operationDisplaySnapshot"],
      message: `legacy run ${envelope.workflow} cannot carry a complete operation display snapshot`,
    });
  }
  if (envelope.operationDisplaySnapshot !== undefined) {
    try {
      requireWorkflowOperationDisplaySnapshot(envelope.operationDisplaySnapshot, {
        workflowId: envelope.workflow,
        definitionFingerprint: envelope.contractFingerprint,
      });
    } catch (error) {
      context.addIssue({
        code: "custom",
        path: ["operationDisplaySnapshot"],
        message: error instanceof Error ? error.message : "operation display snapshot is corrupt",
      });
    }
  }
  if (envelope.retryOf === envelope.runId) {
    context.addIssue({ code: "custom", path: ["retryOf"], message: "a run cannot be a cross-run retry of itself" });
  }
  if (envelope.parent?.runId === envelope.runId) {
    context.addIssue({ code: "custom", path: ["parent", "runId"], message: "a run cannot be its own parent" });
  }
  for (const [system, requested] of Object.entries(envelope.requestedInstance ?? {})) {
    const resolved = envelope.resolvedInstance[BrowserSystemIdSchema.parse(system)];
    if (resolved === undefined) {
      context.addIssue({
        code: "custom",
        path: ["resolvedInstance", system],
        message: `${system} was requested but enqueue resolved no instance for it`,
      });
      continue;
    }
    if (resolved !== requested) {
      context.addIssue({
        code: "custom",
        path: ["resolvedInstance", system],
        message: `${system} was requested as ${requested} but resolved to ${resolved}`,
      });
    }
  }
  for (const [index, override] of (envelope.freshnessOverride ?? []).entries()) {
    if (override.validForAttempt !== envelope.attempt) {
      context.addIssue({
        code: "custom",
        path: ["freshnessOverride", index, "validForAttempt"],
        message: `freshness override is scoped to attempt ${String(override.validForAttempt)} but this run is attempt ${String(envelope.attempt)}`,
      });
    }
  }
  if (envelope.injected !== undefined) {
        // Patched nodes replay; the executor refuses patches on nodes it will execute.
    const seen = new Set<string>();
    for (const [index, patch] of envelope.injected.entries()) {
      const key = `${patch.nodeId}\u0000${patch.fieldPath}`;
      if (seen.has(key)) {
        context.addIssue({
          code: "custom",
          path: ["injected", index],
          message: `two patches target ${patch.nodeId}.${patch.fieldPath}`,
        });
      }
      seen.add(key);
      if (patch.nodeId === envelope.startAt) {
        context.addIssue({
          code: "custom",
          path: ["injected", index, "nodeId"],
          message: `${patch.nodeId} is the entry node and will re-run; only upstream checkpoints may be patched`,
        });
      }
    }
  }
});
export type RunEnvelope = z.infer<typeof RunEnvelopeSchema>;

/** The envelope for the next attempt with every single-resume affordance gone, and with `nextAttempt` supplied by authority, never computed. */
export function nextAttemptEnvelope(envelope: RunEnvelope, nextAttempt: number): RunEnvelope {
  const { startAt, injected, freshnessOverride, ...carried } = envelope;
  void startAt;
  void injected;
  void freshnessOverride;
  const advanced = PositiveIntSchema.parse(nextAttempt);
  if (advanced <= carried.attempt) {
    throw new Error(
      `run ${carried.runId} is at attempt ${String(carried.attempt)} and cannot requeue into attempt `
      + `${String(advanced)}; an item's attempt counter only advances`,
    );
  }
  return RunEnvelopeSchema.parse({ ...carried, attempt: advanced });
}
