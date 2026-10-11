import type { QueueStatusSchema } from "../../../models/dashboard/projection.js";
import type { RunRecord } from "../../../models/run/record.js";
import type { RunQueuedWire } from "../../../models/events/types.js";
import type { z } from "zod";

export type RunQueueStatus = z.infer<typeof QueueStatusSchema>;


const RUN_OUTCOME_STATUS = {
  done: "done",
  failed: "failed",
  cancelled: "cancelled",
  discarded: "cancelled",
  superseded: "cancelled",
  interrupted: "blocked",
} as const satisfies Record<string, RunQueueStatus>;


export function deriveRunStatus(authority: Readonly<{ lifecycle: RunRecord["lifecycle"]; cancelRequested?: boolean }>): RunQueueStatus {
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


const TASK_OUTCOME_STATE = {
  done: "done",
  failed: "failed",
  skipped: "skipped",
  cancelled: "cancelled",
  discarded: "cancelled",
  superseded: "cancelled",
  interrupted: "blocked",
} as const satisfies Record<TaskSpanOutcome, TaskExecutionState>;


export function taskStateOf(outcome: TaskSpanOutcome | undefined): TaskExecutionState {
  return outcome === undefined ? "active" : TASK_OUTCOME_STATE[outcome];
}
