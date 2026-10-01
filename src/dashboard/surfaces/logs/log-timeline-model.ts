export type LogTimelineStage = Readonly<{
  id: string;
  label: string;
  state: "completed" | "active" | "waiting" | "failed" | "pending";
  time?: string;
  durationLabel?: string;
  stepId?: string;
}>;

export const LOG_TIMELINE_STYLES = {
  completed: { label: "Completed", color: "text-ui-positive", bar: "bg-ui-positive" },
  active: { label: "In progress", color: "text-ui-info", bar: "bg-ui-info" },
  waiting: { label: "Waiting", color: "text-ui-warning", bar: "bg-[repeating-linear-gradient(45deg,var(--ui-warning)_0_4px,var(--ui-table)_4px_8px)]" },
  failed: { label: "Failed", color: "text-ui-danger", bar: "bg-ui-danger" },
  pending: { label: "Upcoming", color: "text-ui-muted", bar: "border border-ui-stroke-control bg-ui-table" },
} as const;
