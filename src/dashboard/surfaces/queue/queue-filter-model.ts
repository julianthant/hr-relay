import type { StatusBucket } from '../shell/shell-model.js';

export function toggleQueueFilter(active: readonly StatusBucket[], value: StatusBucket): readonly StatusBucket[] {
  if (value === 'all') return ['all'];
  const specific = active.filter(entry => entry !== 'all');
  const next = specific.includes(value) ? specific.filter(entry => entry !== value) : [...specific, value];
  return next.length ? next : ['all'];
}

/** How many queue options differ from their defaults: a day other than today, any status filter, and Attention first off. */
export function nonDefaultOptionCount({ day, today, sort, active }: { day: string; today: string; sort: string; active: readonly StatusBucket[] }): number {
  const filtered = active.length > 0 && !active.includes('all');
  return Number(day !== today) + Number(filtered) + Number(sort !== 'attention');
}
