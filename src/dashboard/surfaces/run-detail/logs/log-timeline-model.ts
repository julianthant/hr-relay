import type { StepInterruptWire } from "../../../../models/dashboard/projection.js";
import { stepInterruptLabel } from "../../shared/status/status-model.js";

export type LogTimelineState = "completed" | "active" | "waiting" | "failed" | "pending" | "skipped" | "cancelled";

export type LogTimelineSubstep = Readonly<{
  id: string;
  label: string;
  state: LogTimelineState;
  durationLabel?: string;
}>;

export type LogTimelineStage = Readonly<{
  id: string;
  label: string;
  state: LogTimelineState;
  time?: string;
  durationLabel?: string;
  stepId?: string;
  statusLabel?: string;
  substeps: readonly LogTimelineSubstep[];
}>;

export function pauseTimeline(timeline: readonly LogTimelineStage[], state: "running" | "pause-pending" | "paused" | "unavailable" | undefined, interrupt?: StepInterruptWire): readonly LogTimelineStage[] {
  if (state !== "paused" && state !== "pause-pending") return timeline;
  const active = timeline.findIndex(stage => stage.state === "active");
  const index = active >= 0 ? active : state === "paused" ? timeline.findLastIndex(stage => stage.state === "completed") : -1;
  const statusLabel = state === "paused" ? "Pause recorded. Resume to continue." : stepInterruptLabel(interrupt);
  return timeline.map((stage, position) => position !== index ? stage : { ...stage,
    state: state === "paused" && stage.state === "active" ? "waiting" : stage.state,
    ...(statusLabel === undefined ? {} : { statusLabel }) });
}

export const LOG_TIMELINE_STYLES = {
  completed: { label: "Completed", color: "text-ui-positive", bar: "bg-ui-positive" },
  active: { label: "In progress", color: "text-ui-info", bar: "bg-ui-info" },
  waiting: { label: "Waiting", color: "text-ui-warning", bar: "bg-[repeating-linear-gradient(45deg,var(--ui-warning)_0_4px,var(--ui-table)_4px_8px)]" },
  failed: { label: "Failed", color: "text-ui-danger", bar: "bg-ui-danger" },
  pending: { label: "Upcoming", color: "text-ui-muted", bar: "border border-ui-stroke-control bg-ui-table" },
  skipped: { label: "Skipped", color: "text-ui-muted", bar: "border border-ui-stroke-control bg-ui-table" },
  cancelled: { label: "Cancelled", color: "text-ui-muted", bar: "border border-ui-stroke-control bg-ui-table" },
} as const;
