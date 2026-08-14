/**
 * The executor's REQUIRED span-emission port (doc 02 §6 semantics; doc 03 §1.1
 * identities).
 *
 * The JSONL span writer, SQLite projection, and SSE transport are the 1g-spine
 * deliverable; this module deliberately ships **no default and no no-op
 * emitter** — the same principle as the provenance lesson. A worker loop that
 * could run with a silently absent emitter would make every timeline, gate
 * park, and attempt chip unreconstructable after the fact, so composition must
 * hand the executor a real sink and tests must hand it a recording fake.
 *
 * Identity follows doc 03 §1.1 exactly: run/task spans are addressed by
 * `(runId, attempt, spanPath)` and worker/browser spans by
 * `(workerId, spanPath)`; the spanPath grammar is doc 02 §6's readable path
 * style (`pl-104233-9f3e`, `pl-104233-9f3e/searching#2`,
 * `worker/person-lookup/worker-1`). The wire's process-level fields (`pid`)
 * belong to the writer, not to this port.
 */
import { z } from "zod";
import {
  BrowserSessionIdSchema,
  BrowserSystemIdSchema,
  FailureIdSchema,
  GateIdSchema,
  IsoInstantSchema,
  NodeIdSchema,
  PositiveIntSchema,
  RunIdSchema,
  TraceIdSchema,
  WorkerIdSchema,
  WorkflowIdSchema,
} from "../domain/ids.js";
import type {
  BrowserSessionId,
  BrowserSystemId,
  NodeId,
  TraceId,
  WorkerId,
  WorkflowId,
} from "../domain/ids.js";
import { RequeueCauseSchema } from "../domain/run/record.js";

const SpanPathSchema = z.string().min(1);

/** Doc 03 §1.1's task/run outcome vocabulary; `skipped` is a task-span outcome. */
export const SpanOutcomeSchema = z.enum([
  "done",
  "failed",
  "cancelled",
  "discarded",
  "skipped",
  "interrupted",
  "superseded",
]);
export type SpanOutcome = z.infer<typeof SpanOutcomeSchema>;

/**
 * Why a `skipped` task span did not run — the same closed vocabulary the
 * durable result uses (`TerminalNotRunReasonSchema`, doc 02 §5.5). The
 * timeline reads this; it never re-derives a skip reason from a descriptor.
 */
export const SpanNotRunReasonSchema = z.enum(["condition-false", "branch-not-selected"]);

/** Run/task span identity — `(runId, attempt, spanPath)` (doc 03 §1.1). */
const RunSpanIdentityFields = {
  runId: RunIdSchema,
  attempt: PositiveIntSchema,
  traceId: TraceIdSchema,
  spanPath: SpanPathSchema,
  parentSpanPath: SpanPathSchema.optional(),
} as const;

/** Worker/browser span identity — `(workerId, spanPath)` (doc 03 §1.1). */
const WorkerSpanIdentityFields = {
  workerId: WorkerIdSchema,
  spanPath: SpanPathSchema,
  parentSpanPath: SpanPathSchema.optional(),
} as const;

const BaseFields = {
  ts: IsoInstantSchema,
  workflow: WorkflowIdSchema,
} as const;

// A plain union on purpose: `span.started`/`span.ended` legitimately appear
// for task, run, worker, and browser identities, so `t` alone cannot be a
// unique discriminator. Every arm stays a strict object.
export const ExecutorSpanEventSchema = z.union([
  z.strictObject({
    t: z.literal("run.claimed"),
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
    /** Display-safe summary; never the only failure evidence (doc 03 §1.1). */
    errorSummary: z.string().min(1).optional(),
    /** Only on `skipped`, and only when a reason was actually recorded. */
    notRunReason: SpanNotRunReasonSchema.optional(),
  }),
  z.strictObject({
    t: z.literal("span.ended"),
    kind: z.literal("run"),
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
  /**
   * D210 / doc 01 §6.2 — "records an honest `transaction.previewed` span, and
   * ends the run at the node". It is its own event rather than a `span.ended`
   * arm because no `SpanOutcome` value is true of it: a preview is neither
   * `done` (nothing was committed) nor `skipped` (the node ran). It carries the
   * subject verdict the beat-③ observation actually reached and states the one
   * thing an operator must be able to read off the timeline — that no external
   * write was attempted.
   */
  z.strictObject({
    t: z.literal("transaction.previewed"),
    ...BaseFields,
    ...RunSpanIdentityFields,
    node: NodeIdSchema,
    subject: z.enum(["match", "mismatch", "unscoped"]),
    externalCommit: z.literal("none"),
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
  }),
]);
export type ExecutorSpanEvent = z.infer<typeof ExecutorSpanEventSchema>;

/**
 * The injected sink. `emit` is synchronous on purpose: the executor's emit
 * points sit between authority mutations, and an emitter that buffered behind
 * an await could reorder a span after the state change it describes.
 */
export interface SpanEmitter {
  emit(event: ExecutorSpanEvent): void;
}

/** Run span path: the frozen trace id itself (doc 02 §6). */
export function runSpanPath(traceId: TraceId): string {
  return traceId;
}

/**
 * Task span path: `<traceId>/<nodeId>#<claimGeneration>.<taskAttempt>`
 * (doc 02 §6, D214).
 *
 * The claim generation is what makes two executions of ONE node inside one run
 * attempt distinguishable. A gate park and its resume are two claims, and an
 * `always-rerun` node re-executes across that boundary — before D214 both
 * executions emitted the same path, so the projector's `(runId, attempt,
 * spanPath)` fold and the timeline's React seed each collapsed two genuinely
 * different executions into one (the D123 lesson, one level further in).
 *
 * The node id is still everything before the LAST `#`, which is what every
 * reader parses, so nothing that reads a stored pre-D214 stream breaks.
 */
export function taskSpanPath(
  traceId: TraceId,
  nodeId: NodeId,
  taskAttempt: number,
  claimGeneration: number,
): string {
  return `${traceId}/${nodeId}#${String(PositiveIntSchema.parse(claimGeneration))}`
    + `.${String(PositiveIntSchema.parse(taskAttempt))}`;
}

/** Worker span path: `worker/<workflow>/<workerId>` (doc 03 §1.1's example form). */
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
