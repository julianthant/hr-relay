import type { ActivityWorkflow, SuccessfulRunTiming } from './activity-view-model.js';

export function successfulRunSeconds(timing: SuccessfulRunTiming): number | null {
  if (!Number.isInteger(timing.measured) || timing.measured < 0 || !Number.isInteger(timing.unmeasured) || timing.unmeasured < 0
    || timing.totalSeconds !== null && (!Number.isFinite(timing.totalSeconds) || timing.totalSeconds < 0)) {
    throw new Error('ACTIVITY_TIMING_INVALID');
  }
  if (timing.measured === 0 || timing.totalSeconds === null) return null;
  return timing.totalSeconds / timing.measured;
}

export function workflowDurationChart(workflows: readonly ActivityWorkflow[]) {
  const rows = workflows.map(workflow => {
    if (workflow.successfulTiming.measured + workflow.successfulTiming.unmeasured !== workflow.completed) throw new Error('ACTIVITY_TIMING_COVERAGE_INVALID');
    return { ...workflow, averageSeconds: successfulRunSeconds(workflow.successfulTiming) };
  })
    .sort((left, right) => (right.averageSeconds ?? -1) - (left.averageSeconds ?? -1));
  const longest = Math.max(0, ...rows.map(row => row.averageSeconds ?? 0));
  const interval = [1, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600].find(seconds => seconds >= longest / 4)
    ?? Math.ceil(longest / 4 / 3600) * 3600;
  const scaleSeconds = longest === 0 ? 60 : interval * 4;
  return {
    rows: rows.map(row => ({ ...row, widthPercent: row.averageSeconds === null ? null : row.averageSeconds / scaleSeconds * 100 })),
    ticks: Array.from({ length: 5 }, (_, index) => index * scaleSeconds / 4),
  };
}
