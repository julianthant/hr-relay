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
