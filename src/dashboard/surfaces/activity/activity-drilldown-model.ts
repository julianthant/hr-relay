import type { LogStep } from '../run-detail/logs/log-feed-model.js';
import type { LogTimelineStage } from '../run-detail/logs/log-timeline-model.js';

export type ActivityRunRecord = Readonly<{
  id: string; displayId: string; subject: string; day: string; workflowId: string; workflowLabel: string;
  status: 'completed' | 'failed' | 'running' | 'waiting'; seconds: number | null; attempt: number;
  readback: boolean | null;
  steps: readonly LogStep[]; timeline: readonly LogTimelineStage[];
}>;
export type ActivitySort = Readonly<{ column: 'name' | 'duration'; direction: 'ascending' | 'descending' }>;
export type ActivityBrowse = Readonly<{ metric: 'completed' | 'outstanding' | 'failed' | 'timed'; workflow?: string; page: number; run?: string; sort?: ActivitySort }>;
export const ACTIVITY_RUN_PAGE_SIZE = 20;
export const ACTIVITY_RUN_LABELS = { completed: 'Completed runs', outstanding: 'Outstanding runs', failed: 'Failed runs', timed: 'Timed completed runs' } as const;

export function activityDrilldownTitle(selection: ActivityBrowse, workflowLabel?: string): string {
  if (!workflowLabel) return ACTIVITY_RUN_LABELS[selection.metric];
  return selection.metric === 'timed' ? `${workflowLabel} run times` : `${workflowLabel} · ${ACTIVITY_RUN_LABELS[selection.metric].toLowerCase()}`;
}

export function nextActivitySort(selection: ActivityBrowse, column: ActivitySort['column']): ActivityBrowse {
  const direction = selection.sort?.column === column
    ? selection.sort.direction === 'ascending' ? 'descending' : 'ascending'
    : column === 'name' ? 'ascending' : 'descending';
  return { ...selection, page: 0, run: undefined, sort: { column, direction } };
}

const nameOrder = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

function compareRuns(a: ActivityRunRecord, b: ActivityRunRecord, sort: ActivitySort): number {
  if (sort.column === 'duration') {
    if (a.seconds === null && b.seconds !== null) return 1;
    if (b.seconds === null && a.seconds !== null) return -1;
  }
  const order = sort.column === 'name' ? nameOrder.compare(a.subject, b.subject)
    : a.seconds === null || b.seconds === null ? 0 : a.seconds - b.seconds;
  return (sort.direction === 'ascending' ? order : -order) || nameOrder.compare(a.id, b.id);
}

export function activityDrilldown(records: readonly ActivityRunRecord[], selection: ActivityBrowse) {
  const ids = new Set<string>();
  for (const row of records) {
    if (!row.id || ids.has(row.id)) throw new Error('ACTIVITY_RUN_ID_INVALID');
    ids.add(row.id);
  }
  if (selection.workflow && !records.some(row => row.workflowId === selection.workflow)) return { state: 'unavailable' as const, reason: 'This workflow has no runs in the selected period.' };
  const matches = records.filter(row => (!selection.workflow || row.workflowId === selection.workflow) &&
    (selection.metric === 'outstanding' ? row.status === 'running' || row.status === 'waiting' : selection.metric === 'timed' ? row.status === 'completed' && row.seconds !== null : row.status === selection.metric));
  const sort = selection.sort;
  if (sort) matches.sort((a, b) => compareRuns(a, b, sort));
  if (!Number.isInteger(selection.page) || selection.page < 0 || selection.page > Math.max(0, Math.ceil(matches.length / ACTIVITY_RUN_PAGE_SIZE) - 1)) return { state: 'unavailable' as const, reason: 'This page is unavailable. Return to Analytics and choose a total.' };
  const run = selection.run ? matches.find(row => row.id === selection.run) : undefined;
  if (selection.run && !run) return { state: 'unavailable' as const, reason: 'This run is not part of the selected Analytics result.' };
  const start = selection.page * ACTIVITY_RUN_PAGE_SIZE;
  return { state: 'loaded' as const, matches, rows: matches.slice(start, start + ACTIVITY_RUN_PAGE_SIZE), run, start,
    workflowLabel: selection.workflow ? records.find(row => row.workflowId === selection.workflow)!.workflowLabel : undefined };
}
