import type { ActivitySuccessfulTiming } from "../../../models/dashboard/activity-population.js";
import type { ActivityWorkflowTotal } from "../../../models/dashboard/activity.js";

/** Successful roots alone supply workflow averages; missing measurements never count as zero. */
export function successfulActivityTiming(workflowId: string, rows: readonly {
  workflowId: string; status: string; parentRunId: string | null; durationMs: number | null;
}[]): ActivitySuccessfulTiming {
  const successful = rows.filter(row => row.workflowId === workflowId && row.status === "done" && row.parentRunId === null);
  const measured = successful.flatMap(row => row.durationMs === null ? [] : [row.durationMs]);
  return { workflowId, measured: measured.length, unmeasured: successful.length - measured.length,
    totalMs: measured.length === 0 ? null : measured.reduce((sum, duration) => sum + duration, 0) };
}

export function activityTypicalTime(timing: ActivitySuccessfulTiming): ActivityWorkflowTotal["typicalTime"] {
  return { measure: "successful-root-run-mean", measuredRuns: timing.measured, unmeasuredRuns: timing.unmeasured,
    meanMs: timing.totalMs === null
      ? { state: "absent", reason: "no successful root run in range carries a duration" }
      : { state: "present", value: timing.totalMs / timing.measured } };
}
