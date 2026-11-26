// @vitest-environment jsdom
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, it } from 'vitest';
import { DashboardApp } from '../../../src/dashboard/app/dashboard-app.js';
import { createDashboardClient, DashboardClientError, type DashboardClient } from '../../../src/dashboard/client/index.js';
import { IdentityGateDetailWireSchema, RunDetailSectionResponseSchema } from '../../../src/models/dashboard/run-detail.js';
import { FIXTURE_IDENTITY_GATE } from '../../support/fixtures/dashboard/run-detail/gates-park.js';
import { DashboardClientProvider } from '../../../src/dashboard/state/client-context.js';
import { RowRevisionSchema } from '../../../src/models/dashboard/primitives.js';
import { FIXTURE_DAY_WIRE, FIXTURE_IDS } from '../../support/helpers/dashboard/mock-world/fixture-queue.js';
import { CommandResultSchema, DashboardCommandRequestSchema, type DashboardCommandRequest } from '../../../src/rules/commands/commands.js';
import { MOCK_WORKFLOW_COMPOSITION, servedLogsComposition } from '../../support/helpers/dashboard/mock-world/workflow-composition.js';
import { serveRunPanel, streamingRunPanel } from '../../support/helpers/dashboard/serve-run-panel.js';
import { createFixtureBff } from '../../support/helpers/dashboard/fixture-bff.js';

Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
Reflect.set(globalThis, 'ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
let root: Root | undefined;
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; document.body.replaceChildren(); localStorage.clear(); window.history.replaceState(null, '', '/'); });

it('shows the day-loading failure for a selected run instead of calling the run absent', async () => {
  const run = FIXTURE_DAY_WIRE.queueSurfaces[0];
  assert(run);
  const error = new DashboardClientError({ kind: 'http', status: 503, code: 'DASHBOARD_READ_FAILED', message: 'day read failed' });
  const { app } = createFixtureBff();
  const transport = createDashboardClient({ baseUrl: 'http://fixture.test', fetchImpl: async (url, init) => app.request(url, init) });
  const client = { ...transport, subscribeDay: (input: Parameters<typeof transport.subscribeDay>[0]) => {
    input.onState({ state: 'stopped', error });
    return { select() {}, close: () => undefined };
  } };
  window.history.replaceState(null, '', `/?day=${FIXTURE_DAY_WIRE.day}&run=${run.runId}&section=logs`);
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root?.render(createElement(DashboardClientProvider, { client, children: createElement(DashboardApp, { workflowComposition: MOCK_WORKFLOW_COMPOSITION }) })));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  const panel = host.querySelector('.dashboard-log-column');
  assert(panel);
  const text = panel.textContent ?? '';
  assert.ok(text.includes('No run open'), text);
  assert.ok(text.includes('Select a run once the queue loads.'), text);
  assert.equal(text.includes('Run unavailable'), false);
  assert.ok((host.textContent ?? '').includes("Couldn't load the queue."), 'the queue column says the day failed');
  assert.equal(text.includes('is not in the loaded queue'), false);
});

for (const destination of ['confirm', 'other-run', 'no-run', 'sample-refused'] as const) it(destination === 'sample-refused'
  ? 'shows a refused sample approval as one toast without a Logs badge or notification'
  : `keeps a Logs confirmation bound to its mounted run: ${destination}`, async () => {
  const run = FIXTURE_DAY_WIRE.queueSurfaces.find(row => row.runId === FIXTURE_IDS.openGateRun);
  assert(run);
  const { app } = createFixtureBff();
  const transport = createDashboardClient({ baseUrl: 'http://fixture.test', fetchImpl: async (url, init) => app.request(url, init) });
  const sent: DashboardCommandRequest[] = [];
  const oneClick = IdentityGateDetailWireSchema.parse({ ...FIXTURE_IDENTITY_GATE, approvalShape: 'one-click' });
  const client: DashboardClient = { ...transport,
    runDetail: async (runId, signal) => ({ ...await transport.runDetail(runId, signal), captures: { state: 'absent', reason: 'not-captured' } }),
    runSection: async (runId, section, cursor, signal) => runId === run.runId && section === 'identity-gate'
      ? RunDetailSectionResponseSchema.parse({ section, payload: { state: 'available', value: oneClick } }) : transport.runSection(runId, section, cursor, signal),
    subscribeDay: (input: Parameters<typeof transport.subscribeDay>[0]) => { input.onDay(FIXTURE_DAY_WIRE); input.onState({ state: 'live' }); return streamingRunPanel(input, client); },
    executeCommand: async (raw: unknown) => {
      const request = DashboardCommandRequestSchema.parse(raw);
      sent.push(request);
      return destination === 'sample-refused' ? CommandResultSchema.parse({ state: 'rejected', commandId: request.commandId,
        code: 'SAMPLE_RUN_REFUSED', message: 'Sample run: nothing runs.' }) : transport.executeCommand(raw);
    } };
  window.history.replaceState(null, '', `/?day=${FIXTURE_DAY_WIRE.day}&run=${run.runId}&section=logs`);
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root?.render(createElement(DashboardClientProvider, { client, children: createElement(DashboardApp, { workflowComposition: servedLogsComposition }) })));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
  const block = host.querySelector('form[aria-label="Is this the right person?"]');
  assert(block, host.querySelector('.dashboard-log-column')?.textContent ?? '');
  const approve = [...block.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === 'Confirm');
  assert(approve); assert.equal(approve.disabled, false);
  await act(async () => { approve.click(); await new Promise(resolve => setTimeout(resolve, 10)); });
  assert.equal(sent.length, 0);
  const dialog = document.querySelector('[role="dialog"]');
  assert(dialog);
  assert.ok(dialog.textContent?.includes('Approve this identity'), dialog.textContent ?? '');
  const confirm = [...dialog.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === 'Approve');
  assert(confirm);
  if (destination === 'other-run' || destination === 'no-run') {
    const other = FIXTURE_DAY_WIRE.queueSurfaces.find(row => row.runId !== run.runId);
    assert(other);
    const target = destination === 'other-run' ? `&run=${other.runId}` : '';
    await act(async () => {
      assert.deepEqual(window.history.state, { hrDashboardRouteCursor: 0 });
      window.history.pushState({ hrDashboardRouteCursor: 1 }, '', `/?day=${FIXTURE_DAY_WIRE.day}${target}&section=logs`);
      window.dispatchEvent(new PopStateEvent('popstate'));
      await new Promise(resolve => setTimeout(resolve, 20));
    });
    assert.equal(block.isConnected, false, 'the confirmation owner was unmounted by history navigation');
    assert.ok(document.querySelector('[role="dialog"]')?.textContent?.includes('Approve this identity'), 'exercise the retained confirmation');
    await act(async () => { confirm.click(); await new Promise(resolve => setTimeout(resolve, 20)); });
    assert.equal(sent.length, 0, 'a retained confirmation cannot dispatch after its Logs owner unmounted');
    return;
  }
  const bell = document.querySelector('button[aria-label^="Notifications,"]');
  const previousCount = bell?.getAttribute('aria-label');
  await act(async () => { confirm.click(); await new Promise(resolve => setTimeout(resolve, 20)); });
  assert.equal(sent.length, 1);
  const envelope = sent[0];
  assert.equal(envelope.family, 'gate');
  if (envelope.family === 'gate') assert.deepEqual(envelope.target, { runId: run.runId, gateId: 'identity-approval', expectedVersion: run.rowRevision });
  assert.deepEqual(envelope.family === 'gate' && envelope.type === 'answer-identity-gate' ? envelope.payload : undefined,
    { decision: 'approved', gateRef: oneClick.gateRef, optionRef: oneClick.options[0]?.ref });
  if (destination === 'sample-refused') {
    const message = 'Sample run: nothing runs.';
    assert.deepEqual([...document.querySelectorAll('[data-slot="toast"]')].map(toast => toast.textContent), [message]);
    assert.ok(!host.querySelector('.dashboard-log-column')?.textContent?.includes(message), 'Logs does not retain the sample refusal');
    assert.ok(bell);
    assert.equal(bell.getAttribute('aria-label'), previousCount);
  }
});

for (const catchesUp of [false, true]) it(`retains stale Logs while the streamed panel is behind the row and ${catchesUp ? 'loads once the stream catches up' : 'stays stale without a day refresh while it lags'}`, async () => {
  const run = FIXTURE_DAY_WIRE.queueSurfaces.find(row => row.runId === FIXTURE_IDS.openGateRun);
  assert(run);
  const { app } = createFixtureBff();
  const transport = createDashboardClient({ baseUrl: 'http://fixture.test', fetchImpl: async (url, init) => app.request(url, init) });
  const subscriptions: Parameters<typeof transport.subscribeDay>[0][] = [];
  const sent: DashboardCommandRequest[] = [];
  let ahead = false;
  const nextRevision = RowRevisionSchema.parse(run.rowRevision + 1);
  const client: DashboardClient = { ...transport,
    runDetail: async (runId, signal) => ({ ...await transport.runDetail(runId, signal),
      rowRevision: ahead ? nextRevision : run.rowRevision, captures: { state: 'absent', reason: 'not-captured' } }),
    runSection: async (runId, section, cursor, signal) => runId === run.runId && section === 'identity-gate'
      ? RunDetailSectionResponseSchema.parse({ section, payload: { state: 'available', value: {
        ...FIXTURE_IDENTITY_GATE, expectedVersion: ahead ? nextRevision : run.rowRevision,
        actions: FIXTURE_IDENTITY_GATE.actions.map(action => ({ ...action, expectedVersion: ahead ? nextRevision : run.rowRevision })),
      } } }) : transport.runSection(runId, section, cursor, signal),
    subscribeDay: input => {
      subscriptions.push(input);
      if (subscriptions.length === 1) { input.onDay(FIXTURE_DAY_WIRE); input.onState({ state: 'live' }); }
      return streamingRunPanel(input, client);
    },
    executeCommand: async raw => { sent.push(DashboardCommandRequestSchema.parse(raw)); return transport.executeCommand(raw); },
  };
  window.history.replaceState(null, '', `/?day=${FIXTURE_DAY_WIRE.day}&run=${run.runId}&section=logs`);
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root?.render(createElement(DashboardClientProvider, { client, children: createElement(DashboardApp, { workflowComposition: servedLogsComposition }) })));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
  const block = host.querySelector('form[aria-label="Is this the right person?"]');
  assert(block);
  const approve = [...block.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === 'Confirm');
  assert(approve); assert.equal(approve.disabled, false);

  // The day frame moves the row ahead of the panel the stream last delivered.
  await act(async () => {
    subscriptions[0].onDay({ ...FIXTURE_DAY_WIRE, queueSurfaces: FIXTURE_DAY_WIRE.queueSurfaces.map(row =>
      row.runId === run.runId ? { ...row, rowRevision: nextRevision } : row) });
    await new Promise(resolve => setTimeout(resolve, 20));
  });
  assert.equal(subscriptions.length, 1, 'a lagging panel asks for no day refresh');
  assert.equal(host.querySelector('form[aria-label="Is this the right person?"]') === block, true, 'the loaded Logs mount survives loading');
  assert.ok(host.querySelector('.dashboard-log-column')?.textContent?.includes('Refreshing'));
  assert.equal(approve.disabled, true, 'stale authority cannot approve a gate');
  await act(async () => approve.click());
  assert.equal(sent.length, 0);

  if (catchesUp) {
    ahead = true;
    const rows = subscriptions[0].rows; assert(rows);
    await act(async () => { await serveRunPanel(rows, client, run.runId); await new Promise(resolve => setTimeout(resolve, 20)); });
  } else {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
  }
  const text = host.querySelector('.dashboard-log-column')?.textContent ?? '';
  assert.equal(subscriptions.length, 1, 'no day refresh starts');
  assert.equal(text.includes('Refreshing'), !catchesUp, text);
  assert.equal(approve.disabled, !catchesUp);
  assert.equal(sent.length, 0);
});

it('opens the first day stream of a cold run link with that run and selects nothing after the day arrives', async () => {
  const run = FIXTURE_DAY_WIRE.queueSurfaces.find(row => row.runId === FIXTURE_IDS.openGateRun);
  assert(run);
  const { app } = createFixtureBff();
  const transport = createDashboardClient({ baseUrl: 'http://fixture.test', fetchImpl: async (url, init) => app.request(url, init) });
  const opened: (string | undefined)[] = [];
  const selected: (string | undefined)[] = [];
  const client: DashboardClient = { ...transport,
    subscribeDay: input => {
      opened.push(input.run);
      // The day arrives after the stream is open: the page knows no row of it when it connects.
      setTimeout(() => { input.onDay(FIXTURE_DAY_WIRE); input.onState({ state: 'live' }); }, 5);
      const stream = streamingRunPanel(input, client);
      return { select: next => { selected.push(next); stream.select(next); }, close: () => stream.close() };
    } };
  window.history.replaceState(null, '', `/?day=${FIXTURE_DAY_WIRE.day}&run=${run.runId}&section=logs`);
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root?.render(createElement(DashboardClientProvider, { client, children: createElement(DashboardApp, { workflowComposition: servedLogsComposition }) })));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 60)); });
  const text = host.querySelector('.dashboard-log-column')?.textContent ?? '';
  assert.ok(text.includes('identity-review gate opened for candidate selection'), text);
  assert.deepEqual(opened, [run.runId], 'one stream, opened with the linked run');
  assert.deepEqual(selected.filter(next => next !== run.runId), [], 'the day naming the run changes no topic');
});
