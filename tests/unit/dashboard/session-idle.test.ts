// @vitest-environment jsdom
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, it, vi } from 'vitest';
import { IdleSessionSchedule, IDLE_REFRESH_MS } from '../../../src/dashboard/surfaces/sessions/session-idle-model.js';
import { useSessionPreviewCommands, type SessionPreviewCommandPort, type SessionPreviewRequest } from '../../../src/dashboard/surfaces/sessions/session-preview-command-model.js';
import { sessionsSample } from '../../../src/dashboard/surfaces/sessions/sessions-fixture.js';
import type { SessionsViewState } from '../../../src/dashboard/surfaces/sessions/sessions-view-model.js';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
it('waits five minutes, refreshes only idle ready sessions, and rearms only after acknowledgment', () => {
  const schedule = new IdleSessionSchedule(); schedule.sync(sessionsSample('active'), 0);
  assert.deepEqual(Object.keys(schedule.view(0)), ['sample-worker-4']);
  assert.deepEqual(schedule.due(IDLE_REFRESH_MS - 1, () => false), []);
  assert.deepEqual(schedule.due(IDLE_REFRESH_MS, () => true), []);
  const request = schedule.due(IDLE_REFRESH_MS, () => false)[0]; assert(request && request.action === 'refresh');
  assert.deepEqual(request.browserIds, ['ucpath']);
  assert.deepEqual(schedule.due(IDLE_REFRESH_MS * 10, () => false), [], 'unconfirmed refresh cannot auto-retry');
  schedule.confirm(request, IDLE_REFRESH_MS * 10);
  assert.equal(schedule.view(IDLE_REFRESH_MS * 10)[request.target].remainingMs, IDLE_REFRESH_MS);
  schedule.sync(sessionsSample('empty'), IDLE_REFRESH_MS * 10);
  schedule.confirm(request, IDLE_REFRESH_MS * 11);
  assert.deepEqual(schedule.view(IDLE_REFRESH_MS * 11), {});
});
it('removes the ring on use, and discards countdowns for replaced or unavailable browser sessions', () => {
  const schedule = new IdleSessionSchedule(); const idle = sessionsSample('idle'); assert(idle.state === 'ready');
  schedule.sync(idle, 0);
  const running: SessionsViewState = { state: 'ready', workers: idle.workers.map(worker => ({ ...worker, state: 'running', browsers: worker.browsers.map(browser => ({ ...browser, state: 'active' })) })) };
  schedule.sync(running, 1000); assert.deepEqual(schedule.view(1000), {});
  schedule.sync(idle, 2000); assert.equal(schedule.view(2000)[idle.workers[0].id].remainingMs, IDLE_REFRESH_MS);
  const changed: SessionsViewState = { state: 'ready', workers: [{ ...idle.workers[0], browsers: [{ id: 'replacement', label: 'UCPath', state: 'ready' }] }] };
  schedule.sync(changed, 3000); assert.equal(schedule.view(3000)[idle.workers[0].id].remainingMs, IDLE_REFRESH_MS);
  schedule.sync({ state: 'loading' }, 4000); assert.deepEqual(schedule.due(IDLE_REFRESH_MS * 2, () => false), []);
});
it('runs with the panel collapsed, retains an uncertain request for readback, and stops on unmount', async () => {
  vi.useFakeTimers(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const requests: SessionPreviewRequest[] = [], checks: SessionPreviewRequest[] = [];
  const port: SessionPreviewCommandPort = { send: async request => { requests.push(request); return { id: request.id, state: 'uncertain', message: 'Lost acknowledgment' }; }, check: async request => { checks.push(request); return { id: request.id, state: 'confirmed' }; } };
  let commands: ReturnType<typeof useSessionPreviewCommands> | undefined;
  const catalog: never[] = [];
  function Harness() { commands = useSessionPreviewCommands(sessionsSample('active'), catalog, port); return null; }
  const host = document.createElement('div'), root = createRoot(host);
  try {
    await act(async () => root.render(createElement(Harness)));
    await act(async () => vi.advanceTimersByTimeAsync(IDLE_REFRESH_MS));
    assert.equal(requests.length, 1); assert.equal(commands?.operations['sample-worker-4'].state, 'uncertain');
    await act(async () => vi.advanceTimersByTimeAsync(IDLE_REFRESH_MS)); assert.equal(requests.length, 1);
    await act(async () => commands?.check('sample-worker-4')); assert.deepEqual(checks, requests);
    await act(async () => vi.advanceTimersByTimeAsync(IDLE_REFRESH_MS)); assert.equal(requests.length, 2);
  } finally { await act(async () => root.unmount()); }
  await vi.advanceTimersByTimeAsync(IDLE_REFRESH_MS); assert.equal(requests.length, 2);
});
