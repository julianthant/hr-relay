import { useMemo, useState } from 'react';
import type { QueueSurfaceWire } from './queue-model.js';
import { QueueSurfaceWireSchema } from '../../../models/dashboard/projection.js';
import type { StatusCountWire } from '../shell/shell-model.js';

export type QueueMockAction = 'retry' | 'archive' | 'delete';
export interface QueueMockSettings {
  readonly workflowId: string;
  readonly workflowVersion: number;
  readonly input: string;
  readonly dryRun: boolean;
  readonly priority: QueueSurfaceWire['priority'];
  readonly browserMode: 'headed' | 'headless';
  readonly captureScreenshots: boolean;
  readonly instances: QueueSurfaceWire['resolvedInstances'];
  readonly stepSelection: readonly string[];
}
export interface QueueMockRecord {
  readonly row: QueueSurfaceWire;
  readonly originalSettings: QueueMockSettings;
}
export interface QueueMockState {
  readonly records: readonly QueueMockRecord[];
  readonly archived: readonly QueueMockRecord[];
}

/** Settings are authored preview data, never a reconstruction of runtime launch authority. */
export function seedQueuePreview(rows: readonly QueueSurfaceWire[]): QueueMockState {
  return { records: rows.map(row => ({ row, originalSettings: Object.freeze({
    workflowId: row.workflowId, workflowVersion: row.descriptorVersion, input: row.title,
    dryRun: row.dryRun, priority: row.priority, browserMode: 'headed', captureScreenshots: true,
    instances: row.resolvedInstances, stepSelection: Object.freeze(row.pipeline.map(step => step.id)),
  }) })), archived: [] };
}

export function applyQueuePreviewAction(state: QueueMockState, action: QueueMockAction, ids: readonly string[], now: string, nextId: () => string): QueueMockState {
  if (new Set(ids).size !== ids.length) throw new Error('QUEUE_MOCK_DUPLICATE_TARGET');
  const selected = state.records.filter(record => ids.includes(record.row.runId));
  if (selected.length !== ids.length) throw new Error('QUEUE_MOCK_TARGET_UNAVAILABLE');
  const targets = new Set(ids);
  for (const { row } of selected) {
    if (row.surfaceKind === 'operation') for (const id of row.memberRunIds) {
      if (!state.records.some(record => record.row.runId === id)) throw new Error('QUEUE_MOCK_MEMBERS_UNAVAILABLE');
      targets.add(id);
    }
  }
  const affected = state.records.filter(record => targets.has(record.row.runId));
  if (action !== 'retry') return {
    records: state.records.filter(record => !targets.has(record.row.runId)),
    archived: action === 'archive' ? [...state.archived, ...affected] : state.archived,
  };
  const replacements = new Map(affected.map(record => [record.row.runId, nextId()]));
  const retried = affected.map(record => {
    const source = record.row;
    const runId = replacements.get(source.runId);
    if (runId === undefined) throw new Error('QUEUE_MOCK_RETRY_ID_UNAVAILABLE');
    const row = QueueSurfaceWireSchema.parse({
      ...source, runId, traceId: `${source.traceId.split('-')[0]}-${now.slice(11, 19).replaceAll(':', '')}-${runId.slice(0, 4)}`,
      attempt: Math.max(...state.records.filter(previous => previous.row.itemId === source.itemId).map(previous => previous.row.attempt)) + 1,
      status: 'queued', rowRevision: 1, actions: [], startedAt: now, updatedAt: now,
      endedAt: { state: 'absent', reason: 'Mock attempt has not finished.' },
      gateOpenedAt: { state: 'absent', reason: 'Mock attempt has no review gate.' },
      liveMessage: { state: 'present', value: 'Mock retry queued with original settings' },
      facts: { state: 'absent', reason: 'Mock attempt has no output yet.' },
      warnings: { state: 'absent', reason: 'Mock attempt has no warnings yet.' },
      pipeline: source.pipeline.map(step => ({ id: step.id, label: step.label, state: 'pending' })),
      lineage: source.lineage.state === 'child' ? { state: 'child', parentRunId: replacements.get(source.lineage.parentRunId) ?? source.lineage.parentRunId } : source.lineage,
      ...(source.surfaceKind === 'operation' ? { memberRunIds: source.memberRunIds.map(id => replacements.get(id)!), memberRollup: { total: source.memberRollup.total, terminal: 0, failed: 0 } } : {}),
    });
    return { row, originalSettings: record.originalSettings };
  });
  return { records: [...state.records, ...retried], archived: state.archived };
}

export function queuePreviewCounts(rows: readonly QueueSurfaceWire[], workflowId: string): readonly StatusCountWire[] {
  const latest = new Map<string, QueueSurfaceWire>();
  for (const row of rows) {
    if (row.workflowId !== workflowId || row.lineage.state === 'child') continue;
    const previous = latest.get(row.itemId);
    if (previous === undefined || row.attempt > previous.attempt) latest.set(row.itemId, row);
  }
  const counts = new Map<QueueSurfaceWire['status'], number>();
  for (const row of latest.values()) counts.set(row.status, (counts.get(row.status) ?? 0) + 1);
  return [...counts].map(([status, count]) => ({ status, count }));
}

/** Local queue interactions reset when the served day/source changes or the page reloads. */
export function useQueuePreview(rows: readonly QueueSurfaceWire[] | undefined, day: string) {
  const initial = useMemo(() => seedQueuePreview(rows ?? []), [rows]);
  const [draft, setDraft] = useState<{ day: string; source: typeof rows; value: QueueMockState } | null>(null);
  const value = draft?.day === day && draft.source === rows ? draft.value : initial;
  const visibleRows = useMemo(() => value.records.map(record => record.row), [value]);
  return {
    rows: visibleRows,
    archived: value.archived,
    apply: (action: QueueMockAction, ids: readonly string[], now: string) => {
      const next = applyQueuePreviewAction(value, action, ids, now, () => crypto.randomUUID());
      setDraft({ day, source: rows, value: next });
      return {
        createdIds: next.records.filter(record => !value.records.some(previous => previous.row.runId === record.row.runId)).map(record => record.row.runId),
        archived: next.archived.slice(value.archived.length),
      };
    },
  };
}
