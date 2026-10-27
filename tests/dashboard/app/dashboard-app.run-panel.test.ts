// @vitest-environment jsdom
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, it } from 'vitest';
import { DashboardApp } from '../../../src/dashboard/app/dashboard-app.js';
import { createDashboardClient, DashboardClientError } from '../../../src/dashboard/client/index.js';
import { DashboardClientProvider } from '../../../src/dashboard/state/client-context.js';
import { resolveErrorCatalogFailure } from '../../../src/models/failures/error-catalog.js';
import { FIXTURE_DAY_WIRE } from '../../parity/helpers/fixture-queue.js';
import { PARITY_WORKFLOW_COMPOSITION } from '../../parity/helpers/workflow-composition.js';
import { createFixtureBff } from '../../support/helpers/dashboard/fixture-bff.js';

Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
Reflect.set(globalThis, 'ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
let root: Root | undefined;
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; document.body.replaceChildren(); localStorage.clear(); window.history.replaceState(null, '', '/'); });

it('shows the day-loading failure for a selected run instead of calling the run absent', async () => {
  const run = FIXTURE_DAY_WIRE.queueSurfaces[0];
  assert(run);
  const error = new DashboardClientError({ kind: 'http', status: 503, code: 'DASHBOARD_READ_FAILED', message: 'day read failed' });
  const resolution = resolveErrorCatalogFailure(error, 'subscription');
  const expected = resolution.state === 'resolved' ? resolution.text : resolution.catalogFault.text;
  const { app } = createFixtureBff();
  const transport = createDashboardClient({ baseUrl: 'http://fixture.test', fetchImpl: async (url, init) => app.request(url, init) });
  const client = { ...transport, subscribeDay: (input: Parameters<typeof transport.subscribeDay>[0]) => {
    input.onState({ state: 'stopped', error });
    return { close: () => undefined };
  } };
  window.history.replaceState(null, '', `/?day=${FIXTURE_DAY_WIRE.day}&run=${run.runId}&section=logs`);
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root?.render(createElement(DashboardClientProvider, { client, children: createElement(DashboardApp, { workflowComposition: PARITY_WORKFLOW_COMPOSITION }) })));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  const panel = host.querySelector('.dashboard-log-column');
  assert(panel);
  const text = panel.textContent ?? '';
  assert.ok(text.includes('Run unavailable'), text);
  assert.ok(text.includes(expected), text);
  assert.equal(text.includes('is not in the loaded queue'), false);
});

