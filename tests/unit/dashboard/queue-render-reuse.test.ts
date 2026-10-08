// @vitest-environment jsdom
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, it } from 'vitest';
import { QueuePanel, type QueueHandlers, type QueueViewState } from '../../../src/dashboard/surfaces/queue/queue.js';
import { FIXTURE_DAY_WIRE } from '../../parity/helpers/fixture-queue.js';
import { FIXTURE_NOW } from '../../parity/helpers/fixture-identity.js';

Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
let root: Root | undefined;
let host: HTMLDivElement | undefined;
afterEach(() => { act(() => root?.unmount()); host?.remove(); root = undefined; host = undefined; });

it('redraws only affected selections while preserving new handlers, clock and bulk state', () => {
  const rows = FIXTURE_DAY_WIRE.queueSurfaces.filter(row => row.surfaceKind === 'single').slice(0, 3);
  assert.equal(rows.length, 3);
  const renders: string[] = [];
  const actionsOf = (row: typeof rows[number]) => { renders.push(row.runId); return row.actions; };
  const label = () => 'Fixture';
  let state: QueueViewState = { nowIso: FIXTURE_NOW, openWells: new Set() };
  let handlers: QueueHandlers = { onSelect() {} };
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  const draw = () => act(() => root?.render(createElement(QueuePanel, { surfaces: rows, state, handlers,
    actionsOf, workflowLabelOf: label, panelLabel: 'Fixture', day: FIXTURE_DAY_WIRE.day })));
  draw(); assert.equal(renders.length, 3); renders.length = 0;
  state = { ...state, selectedRunId: rows[0].runId }; handlers = { ...handlers }; draw();
  assert.deepEqual(renders, [rows[0].runId]); renders.length = 0;
  state = { ...state, selectedRunId: rows[1].runId }; draw();
  assert.deepEqual(new Set(renders), new Set([rows[0].runId, rows[1].runId])); renders.length = 0;
  assert.equal(host.querySelector(`[data-demo-row-id="${rows[0].runId}"]`)?.getAttribute('aria-pressed'), 'false');
  assert.equal(host.querySelector(`[data-demo-row-id="${rows[1].runId}"]`)?.getAttribute('aria-pressed'), 'true');
  const selected: string[] = []; handlers = { onSelect(id) { selected.push(id); } }; draw();
  assert.equal(renders.length, 3); renders.length = 0;
  act(() => host?.querySelector<HTMLElement>(`[data-demo-row-id="${rows[2].runId}"]`)?.click());
  assert.deepEqual(selected, [rows[2].runId]);
  state = { ...state, nowIso: '2026-08-14T19:00:00.000Z' }; draw(); assert.equal(renders.length, 3); renders.length = 0;
  state = { ...state, selectMode: true, bulkIds: new Set([rows[2].runId]) }; handlers = { ...handlers, onToggleBulk() {} }; draw();
  assert.equal(renders.length, 3);
  assert.equal(host.querySelectorAll('[role="checkbox"][aria-checked="true"]').length, 1);
});

it('updates the containing operation when selection moves between members', () => {
  const operation = FIXTURE_DAY_WIRE.queueSurfaces.find(row => row.surfaceKind === 'operation' && row.memberRunIds.length === 3);
  assert.ok(operation && operation.surfaceKind === 'operation');
  const members = FIXTURE_DAY_WIRE.queueSurfaces.filter(row => row.surfaceKind === 'member' && operation.memberRunIds.includes(row.runId));
  const surfaces = [operation, ...members]; const label = () => 'Fixture'; const handlers = { onSelect() {} };
  const wells = new Set<string>();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  const draw = (selectedRunId: string) => act(() => root?.render(createElement(QueuePanel, { surfaces,
    state: { nowIso: FIXTURE_NOW, openWells: wells, selectedRunId }, handlers,
    workflowLabelOf: label, panelLabel: 'Fixture', day: FIXTURE_DAY_WIRE.day })));
  draw(members[0].runId);
  const selected = () => [...host!.querySelectorAll('tbody button[aria-pressed="true"]')].map(button => button.closest('tr')?.getAttribute('data-demo-row-id'));
  assert.deepEqual(selected(), [members[0].runId]);
  draw(members[1].runId); assert.deepEqual(selected(), [members[1].runId]);
});
