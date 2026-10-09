import type { QueueStatusSchema } from "../../../models/dashboard/projection.js";
import type { RunRecord } from "../../../models/run/record.js";
import type { RunQueuedWire } from "../../../models/events/types.js";
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

/** D330: lifecycle comes only from the canonical run record. Task evidence below is separate. */
export function deriveRunStatus(authority: RunRecord): RunQueueStatus {
  const { lifecycle } = authority;
  if (lifecycle.state === "terminal") return RUN_OUTCOME_STATUS[lifecycle.outcome];
  if (lifecycle.state === "parked-write") return "blocked";
  if (lifecycle.state === "parked-gate") return "awaiting-approval";
  if (lifecycle.state === "claimed" || lifecycle.state === "validating" || lifecycle.state === "running") {
    return authority.cancelRequested === true ? "cancelling" : "running";
  }
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

type PipelineCategoryState = "pending" | TaskExecutionState;
type TimelineCategoryState = PipelineCategoryState | "replayed";

/** Fold category members loudest-first; a mixed unfinished category is pending on a terminal run. */
export function foldCategoryState(states: readonly PipelineCategoryState[], runTerminal: boolean): PipelineCategoryState;
export function foldCategoryState(states: readonly TimelineCategoryState[], runTerminal: boolean): TimelineCategoryState;
export function foldCategoryState(states: readonly TimelineCategoryState[], runTerminal: boolean): TimelineCategoryState {
  if (states.includes("failed")) return "failed";
  if (states.includes("blocked")) return "blocked";
  if (states.includes("active")) return "active";
  if (states.includes("cancelled")) return "cancelled";
  if (states.every((state) => state === "pending")) return "pending";
  if (states.every((state) => state === "replayed")) return "replayed";
  if (states.every((state) => state === "done" || state === "skipped" || state === "replayed")) {
    return states.includes("done") ? "done" : states.includes("replayed") ? "replayed" : "skipped";
  }
  return runTerminal ? "pending" : "active";
}

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
