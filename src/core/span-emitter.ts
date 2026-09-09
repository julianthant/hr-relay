/**
 * The executor's REQUIRED span-emission port (ref workflow-model §6 semantics; ref dashboard-surfaces §1.1
 * identities).
 *
 * The JSONL span writer, SQLite projection, and SSE transport are the 1g-spine
 * deliverable; this module deliberately ships **no default and no no-op
 * emitter** — the same principle as the provenance lesson. A worker loop that
 * could run with a silently absent emitter would make every timeline, gate
 * park, and attempt chip unreconstructable after the fact, so composition must
 * hand the executor a real sink and tests must hand it a recording fake.
 *
 * Identity follows ref dashboard-surfaces §1.1 exactly: run/task spans are addressed by
 * `(runId, attempt, spanPath)` and worker/browser spans by
 * `(workerId, spanPath)`; the spanPath grammar is ref workflow-model §6's readable path
 * style (`pl-104233-9f3e`, `pl-104233-9f3e/searching#2`,
 * `worker/person-lookup/worker-1`). The wire's process-level fields (`pid`)
 * belong to the writer, not to this port.
 */
import { z } from "zod";
import { DiagnosticSafetyVersionSchema } from "../domain/trust/failure.js";
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
} from "../domain/ids.js";
import type {
  BrowserSessionId,
  BrowserSystemId,
  NodeId,
  TraceId,
  WorkerId,
  WorkflowId,
} from "../domain/ids.js";
import { ContractFieldPathSchema } from "../domain/contracts/base.js";
import { RedactedFieldSchema } from "../domain/redaction.js";
import { RequeueCauseSchema } from "../domain/run/record.js";

const SpanPathSchema = z.string().min(1);

/** Ref dashboard-surfaces §1.1's task/run outcome vocabulary; `skipped` is a task-span outcome. */
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
 * durable result uses (`TerminalNotRunReasonSchema`, ref workflow-model §5.5). The
 * timeline reads this; it never re-derives a skip reason from a descriptor.
 */
export const SpanNotRunReasonSchema = z.enum(["condition-false", "branch-not-selected", "operator-asserted", "step-omitted"]);

/** Run/task span identity — `(runId, attempt, spanPath)` (ref dashboard-surfaces §1.1). */
const RunSpanIdentityFields = {
  runId: RunIdSchema,
  attempt: PositiveIntSchema,
  traceId: TraceIdSchema,
  spanPath: SpanPathSchema,
  parentSpanPath: SpanPathSchema.optional(),
} as const;

/** Worker/browser span identity — `(workerId, spanPath)` (ref dashboard-surfaces §1.1). */
const WorkerSpanIdentityFields = {
  workerId: WorkerIdSchema,
  spanPath: SpanPathSchema,
  parentSpanPath: SpanPathSchema.optional(),
} as const;

const BaseFields = {
  ts: IsoInstantSchema,
  workflow: WorkflowIdSchema,
} as const;

/**
 * ONE recorded observation, redacted by DECLARATION (D270).
 *
 * `field` is the point's own recorded path — a path in the producing task's
 * output contract, which is what `ctx.recordData` accepts and what
 * `finalizeRead` validates every point against. `values` is that point's value
 * broken into evidence LEAVES (an array is one leaf, an empty object is one
 * leaf, a populated object recurses — the provenance collector's own rule) and
 * each leaf pushed through the classification `reference/operator-trust.md`
 * §2.3 declares for `(taskId, path)`. A scalar point therefore carries exactly
 * one value whose key is the field itself. An UNDECLARED leaf never reaches
 * this schema: `redactObservedDataPoints` refuses it by name, because dropping
 * it would make the log look complete while hiding what the run read.
 *
 * `direction` is carried NATIVELY because `DataPoint` has always carried it —
 * the Context rail has to DERIVE read/write from the producing node's declared
 * task-contract `effect` (D252) precisely because the checkpoint row has no
 * such field, so an observed point must not re-derive what it already holds.
 *
 * There is deliberately NO `system` field. The originating system is declared
 * by the STORE implementing the task and reaches the wire through
 * `RunDetailDescriptorView.dataOrigins`, composed at the root because a
 * descriptor may not reach a store (D106). A `system` here would be a second
 * authority over a fact the declaration already owns.
 */
export const ObservedDataPointSchema = z.strictObject({
  direction: z.enum(["read", "write"]),
  field: ContractFieldPathSchema,
  values: z.array(RedactedFieldSchema).min(1),
});
export type ObservedDataPoint = z.infer<typeof ObservedDataPointSchema>;

// A plain union on purpose: `span.started`/`span.ended` legitimately appear
// for task, run, worker, and browser identities, so `t` alone cannot be a
// unique discriminator. Every arm stays a strict object.
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
    /** Display-safe summary; never the only failure evidence (ref dashboard-surfaces §1.1). */
    errorSummary: z.string().min(1).optional(),
    diagnosticSafetyVersion: DiagnosticSafetyVersionSchema.optional(),
    /** Only on `skipped`, and only when a reason was actually recorded. */
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
  /**
   * D210 / ref task-contract §6.2 — "records an honest `transaction.previewed` span, and
   * ends the run at the node". It is its own event rather than a `span.ended`
   * arm because no `SpanOutcome` value is true of it: a preview is neither
   * `done` (nothing was committed) nor `skipped` (the node ran). It carries the
   * subject verdict the beat-③ observation actually reached and states the one
   * thing an operator must be able to read off the timeline — that no external
   * write was attempted.
   *
   * D215 — `not-observed` is the honest subject verdict when beat ①'s probe
   * settled the node `already-present` before anything was staged: no page was
   * prepared, so no subject was read, and reporting `match` for a comparison
   * nobody made would be the fabrication the whole arm exists to prevent.
   */
  z.strictObject({
    t: z.literal("transaction.previewed"),
    ...BaseFields,
    ...RunSpanIdentityFields,
    node: NodeIdSchema,
    subject: z.enum(["match", "mismatch", "unscoped", "not-observed"]),
    externalCommit: z.literal("none"),
  }),
  /**
   * A durable fence is kernel authority, not something a page said. It gets
   * its own strict arm so the observed log never fabricates a `DataPoint` for
   * it. The sequencer constructs this event before fencing, then emits it only
   * after the external commit callback has settled: span instrumentation
   * therefore cannot interrupt the fence→click critical window.
   */
  z.strictObject({
    t: z.literal("transaction.fenced"),
    ...BaseFields,
    ...RunSpanIdentityFields,
    node: NodeIdSchema,
    taskId: TaskIdSchema,
  }),
  /**
   * D270 / `03.1-finish-the-dashboard.md` §Observed logs — every point a task
   * records is captured and stamped AT RECORD TIME, so the observations a task
   * made before it threw are on the stream even though its checkpoint never
   * was. One event per `ctx.recordData` CALL: a batch is one observation of the
   * page, and `observedAt` is the single instant the collector stamped it with.
   * Probe/prepare/verify emit synchronously. Commit-role emission is the one
   * deliberate delay: its call-time batch is flushed only after the callback
   * settles, keeping fallible instrumentation out of fence→external-click.
   *
   * This is an EMISSION, not a second scrape. Nothing re-reads the page: a
   * second observation of a moving system is exactly how a surface starts
   * disagreeing with authority.
   */
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

/**
 * The injected sink. `emit` is synchronous on purpose: the executor's emit
 * points sit between authority mutations, and an emitter that buffered behind
 * an await could reorder a span after the state change it describes.
 */
export interface SpanEmitter {
  emit(event: ExecutorSpanEvent): void;
}

/** Run span path: the frozen trace id itself (ref workflow-model §6). */
export function runSpanPath(traceId: TraceId): string {
  return traceId;
}

/**
 * Task span path: `<traceId>/<nodeId>#<claimGeneration>.<taskAttempt>`
 * (ref workflow-model §6, D214).
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

/** Worker span path: `worker/<workflow>/<workerId>` (ref dashboard-surfaces §1.1's example form). */
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
