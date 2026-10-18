// @vitest-environment jsdom
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { it } from 'vitest';
import { createRoot } from 'react-dom/client';
import { QueuePanel, QueueRow } from '../../../../src/dashboard/surfaces/queue/queue.js';
import { StatusBadge } from '../../../../src/dashboard/surfaces/shared/status/status.js';
import { seedMockRuns } from '../../../../src/dashboard/surfaces/workflows/mocks/workflow-mock-model.js';
import { mockQueueSurface } from '../../../../src/dashboard/surfaces/workflows/mocks/workflow-queue-model.js';
import { QueueSurfaceWireSchema } from '../../../../src/models/dashboard/projection.js';
import { DS_STATUS, DS_STATUS_ORDER } from '../../../../src/dashboard/ds/ui.js';
it('renders all eight mounted seed Search and Match outcomes in completed Queue rows', () => {
  const runs = seedMockRuns().filter(run => run.workflowId === 'person-lookup');
  assert.equal(runs.length, 8);
  assert.equal(new Set(runs.map(run => run.id)).size, 8);
  assert.deepEqual(runs.map(run => [run.draft.lookupMode, run.businessOutcome?.label]), [
    ['search', 'Active'], ['search', 'Inactive'], ['search', 'CRM only'], ['search', 'Multiple matches'], ['search', 'Not found'], ['search', 'Undetermined'], ['match', 'Found'], ['match', 'Not found in UCPath'],
  ]);
  for (const run of runs) {
    const surface = mockQueueSurface(run, '2026-08-03T16:10:00.000Z');
    const html = renderToStaticMarkup(createElement(QueueRow, { outcome: run.businessOutcome, surface, state: { nowIso: '2026-08-03T20:00:00.000Z', openWells: new Set<string>() }, handlers: { onSelect() {} }, workflowLabelOf: () => 'Person Lookup' }));
    const host = document.createElement('div'); host.innerHTML = html;
    assert.equal(surface.status, 'done'); assert(host.textContent?.includes(run.businessOutcome!.label));
  }
});
it('preserves every other lifecycle badge even when supplied a business outcome', () => {
  for (const status of DS_STATUS_ORDER) {
    const html = renderToStaticMarkup(createElement(StatusBadge, { status, presentation: 'queue', outcome: { label: 'CRM only', tone: 'warning' } }));
    const host = document.createElement('div'); host.innerHTML = html;
    assert.equal(host.textContent, status === 'verifiedDone' || status === 'doneWarnings' ? 'CRM only' : DS_STATUS[status].label);
  }
});

it('describes the lifecycle done count as completed without claiming receipt verification', async () => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
  const run = seedMockRuns().find(run => run.workflowId === 'person-lookup'); assert(run);
  const surface = mockQueueSurface(run, '2026-08-03T16:10:00.000Z');
  assert.equal(surface.status, 'done');
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  const selected: string[] = [];
  try {
    await act(async () => root.render(createElement(QueuePanel, { surfaces: [surface], state: { nowIso: '2026-08-03T20:00:00.000Z', openWells: new Set<string>() }, handlers: { onSelect(id) { selected.push(id); } }, workflowLabelOf: () => 'Person Lookup', panelLabel: 'Person Lookup', day: '2026-08-03', isToday: true })));
    assert.match(host.textContent ?? '', /Today:\s*1 completed/u);
    assert.doesNotMatch(host.textContent ?? '', /1 verified/u);
    assert.equal(host.querySelectorAll('[data-demo-row-id]').length, 1);
    await act(async () => host.querySelector<HTMLElement>('[data-demo-row-id]')?.click());
    assert.deepEqual(selected, [surface.runId]);
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it('updates an outcome-only QueuePanel change and preserves partial warning facts', async () => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
  const parent = seedMockRuns().find(run => run.workflowId === 'person-lookup'); assert(parent);
  const surface = QueueSurfaceWireSchema.parse({ ...mockQueueSurface(parent, '2026-08-03T16:10:00.000Z'), status: 'partial', warnings: { state: 'present', count: 3, first: 'Three observations need review' } });
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  const props = { surfaces: [surface], state: { nowIso: '2026-08-03T20:00:00.000Z', openWells: new Set<string>() }, handlers: { onSelect() {} }, workflowLabelOf: () => 'Person Lookup', panelLabel: 'Person Lookup', day: '2026-08-03' };
  try {
    await act(async () => root.render(createElement(QueuePanel, { ...props, outcomes: new Map([[String(surface.runId), { label: 'Active', tone: 'success' as const }]]) })));
    assert(host.textContent?.includes('Active'));
    await act(async () => root.render(createElement(QueuePanel, { ...props, outcomes: new Map([[String(surface.runId), { label: 'Undetermined', tone: 'warning' as const }]]) })));
    assert(host.textContent?.includes('Undetermined')); assert(!host.textContent?.includes('Active'));
    assert.equal(host.querySelector('[title="Three observations need review"]')?.textContent, '3');
    const outcome = [...host.querySelectorAll('span')].find(node => node.textContent === 'Undetermined' && node.parentElement?.getAttribute('data-slot') === 'badge');
    assert(outcome); assert(outcome.parentElement?.className.includes('--ds-status-done-warnings-bg'));
  } finally { await act(async () => root.unmount()); host.remove(); }
});
