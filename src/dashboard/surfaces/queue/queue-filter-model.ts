import type { StatusBucket } from '../shell/shell-model.js';

export function toggleQueueFilter(active: readonly StatusBucket[], value: StatusBucket): readonly StatusBucket[] {
  if (value === 'all') return ['all'];
  const specific = active.filter(entry => entry !== 'all');
  const next = specific.includes(value) ? specific.filter(entry => entry !== value) : [...specific, value];
  return next.length ? next : ['all'];
}

const RARE_STATUSES: readonly StatusBucket[] = ['cancelling', 'blocked', 'partial'];

/** Rare statuses are listed only while a run has them; a status the route filters on always keeps its checked row. */
export function shownStatuses(statuses: readonly StatusBucket[], active: readonly StatusBucket[], count: (status: StatusBucket) => number): readonly StatusBucket[] {
  return statuses.filter(status => !RARE_STATUSES.includes(status) || active.includes(status) || count(status) > 0);
}

type QueueOptions = { day: string; today: string; sort: string; order?: string; active: readonly StatusBucket[] };

/** How many queue options differ from their defaults: a day other than today, any status filter, and another ordering. */
export function nonDefaultOptionCount({ day, today, sort, order = 'newest', active }: QueueOptions): number {
  const filtered = active.length > 0 && !active.includes('all');
  return Number(day !== today) + Number(filtered) + Number(sort !== 'attention' || order !== 'newest');
}

/** The Status row's value: All, the one filtered status, or how many are checked. */
export function statusFilterValue(active: readonly StatusBucket[], label: (status: StatusBucket) => string): string {
  if (active.length === 0 || active.includes('all')) return 'All';
  return active.length === 1 ? label(active[0]) : `${String(active.length)} selected`;
}
