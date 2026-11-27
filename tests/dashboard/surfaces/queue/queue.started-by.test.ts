// @vitest-environment jsdom
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { it } from 'vitest';
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
