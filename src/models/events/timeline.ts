import { sha256Hex } from "../../rules/validation/sha256.js";
import type { RunCheckpointRecord } from "../workflow/checkpoint.js";
import { z } from "zod";
import { canonicalJsonStringify } from "../../rules/validation/canonical-json.js";
import { FingerprintSchema, IsoInstantSchema, ItemIdSchema, NodeIdSchema, PositiveIntSchema, RunIdSchema,
  WorkerIdSchema, WorkflowIdSchema, WriteAttemptIdSchema, FailureIdSchema, CommandIdSchema, ActorIdSchema } from "../../rules/identity/ids.js";
import { LedgerEntryPayloadSchema } from "../../rules/runs/ledger.js";
import { SpanEventWireSchema } from "./types.js";

/** A reference preserves the original observation; replay never rewrites its clock. */
export const TimelineCheckpointReferenceSchema = z.strictObject({
  workflowId: WorkflowIdSchema,
  itemId: ItemIdSchema,
  nodeId: NodeIdSchema,
  attempt: PositiveIntSchema,
  claimGeneration: PositiveIntSchema,
  runId: RunIdSchema,
  outputDigest: FingerprintSchema,
  writtenAt: IsoInstantSchema,
});

// Keep every historical ledger field except the proof already retained on the
// exact immutable attempt. The reader must resolve and authenticate that proof.
const { proof: _proof, ...historicalLedgerFields } = LedgerEntryPayloadSchema.shape;
const ConfirmedOperationFactsSchema = z.strictObject(historicalLedgerFields);

export const TimelinePayloadSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("failure-resolution"), runId: RunIdSchema, workflow: WorkflowIdSchema,
    failureId: FailureIdSchema, commandId: CommandIdSchema, actorId: ActorIdSchema,
    action: z.enum(["resolve", "reopen"]), annotationVersion: PositiveIntSchema.min(2),
    at: IsoInstantSchema,
  }),
  z.strictObject({ kind: z.literal("span"), event: SpanEventWireSchema }),
  z.strictObject({
    kind: z.enum(["checkpoint-replayed", "checkpoint-recorded"]),
    runId: RunIdSchema,
    workflow: WorkflowIdSchema,
    attempt: PositiveIntSchema,
    claimGeneration: PositiveIntSchema,
    checkpoint: TimelineCheckpointReferenceSchema,
  }),
  z.strictObject({
    kind: z.literal("operation-confirmed"),
    facts: ConfirmedOperationFactsSchema,
    writeAttemptId: WriteAttemptIdSchema,
    proofDigest: FingerprintSchema,
    checkpoint: TimelineCheckpointReferenceSchema,
    /** Original committed-span time, which is not necessarily its delivery time. */
    spanOccurredAt: IsoInstantSchema,
  }),
]);

export const TimelineAppendSchema = z.strictObject({
  schemaVersion: z.literal(1),
  eventId: z.uuid(),
  workflow: WorkflowIdSchema,
  scope: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("run"), runId: RunIdSchema }),
    z.strictObject({ kind: z.literal("worker"), workerId: WorkerIdSchema }),
  ]),
  occurredAt: IsoInstantSchema,
  recordedAt: IsoInstantSchema,
  /** Local append day. */
  retentionDate: z.iso.date(),
  payload: TimelinePayloadSchema,
  source: z.strictObject({ kind: z.literal("native") }),
}).superRefine((record, context) => {
  const payload = record.payload;
  const runId = payload.kind === "span"
    ? ("runId" in payload.event ? payload.event.runId : undefined)
    : payload.kind === "operation-confirmed" ? payload.facts.runId : payload.runId;
  const workflow = payload.kind === "span" ? payload.event.workflow
    : payload.kind === "operation-confirmed" ? payload.facts.workflowId : payload.workflow;
  if (record.workflow !== workflow
    || (runId === undefined ? record.scope.kind !== "worker"
      : record.scope.kind !== "run" || record.scope.runId !== runId)) {
    context.addIssue({ code: "custom", message: "timeline scope must match its exact event identity" });
  }
  if (payload.kind === "failure-resolution" && (record.occurredAt !== payload.at
    || record.recordedAt !== payload.at || record.source.kind !== "native")) {
    context.addIssue({ code: "custom", message: "failure resolution must bind its command time and native source" });
  }
  if (payload.kind === "span") {
    if (record.occurredAt !== payload.event.ts || (record.scope.kind === "worker"
      && (!("workerId" in payload.event) || record.scope.workerId !== payload.event.workerId))) {
      context.addIssue({ code: "custom", message: "timeline time/worker must match its span" });
    }
  }
  if (payload.kind === "checkpoint-recorded" && (payload.checkpoint.runId !== payload.runId
    || payload.checkpoint.workflowId !== payload.workflow || payload.checkpoint.attempt !== payload.attempt
    || payload.checkpoint.claimGeneration !== payload.claimGeneration || record.occurredAt !== payload.checkpoint.writtenAt)) {
    context.addIssue({ code: "custom", message: "recorded checkpoint must bind its original execution and time" });
  }
  if (payload.kind === "checkpoint-replayed" && (payload.checkpoint.workflowId !== payload.workflow
    || payload.checkpoint.attempt > payload.attempt)) {
    context.addIssue({ code: "custom", message: "checkpoint replay must reference the same workflow and a prior or current attempt" });
  }
  if (payload.kind === "operation-confirmed") {
    if (record.occurredAt !== payload.facts.confirmedAt
      || payload.checkpoint.runId !== payload.facts.runId
      || payload.checkpoint.workflowId !== payload.facts.workflowId
      || payload.checkpoint.itemId !== payload.facts.itemId
      || payload.checkpoint.attempt !== payload.facts.attempt) {
      context.addIssue({ code: "custom", message: "confirmed history must bind its exact checkpoint and confirmation" });
    }
  }
});

/** The database assigns delivery order. It is not a cross-process causal clock. */
export const TimelineEventRecordSchema = TimelineAppendSchema.safeExtend({ cursor: PositiveIntSchema });
export type TimelineAppend = z.infer<typeof TimelineAppendSchema>;
export type TimelineEventRecord = z.infer<typeof TimelineEventRecordSchema>;

export function timelineAppendContent(record: TimelineEventRecord): string {
  const { cursor: _cursor, ...content } = record;
  return canonicalJsonStringify(content);
}

export const TimelinePageRequestSchema = z.strictObject({
  after: z.number().int().nonnegative().default(0),
  through: z.number().int().nonnegative().optional(),
  limit: z.number().int().min(1).max(1000).default(500),
  runId: RunIdSchema.optional(),
  workflow: WorkflowIdSchema.optional(),
});

export interface TimelineRepository {
  withReadSnapshot<T>(read: () => T): T;
  append(input: unknown): Readonly<{ state: "inserted" | "existing"; record: TimelineEventRecord }>;
  get(eventId: string): TimelineEventRecord | undefined;
  page(input: z.input<typeof TimelinePageRequestSchema>): readonly TimelineEventRecord[];
  highWaterMark(): number;
  pruneBefore(retentionDate: string): number;
}

export function timelineCheckpointReference(checkpoint: RunCheckpointRecord) {
  return { workflowId: checkpoint.workflowId, itemId: checkpoint.itemId, nodeId: checkpoint.nodeId,
    attempt: checkpoint.attempt, claimGeneration: checkpoint.claimGeneration,
    runId: checkpoint.runId, outputDigest: sha256Hex(canonicalJsonStringify(checkpoint.output)), writtenAt: checkpoint.writtenAt };
}

