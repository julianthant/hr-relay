/**
 * D268 — the ONE derivation of what a run IS, and of what one of its steps DID.
 *
 * Ref dashboard-surfaces §2.3 says there is one projection; it did not say
 * there is one derivation, and by 2026-08-20 there were two of each. The queue
 * row's status came from the projector's own `#status`, which reads the span
 * fold's `ended` and `claimedBy` beside the authority lifecycle; the run-detail
 * panel's came from a private `statusOf` that had NEITHER arm and inlined its
 * own copy of the outcome map. In production the two never disagree over
 * TIMING: `run-executor.ts` settles the authority CAS
 * (`terminalizeFailure`/`terminalizeSuccess`) and only then emits the run's
 * `span.ended` (`:517-529`, `:618-624`), and `worker-loop.ts` claims the run
 * and only then emits `run.claimed` (`:258` before `:286`) — authority leads,
 * the fold lags by however long the projector's disk tail takes to ingest the
 * line. The window this file used to describe — a fold reading
 * `ended`/`claimedBy` before authority reflects it — is reachable only
 * through the test harness, which writes span events directly to the stream
 * and can order them however a case needs. What WAS live is the vocabulary
 * split one level down.
 *
 * The task half was the same defect one level down: `TASK_OUTCOME_PIPELINE`
 * mapped `cancelled`/`discarded` to `blocked` and `TASK_OUTCOME_STEP` mapped
 * them to `cancelled`, so one span read as two different things depending on
 * which surface drew it.
 *
 * **Why this file and not the projector.** `run-queue-projection.ts`
 * value-imports `src/base/workflow.ts` for its descriptor helpers, and
 * `queries/archive.ts` value-imports `queries/run-detail.ts` — so a run-detail
 * that reached into the projector for these three helpers would drag the
 * workflow registry into the archived-run read path, which `archive-invariants`
 * correctly refuses (D179: an archived run renders with the originating
 * descriptor absent). The same argument that put `nodeIdOfTaskSpanPath` in
 * `support.ts` puts these here: pure derivations, one home, no layer inversion,
 * and both callers type-import their fold shape rather than this module
 * importing theirs.
 */
import type { QueueStatusSchema } from "../../domain/dashboard/projection.js";
import type { RunRecord } from "../../domain/run/record.js";
import type { RunQueuedWire } from "../../events/types.js";
import type { z } from "zod";

export type RunQueueStatus = z.infer<typeof QueueStatusSchema>;

/**
 * The run-level outcome vocabulary: a settled run's own outcome word, as the
 * status a surface prints.
 *
 * `interrupted` is the one arm that is not a rename. The run stopped without a
 * settled verdict — ref write-safety recovery will requeue or settle it — so
 * calling it `cancelled` or `failed` would claim a verdict nobody reached, and
 * `blocked` is the state that says "stopped, not decided".
 */
const RUN_OUTCOME_STATUS = {
  done: "done",
  failed: "failed",
  cancelled: "cancelled",
  discarded: "cancelled",
  superseded: "cancelled",
  interrupted: "blocked",
} as const satisfies Record<string, RunQueueStatus>;

/**
 * The two fold fields this derivation reads beside the authority record, named
 * structurally so the derivation does not have to import the projector's own
 * `RunFoldRecord` (see the file note above). Every caller passes that record;
 * the compiler checks the fields at each call site.
 */
export interface RunStatusFold {
  /** The run's OWN `span.ended`, folded from the stream (may precede the CAS). */
  readonly ended?: { readonly outcome: keyof typeof RUN_OUTCOME_STATUS } | undefined;
  /** Gates the stream shows open and unresolved. */
  readonly openGates: readonly { readonly gate: string }[];
  /** The worker id a `run.claimed` span named, if one has been folded. */
  readonly claimedBy?: string | undefined;
}

/**
 * What a run IS, from authority joined with its span fold — the ONE answer the
 * queue row, the day wire's counts, the linked-run chips and the run-detail
 * panel all print.
 *
 * The arms are ordered by how much each source can prove:
 *
 * 1. **Authority terminal wins outright.** A terminal lifecycle is written by
 *    the terminal-authority contract inside the transaction that settles the
 *    run; nothing in the span stream outranks it.
 * 2. **The run's own `span.ended` is next.** In production it is emitted
 *    AFTER the authority CAS that settles the run (`run-executor.ts` calls
 *    `terminalizeFailure`/`terminalizeSuccess` before emitting), so this arm
 *    never outranks arm 1 live — the fold catches up to authority, never the
 *    other way round. It stays second anyway: this is the ONE place both
 *    surfaces read, and a fold that could show `ended` out of turn (a
 *    replay, a rebuilt projection, the test harness writing spans straight
 *    to the stream) must still resolve to the word authority would settle
 *    on, never a competing verdict.
 * 3. **A parked write is `blocked`, a parked gate or any open gate span is
 *    `awaiting-approval`** — the lifecycle and the stream agree on these and
 *    either is sufficient.
 * 4. **A claimed/validating/running lifecycle, or a folded `claimedBy`, is
 *    `running`.** `worker-loop.ts` claims the run — the CAS — before it
 *    emits `run.claimed`, so the same is true here: authority reaches
 *    `claimed` first, and `claimedBy` is a fallback for a fold read out of
 *    that order, not a description of the live path.
 * 5. Otherwise `queued`.
 *
 * `partial` is deliberately unreachable here: it is a RESULT verdict (a
 * receipt's, D238), not a lifecycle, and deriving it from a lifecycle would be
 * a second opinion about a run's completeness.
 */
export function deriveRunStatus(row: RunStatusFold, authority: RunRecord): RunQueueStatus {
  const { lifecycle } = authority;
  if (lifecycle.state === "terminal") return RUN_OUTCOME_STATUS[lifecycle.outcome];
  if (row.ended !== undefined) return RUN_OUTCOME_STATUS[row.ended.outcome];
  if (lifecycle.state === "parked-write") return "blocked";
  if (lifecycle.state === "parked-gate" || row.openGates.length > 0) return "awaiting-approval";
  if (lifecycle.state === "claimed" || lifecycle.state === "validating" || lifecycle.state === "running") return "running";
  if (row.claimedBy !== undefined) return "running";
  return "queued";
}

/** Which panel a row's enqueued SHAPE opens — one mapping, two readers. */
export function panelKindOf(shape: RunQueuedWire["shape"]): "run" | "member" | "group" {
  if (shape === "operation") return "group";
  if (shape === "operation-member") return "member";
  return "run";
}

/** The outcome vocabulary a folded task span can carry. */
export type TaskSpanOutcome =
  | "done" | "failed" | "cancelled" | "discarded" | "skipped" | "interrupted" | "superseded";

/** What ONE execution of a node did, in the words both surfaces print. */
export type TaskExecutionState = "active" | "done" | "failed" | "skipped" | "cancelled" | "blocked";

/**
 * The task-level outcome vocabulary — ONE mapping, for the pipeline chip and
 * the timeline step alike (D268).
 *
 * It is the run-level map above, one level down, and deliberately so: a span
 * outcome and a run outcome are the same seven words, so answering them
 * differently was never a distinction anyone could defend. Two arms carry the
 * argument.
 *
 * - `cancelled`/`discarded`/`superseded` → **`cancelled`**. D123's rule is that
 *   a word names what happened, and `Cancelled` names an act somebody took —
 *   which is exactly what all three of these are (an operator cancelled the
 *   run, a plan discarded the item, a later run superseded it). The retired
 *   pipeline reading, `blocked`, named no act at all and collided with
 *   `interrupted`, whose whole point is that nobody decided anything.
 * - `skipped` stays its OWN arm, per D123: the live exit run rendered a
 *   `condition-false` branch as "Cancelled", which claimed an act nobody took.
 *
 * `interrupted` → `blocked` for the run-level reason: the execution stopped
 * without a verdict.
 */
const TASK_OUTCOME_STATE = {
  done: "done",
  failed: "failed",
  skipped: "skipped",
  cancelled: "cancelled",
  discarded: "cancelled",
  superseded: "cancelled",
  interrupted: "blocked",
} as const satisfies Record<TaskSpanOutcome, TaskExecutionState>;

/**
 * The state of ONE execution of a node. An outcome that has not been folded
 * yet is `active` — the span started and no end has arrived — which is a fact
 * about the span, not a default standing in for a missing one. A node with NO
 * span at all is `pending` (or `replayed`), and that is the caller's question:
 * this function is only ever asked about a span that exists.
 */
export function taskStateOf(outcome: TaskSpanOutcome | undefined): TaskExecutionState {
  return outcome === undefined ? "active" : TASK_OUTCOME_STATE[outcome];
}
