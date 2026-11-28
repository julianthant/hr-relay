import type { ActivitySuccessfulTiming } from "../../../models/dashboard/activity-population.js";
import type { ActivityWorkflowTotal } from "../../../models/dashboard/activity.js";
import type { TimelineEventRecord } from "../../../models/events/timeline.js";
import type { RunRecord } from "../../../models/run/record.js";
import { RunIdSchema } from "../../../rules/identity/ids.js";

export type ActivityTimingSource = Readonly<{
  runTimingRows(runIds: readonly string[]): readonly TimelineEventRecord[];
}>;

export function readActivityDurations(source: ActivityTimingSource, runs: readonly RunRecord[]): ReadonlyMap<string, number> {
  const terminals = new Map(runs.flatMap(run => run.lifecycle.state === "terminal"
    ? [[run.envelope.runId, { envelope: run.envelope, outcome: run.lifecycle.outcome, endedAt: Date.parse(run.lifecycle.endedAt) }] as const] : []));
  const queued = new Map<string, number>();
  const ended = new Map<string, number>();
  for (const { payload } of source.runTimingRows([...terminals.keys()])) {
    if (payload.kind !== "span") throw new Error("activity-timing-record-kind-invalid");
    const event = payload.event;
    if (event.t !== "run.queued" && (event.t !== "span.ended" || event.kind !== "run")) {
      throw new Error("activity-timing-span-kind-invalid");
    }
    const terminal = terminals.get(RunIdSchema.parse(event.runId));
    if (terminal === undefined || event.workflow !== terminal.envelope.workflow || event.traceId !== terminal.envelope.traceId
      || event.attempt > terminal.envelope.attempt) throw new Error("activity-timing-run-identity-mismatch");
    const at = Date.parse(event.ts);
    if (event.t === "run.queued" && at === Date.parse(terminal.envelope.enqueuedAt)) queued.set(event.runId, at);
    if (event.t === "span.ended" && event.attempt === terminal.envelope.attempt && event.outcome === terminal.outcome && at === terminal.endedAt) {
      ended.set(event.runId, at);
    }
  }
  const durations = new Map<string, number>();
  for (const [runId, start] of queued) {
    const end = ended.get(runId);
    if (end !== undefined && end >= start) durations.set(runId, end - start);
  }
  return durations;
}

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
