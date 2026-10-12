// @vitest-environment jsdom
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, it } from 'vitest';
import { DashboardApp } from '../../../src/dashboard/app/dashboard-app.js';
import { createDashboardClient } from '../../../src/dashboard/client/index.js';
import { DashboardClientProvider } from '../../../src/dashboard/state/client-context.js';
import { DashboardDayWireSchema } from '../../../src/models/dashboard/projection.js';
import { FIXTURE_DAY_WIRE } from '../../parity/helpers/fixture-queue.js';
import { PARITY_WORKFLOW_COMPOSITION } from '../../parity/helpers/workflow-composition.js';
import { createFixtureBff } from '../../support/helpers/dashboard/fixture-bff.js';

Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
Reflect.set(globalThis, 'ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
let root: Root | undefined;
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; document.body.replaceChildren(); localStorage.clear(); window.history.replaceState(null, '', '/'); });
it('opens a linked child using its own partition day and exact run identity', async () => {
  const parent = FIXTURE_DAY_WIRE.queueSurfaces.find(row => row.surfaceKind === 'single');
  const child = FIXTURE_DAY_WIRE.queueSurfaces.find(row => row.surfaceKind === 'single' && row.runId !== parent?.runId);
  assert(parent && child);
  const childDay = FIXTURE_DAY_WIRE.day;
  const link = { runId: child.runId, partitionDay: childDay, workflowId: child.workflowId, label: 'Next day child', panelKind: child.panelKind, status: child.status };
  const parentWire = DashboardDayWireSchema.parse({ ...FIXTURE_DAY_WIRE, day: '2026-08-02', queueSurfaces: [{ ...parent, linkedRuns: [link] }] });
  const childWire = DashboardDayWireSchema.parse({ ...FIXTURE_DAY_WIRE, day: childDay, queueSurfaces: [child] });
  const { app } = createFixtureBff();
  const requestedDays: string[] = [];
  const transport = createDashboardClient({ baseUrl: 'http://fixture.test', fetchImpl: async (url, init) => app.request(url, init) });
  const client = { ...transport, subscribeDay: (input: Parameters<typeof transport.subscribeDay>[0]) => {
    requestedDays.push(input.day);
    input.onDay(input.day === childDay ? childWire : parentWire); input.onState({ state: 'live' });
    return { close: () => undefined };
  } };
  window.history.replaceState(null, '', `/?day=${parentWire.day}`);
  localStorage.setItem('hr-dashboard.workflow-panel', 'sidebar');
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root?.render(createElement(DashboardClientProvider, { client, children: createElement(DashboardApp, { workflowComposition: PARITY_WORKFLOW_COMPOSITION }) })));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  const chip = host.querySelector<HTMLButtonElement>('button[aria-label^="Next day child —"]'); assert(chip);
  await act(async () => { chip.click(); await new Promise(resolve => setTimeout(resolve, 20)); });
  const params = new URLSearchParams(window.location.search);
  assert.equal(params.get('day'), childDay);
  assert.equal(params.get('run'), child.runId);
  assert.equal(params.get('section'), 'logs');
  assert.equal(requestedDays.at(-1), childDay);
  assert.equal(host.textContent?.includes('Run unavailable'), false);
});
