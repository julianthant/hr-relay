// @vitest-environment jsdom
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { it } from 'vitest';
import { QueueSurfaceWireSchema } from '../../../../src/models/dashboard/projection.js';
import { queueBatches } from '../../../../src/dashboard/surfaces/queue/queue-model.js';
import { QueueRow } from '../../../../src/dashboard/surfaces/queue/queue.js';
import { RunStateChips } from '../../../../src/dashboard/surfaces/run-detail/run-state-chips.js';
import { OperatorLabelContext } from '../../../../src/dashboard/state/operator-label.js';
import { seedMockRuns } from '../../../support/fixtures/dashboard/workflow-mocks/workflow-mock-model.js';
import { mockQueueSurface } from '../../../support/fixtures/dashboard/workflow-mocks/workflow-queue-model.js';

const run = seedMockRuns().find(candidate => candidate.workflowId === 'person-lookup'); assert(run);
const base = mockQueueSurface(run, '2026-08-03T16:10:00.000Z');
const row = (surface: typeof base) => renderToStaticMarkup(createElement(OperatorLabelContext.Provider, { value: 'Ada' },
  createElement(QueueRow, { surface, state: { nowIso: '2026-08-03T20:00:00.000Z', openWells: new Set<string>() }, handlers: { onSelect() {} }, workflowLabelOf: () => 'Person Lookup' })));
const header = (surface: typeof base) => renderToStaticMarkup(createElement(OperatorLabelContext.Provider, { value: 'Ada' }, createElement(RunStateChips, { row: surface })));

it('names the assistant and the operator on Queue and Logs, with read only when served', () => {
  const readOnly = { ...base, startedBy: { kind: 'assistant' as const, readOnly: true } }, live = { ...base, startedBy: { kind: 'assistant' as const, readOnly: false } };
  for (const html of [row(readOnly), header(readOnly)]) assert.match(html, /Started by the assistant for Ada · read only/);
  for (const html of [row(live), header(live)]) assert.match(html, /Started by the assistant for Ada(?! · read only)/);
});

it('shows nothing on a run the assistant did not start', () => {
  for (const html of [row(base), header(base)]) assert.doesNotMatch(html, /Started by/);
});

it('draws a batch attribution from the exact visible member attempt, across a dashboard retry', () => {
  const session = { state: 'present' as const, itemScope: 'session' as const, sessionId: '00000000-0000-4000-8000-000000009700',
    presentation: { layout: 'batch' as const, groupInQueue: true, version: 2, startedAt: base.startedAt } };
  const assistant = { kind: 'assistant' as const, readOnly: true };
  const mk = (n: number, item: number, attempt: number, started: boolean) => QueueSurfaceWireSchema.parse({ ...base, runId: `00000000-0000-4000-8000-0000000097${String(n).padStart(2, '0')}`,
    itemId: `00000000-0000-4000-8000-0000000098${String(item).padStart(2, '0')}`, attempt, session, ...(started ? { startedBy: assistant } : {}) });
  const original = mk(1, 1, 1, true), other = mk(2, 2, 1, true), retry = mk(3, 1, 2, false);
  const batch = queueBatches([original, other, retry])[0]; assert(batch);
  const batchRow = (selectedRunId?: string) => renderToStaticMarkup(createElement(OperatorLabelContext.Provider, { value: 'Ada' }, createElement(QueueRow, { surface: batch.representative, batch,
    state: { nowIso: '2026-08-03T20:00:00.000Z', openWells: new Set<string>(), ...(selectedRunId === undefined ? {} : { selectedRunId }) }, handlers: { onSelect() {} }, workflowLabelOf: () => 'Person Lookup' })));
  // The retry is the item's visible attempt and the dashboard started it: no batch line until the assistant's original is picked from history.
  assert.doesNotMatch(batchRow(), /Started by/);
  assert.doesNotMatch(batchRow(retry.runId), /Started by/);
  assert.match(batchRow(original.runId), /Started by the assistant for Ada · read only/);
  const unretried = queueBatches([original, other])[0]; assert(unretried);
  assert.match(renderToStaticMarkup(createElement(OperatorLabelContext.Provider, { value: 'Ada' }, createElement(QueueRow, { surface: unretried.representative, batch: unretried,
    state: { nowIso: '2026-08-03T20:00:00.000Z', openWells: new Set<string>() }, handlers: { onSelect() {} }, workflowLabelOf: () => 'Person Lookup' }))), /Started by the assistant for Ada · read only/);
});
