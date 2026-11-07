import type { StatusBucket } from '../shell/shell-model.js';

export function toggleQueueFilter(active: readonly StatusBucket[], value: StatusBucket): readonly StatusBucket[] {
  if (value === 'all') return ['all'];
  const specific = active.filter(entry => entry !== 'all');
  const next = specific.includes(value) ? specific.filter(entry => entry !== value) : [...specific, value];
  return next.length ? next : ['all'];
}
