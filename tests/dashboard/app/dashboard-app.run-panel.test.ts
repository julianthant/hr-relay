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
import { createErrorCatalogFailure, formatErrorCatalogFailure, resolveErrorCatalogFailure } from '../../../src/models/failures/error-catalog.js';
import { RowRevisionSchema } from '../../../src/models/dashboard/primitives.js';
import { FIXTURE_DAY_WIRE, FIXTURE_IDS } from '../../parity/helpers/fixture-queue.js';
import { CommandRequestSchema, type CommandRequest } from '../../../src/rules/commands/commands.js';
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

for (const destination of ['confirm', 'other-run', 'no-run'] as const) it(`keeps a Logs confirmation bound to its mounted run: ${destination}`, async () => {
  const run = FIXTURE_DAY_WIRE.queueSurfaces.find(row => row.runId === FIXTURE_IDS.openGateRun);
  assert(run);
  const { app } = createFixtureBff();
  const transport = createDashboardClient({ baseUrl: 'http://fixture.test', fetchImpl: async (url, init) => app.request(url, init) });
  const sent: CommandRequest[] = [];
  const oneClick = IdentityGateDetailWireSchema.parse({ ...FIXTURE_IDENTITY_GATE, approvalShape: 'one-click' });
  const client: DashboardClient = { ...transport,
    runDetail: async (runId, signal) => ({ ...await transport.runDetail(runId, signal), captures: { state: 'absent', reason: 'not-captured' } }),
    runSection: async (runId, section, cursor, signal) => runId === run.runId && section === 'identity-gate'
      ? RunDetailSectionResponseSchema.parse({ section, payload: { state: 'available', value: oneClick } }) : transport.runSection(runId, section, cursor, signal),
    subscribeDay: (input: Parameters<typeof transport.subscribeDay>[0]) => { input.onDay(FIXTURE_DAY_WIRE); input.onState({ state: 'live' }); return { close: () => undefined }; },
    executeCommand: async (raw: unknown) => { sent.push(CommandRequestSchema.parse(raw)); return transport.executeCommand(raw); } };
  window.history.replaceState(null, '', `/?day=${FIXTURE_DAY_WIRE.day}&run=${run.runId}&section=logs`);
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  const servedLogs = (workflows: Parameters<typeof PARITY_WORKFLOW_COMPOSITION>[0]) => { const composition = PARITY_WORKFLOW_COMPOSITION(workflows); return Object.freeze({ ...composition, logsSources: composition.sources }); };
  await act(async () => root?.render(createElement(DashboardClientProvider, { client, children: createElement(DashboardApp, { workflowComposition: servedLogs }) })));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
  const block = host.querySelector('article[aria-label="Identity Approval"]');
  assert(block, host.querySelector('.dashboard-log-column')?.textContent ?? '');
  const approve = [...block.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === oneClick.actions[0]?.label);
  assert(approve); assert.equal(approve.disabled, false);
  await act(async () => { approve.click(); await new Promise(resolve => setTimeout(resolve, 10)); });
  assert.equal(sent.length, 0);
  const dialog = document.querySelector('[role="dialog"]');
  assert(dialog);
  assert.ok(dialog.textContent?.includes('Approve this identity'), dialog.textContent ?? '');
  const confirm = [...dialog.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === 'Approve');
  assert(confirm);
  if (destination !== 'confirm') {
    const other = FIXTURE_DAY_WIRE.queueSurfaces.find(row => row.runId !== run.runId);
    assert(other);
    const target = destination === 'other-run' ? `&run=${other.runId}` : '';
    await act(async () => {
      window.history.pushState(null, '', `/?day=${FIXTURE_DAY_WIRE.day}${target}&section=logs`);
      window.dispatchEvent(new PopStateEvent('popstate'));
      await new Promise(resolve => setTimeout(resolve, 20));
    });
    assert.equal(block.isConnected, false, 'the confirmation owner was unmounted by history navigation');
    assert.ok(document.querySelector('[role="dialog"]')?.textContent?.includes('Approve this identity'), 'exercise the retained confirmation');
    await act(async () => { confirm.click(); await new Promise(resolve => setTimeout(resolve, 20)); });
    assert.equal(sent.length, 0, 'a retained confirmation cannot dispatch after its Logs owner unmounted');
    return;
  }
  await act(async () => { confirm.click(); await new Promise(resolve => setTimeout(resolve, 20)); });
  assert.equal(sent.length, 1);
  const envelope = sent[0];
  assert.equal(envelope.family, 'gate');
  if (envelope.family === 'gate') assert.deepEqual(envelope.target, { runId: run.runId, gateId: 'identity-approval', expectedVersion: run.rowRevision });
});

for (const catchesUp of [false, true]) it(`retains stale Logs during a day refresh and ${catchesUp ? 'loads the caught-up row' : 'refuses persistent lag after one refresh'}`, async () => {
  const run = FIXTURE_DAY_WIRE.queueSurfaces.find(row => row.runId === FIXTURE_IDS.openGateRun);
  assert(run);
  const { app } = createFixtureBff();
  const transport = createDashboardClient({ baseUrl: 'http://fixture.test', fetchImpl: async (url, init) => app.request(url, init) });
  const subscriptions: Parameters<typeof transport.subscribeDay>[0][] = [];
  const sent: CommandRequest[] = [];
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
      return { close: () => undefined };
    },
    executeCommand: async raw => { sent.push(CommandRequestSchema.parse(raw)); return transport.executeCommand(raw); },
  };
  window.history.replaceState(null, '', `/?day=${FIXTURE_DAY_WIRE.day}&run=${run.runId}&section=logs`);
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  const servedLogs = (workflows: Parameters<typeof PARITY_WORKFLOW_COMPOSITION>[0]) => {
    const composition = PARITY_WORKFLOW_COMPOSITION(workflows);
    return Object.freeze({ ...composition, logsSources: composition.sources });
  };
  await act(async () => root?.render(createElement(DashboardClientProvider, { client, children: createElement(DashboardApp, { workflowComposition: servedLogs }) })));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
  const block = host.querySelector('article[aria-label="Identity Approval"]');
  assert(block);
  const approve = [...block.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === FIXTURE_IDENTITY_GATE.actions[0]?.label);
  assert(approve); assert.equal(approve.disabled, false);

  ahead = true;
  await act(async () => {
    subscriptions[0].onDay({ ...FIXTURE_DAY_WIRE, queueSurfaces: FIXTURE_DAY_WIRE.queueSurfaces.map(row => ({ ...row })) });
    await new Promise(resolve => setTimeout(resolve, 20));
  });
  assert.equal(subscriptions.length, 2, 'one new day subscription is the admitted refresh');
  assert.equal(host.querySelector('article[aria-label="Identity Approval"]'), block, 'the loaded Logs mount survives loading');
  assert.ok(host.querySelector('.dashboard-log-column')?.textContent?.includes('Refreshing'));
  assert.equal(approve.disabled, true, 'stale authority cannot approve a gate');
  await act(async () => approve.click());
  assert.equal(sent.length, 0);

  await act(async () => {
    subscriptions[1].onDay({ ...FIXTURE_DAY_WIRE, queueSurfaces: FIXTURE_DAY_WIRE.queueSurfaces.map(row =>
      row.runId === run.runId && catchesUp ? { ...row, rowRevision: nextRevision } : row) });
    subscriptions[1].onState({ state: 'live' });
    await new Promise(resolve => setTimeout(resolve, 20));
  });
  const text = host.querySelector('.dashboard-log-column')?.textContent ?? '';
  const refusal = formatErrorCatalogFailure(createErrorCatalogFailure('LOGS_IDENTITY_REFUSED', {})).text;
  assert.equal(subscriptions.length, 2, 'a persistent lag must not start another refresh');
  assert.equal(text.includes(refusal), !catchesUp, text);
  assert.equal(approve.disabled, !catchesUp);
  assert.equal(sent.length, 0);
});
