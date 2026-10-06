import type { SuccessfulRunTiming } from './activity-view-model.js';

/** One row per workflow run; delegated child runs are outside the displayed root-run average. */
export type ActivityTimingRecord = Readonly<{
  id: string; workflowId: string; parentRunId: string | null;
  status: 'completed' | 'failed' | 'running' | 'waiting'; seconds: number | null;
}>;
export function successfulWorkflowTimings(records: readonly ActivityTimingRecord[]): ReadonlyMap<string, SuccessfulRunTiming> {
  const seen = new Set<string>();
  const groups = new Map<string, { totalSeconds: number | null; measured: number; unmeasured: number }>();
  for (const row of records) {
    if (!row.id || !row.workflowId || seen.has(row.id)) throw new Error('ACTIVITY_TIMING_RECORD_ID_INVALID');
    seen.add(row.id);
    if (row.seconds !== null && (!Number.isFinite(row.seconds) || row.seconds < 0)) throw new Error('ACTIVITY_TIMING_RECORD_INVALID');
    if (row.parentRunId !== null || row.status !== 'completed') continue;
    const group = groups.get(row.workflowId) ?? { totalSeconds: null, measured: 0, unmeasured: 0 };
    if (row.seconds === null) group.unmeasured++;
    else { group.totalSeconds = (group.totalSeconds ?? 0) + row.seconds; group.measured++; }
    groups.set(row.workflowId, group);
  }
  return groups;
}
