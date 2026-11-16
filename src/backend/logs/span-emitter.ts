
import { z } from "zod";
import { DataObservationOriginsSchema } from "../../models/events/data-observation-origin.js";
import { DiagnosticSafetyVersionSchema } from "../../models/trust/failure.js";
import {
  BrowserSessionIdSchema,
  BrowserSystemIdSchema,
  FailureIdSchema,
  GateIdSchema,
  IsoInstantSchema,
  NodeIdSchema,
  PositiveIntSchema,
  RunIdSchema,
  TaskIdSchema,
  TraceIdSchema,
  WorkerIdSchema,
  WorkflowIdSchema,
} from "../../rules/identity/ids.js";
import type {
  BrowserSessionId,
  BrowserSystemId,
  NodeId,
  TraceId,
  WorkerId,
  WorkflowId,
} from "../../rules/identity/ids.js";
import { ContractFieldPathSchema } from "../../models/task/task-contract.js";
import { RedactedFieldSchema } from "../../rules/redaction/redaction.js";
import { RequeueCauseSchema } from "../../models/run/record.js";

const SpanPathSchema = z.string().min(1);

/** Ref dashboard-surfaces's task/run outcome vocabulary; `skipped` is a task-span outcome. */
export const SpanOutcomeSchema = z.enum([
  "done",
  "failed",
  "cancelled",
  "discarded",
  "skipped",
  "interrupted",
  "superseded",
]);


export const SpanNotRunReasonSchema = z.enum(["condition-false", "branch-not-selected", "operator-asserted", "step-omitted"]);

/** Run/task span identity — `(runId, attempt, spanPath)` (ref dashboard-surfaces ). */
const RunSpanIdentityFields = {
  runId: RunIdSchema,
  attempt: PositiveIntSchema,
  traceId: TraceIdSchema,
  spanPath: SpanPathSchema,
  parentSpanPath: SpanPathSchema.optional(),
} as const;

/** Worker/browser span identity — `(workerId, spanPath)` (ref dashboard-surfaces ). */
const WorkerSpanIdentityFields = {
  workerId: WorkerIdSchema,
  spanPath: SpanPathSchema,
  parentSpanPath: SpanPathSchema.optional(),
} as const;

const BaseFields = {
  ts: IsoInstantSchema,
  workflow: WorkflowIdSchema,
} as const;


export const ObservedDataPointSchema = z.strictObject({
  direction: z.enum(["read", "write"]),
  field: ContractFieldPathSchema,
  values: z.array(RedactedFieldSchema).min(1),
  origins: DataObservationOriginsSchema.optional(),
});
export type ObservedDataPoint = z.infer<typeof ObservedDataPointSchema>;

// Span kinds share `t` across identities, so `t` cannot discriminate the union.
export const ExecutorSpanEventSchema = z.union([
  z.strictObject({
    t: z.literal("run.claimed"),
    claimGeneration: PositiveIntSchema.optional(),
    ...BaseFields,
    ...RunSpanIdentityFields,
    workerId: WorkerIdSchema,
  }),
  z.strictObject({
    t: z.literal("run.requeued"),
    ...BaseFields,
    ...RunSpanIdentityFields,
    cause: RequeueCauseSchema,
    nextAttempt: PositiveIntSchema,
  }),
  z.strictObject({
    t: z.literal("span.started"),
    kind: z.literal("task"),
    ...BaseFields,
    ...RunSpanIdentityFields,
    name: z.string().min(1),
    system: BrowserSystemIdSchema.optional(),
  }),
  z.strictObject({
    t: z.literal("span.ended"),
    kind: z.literal("task"),
    ...BaseFields,
    ...RunSpanIdentityFields,
    outcome: SpanOutcomeSchema,
    failureId: FailureIdSchema.optional(),
    /** Display-safe summary; never the only failure evidence (ref dashboard-surfaces ). */
    errorSummary: z.string().min(1).optional(),
    diagnosticSafetyVersion: DiagnosticSafetyVersionSchema.optional(),

    notRunReason: SpanNotRunReasonSchema.optional(),
  }),
  z.strictObject({
    t: z.literal("span.ended"),
    kind: z.literal("run"),
    workerId: WorkerIdSchema.optional(),
    claimGeneration: PositiveIntSchema.optional(),
    ...BaseFields,
    ...RunSpanIdentityFields,
    outcome: SpanOutcomeSchema,
    failureId: FailureIdSchema.optional(),
  }),
  z.strictObject({
    t: z.literal("gate.opened"),
    ...BaseFields,
    ...RunSpanIdentityFields,
    gate: GateIdSchema,
  }),
  // Preview is its own event because no task settlement outcome truthfully describes it.
  z.strictObject({
    t: z.literal("transaction.previewed"),
    ...BaseFields,
    ...RunSpanIdentityFields,
    node: NodeIdSchema,
    subject: z.enum(["match", "mismatch", "unscoped", "not-observed"]),
    externalCommit: z.literal("none"),
  }),
  // A durable fence is kernel authority, not a page observation or synthetic DataPoint.
  z.strictObject({
    t: z.literal("transaction.fenced"),
    ...BaseFields,
    ...RunSpanIdentityFields,
    node: NodeIdSchema,
    taskId: TaskIdSchema,
  }),

  z.strictObject({
    t: z.literal("data.observed"),
    ...BaseFields,
    ...RunSpanIdentityFields,
    nodeId: NodeIdSchema,
    taskId: TaskIdSchema,
    observedAt: IsoInstantSchema,
    points: z.array(ObservedDataPointSchema).min(1),
  }),
  z.strictObject({
    t: z.literal("span.started"),
    kind: z.enum(["worker", "browser"]),
    ...BaseFields,
    ...WorkerSpanIdentityFields,
    name: z.string().min(1),
    system: BrowserSystemIdSchema.optional(),
  }),
  z.strictObject({
    t: z.literal("span.ended"),
    kind: z.enum(["worker", "browser"]),
    ...BaseFields,
    ...WorkerSpanIdentityFields,
    outcome: SpanOutcomeSchema,
    errorSummary: z.string().min(1).optional(),
    diagnosticSafetyVersion: DiagnosticSafetyVersionSchema.optional(),
  }),
]);
export type ExecutorSpanEvent = z.infer<typeof ExecutorSpanEventSchema>;

// Emit synchronously between authority mutations; buffering would reorder evidence.
export interface SpanEmitter {
  emit(event: ExecutorSpanEvent): void;
}

/** Run span path: the frozen trace id itself (ref workflow-model ). */
export function runSpanPath(traceId: TraceId): string {
  return traceId;
}

// Claim generation distinguishes repeated node executions within one run attempt.
export function taskSpanPath(
  traceId: TraceId,
  nodeId: NodeId,
  taskAttempt: number,
  claimGeneration: number,
): string {
  return `${traceId}/${nodeId}#${String(PositiveIntSchema.parse(claimGeneration))}`
    + `.${String(PositiveIntSchema.parse(taskAttempt))}`;
}

/** Worker span path: `worker/<workflow>/<workerId>` (ref dashboard-surfaces's example form). */
export function workerSpanPath(workflowId: WorkflowId, workerId: WorkerId): string {
  return `worker/${workflowId}/${workerId}`;
}

/** Browser-session span path under its owning worker span. */
export function browserSessionSpanPath(
  workflowId: WorkflowId,
  workerId: WorkerId,
  system: BrowserSystemId,
  sessionId: BrowserSessionId,
): string {
  BrowserSystemIdSchema.parse(system);
  BrowserSessionIdSchema.parse(sessionId);
  return `${workerSpanPath(workflowId, workerId)}/browser:${system}#${sessionId}`;
}
