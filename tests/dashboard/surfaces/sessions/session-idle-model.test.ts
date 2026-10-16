import { servedFixtureSources as previewFixtureSources } from "../../../parity/helpers/workflow-composition.js";
// @vitest-environment jsdom
import assert from 'node:assert/strict';
import { act,createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach,it,vi } from 'vitest';
import { IDLE_REFRESH_MS,IdleSessionSchedule,useIdleSessionRefresh } from '../../../../src/dashboard/surfaces/sessions/session-idle-model.js';
import { type SessionPreviewRequest } from '../../../../src/dashboard/surfaces/sessions/session-preview-command-model.js';
import { sessionsSample } from '../../../../src/dashboard/surfaces/sessions/sessions-fixture.js';
import type { SessionsViewState } from '../../../../src/dashboard/surfaces/sessions/sessions-view-model.js';
import { manualClock } from '../../../../src/rules/time/clock.js';

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

it('uses injected wall time for countdown and confirmed refresh without advancing ambient time', async () => {
  vi.useFakeTimers(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const clock = manualClock(new Date('2026-10-08T12:00:00Z'));
  const requests: SessionPreviewRequest[] = [];
  const data = sessionsSample('active');
  let idle: ReturnType<typeof useIdleSessionRefresh> | undefined;
  function Harness() { idle = useIdleSessionRefresh(data, {}, async request => { requests.push(request); }, clock); return null; }
  const host = document.createElement('div'), root = createRoot(host);
  try {
    await act(async () => root.render(createElement(Harness)));
    assert.equal(idle?.countdowns['sample-worker-4'].remainingMs, IDLE_REFRESH_MS);
    await act(async () => vi.advanceTimersByTimeAsync(IDLE_REFRESH_MS));
    assert.equal(requests.length, 0, 'timer movement cannot substitute for the injected clock');
    clock.advanceWall(IDLE_REFRESH_MS - 1);
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    assert.equal(idle?.countdowns['sample-worker-4'].remainingMs, 1);
    clock.advanceWall(1);
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    assert.equal(requests.length, 1);
    assert.equal(idle?.countdowns['sample-worker-4'].waiting, true);
    clock.advanceWall(IDLE_REFRESH_MS);
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    assert.equal(requests.length, 1);
    idle?.confirmed(requests[0]);
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    assert.equal(idle?.countdowns['sample-worker-4'].remainingMs, IDLE_REFRESH_MS);
    clock.advanceWall(IDLE_REFRESH_MS);
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    assert.equal(requests.length, 2);
  } finally { await act(async () => root.unmount()); }
});

it('retains the original held refresh across own admission, cancels Remove immediately, and rearms from exact ack time only', async () => {
  const { FIXTURE_DAY_WIRE, FIXTURE_NOW, uuidOf } = await import('../../../parity/helpers/fixture-day.js');
  const { DashboardDayWireSchema } = await import('../../../../src/models/dashboard/projection.js');
  const { sessionsFromDay } = await import('../../../../src/dashboard/surfaces/sessions/sessions-view-model.js');
  const { buildWorkflowCatalog } = await import('../../../../src/dashboard/surfaces/workflows/workflow-catalog-model.js');
  const base = FIXTURE_DAY_WIRE.workerCards[1];
  const card = { ...base, controls: { basis: { state: 'present' as const, value: { leaseGeneration: 1, controlRevision: 1 } }, ownership: { state: 'owned' as const } },
    browsers: base.browsers.map(browser => ({ ...browser, observation: { state: 'present' as const, health: 'authenticated' as const, observedAt: FIXTURE_NOW, browserMode: 'headed' as const, configFingerprint: 'a'.repeat(64) } })) };
  const view = (next = card) => sessionsFromDay(DashboardDayWireSchema.parse({ ...FIXTURE_DAY_WIRE, workerCards: FIXTURE_DAY_WIRE.workerCards.map(old => old.workerId === card.workerId ? next : old) }), buildWorkflowCatalog([], true, previewFixtureSources([])), FIXTURE_NOW);
  const schedule = new IdleSessionSchedule(); schedule.sync(view(), 0);
  const request = schedule.due(IDLE_REFRESH_MS, () => false)[0]; assert(request?.action === 'refresh');
  const operations = { [card.workerId]: { request, state: 'uncertain' as const, message: 'No response' } };
  const admitted = { ...card, controls: { ...card.controls, basis: { state: 'present' as const, value: { leaseGeneration: 1, controlRevision: 2 } }, operation: { commandId: request.id, type: 'refresh-browser' as const, state: 'executing' as const, at: FIXTURE_NOW, unresolved: true } } };
  schedule.sync(view(admitted), IDLE_REFRESH_MS + 10, operations);
  assert.equal(schedule.view(IDLE_REFRESH_MS + 10)[card.workerId].waiting, true);
  assert.deepEqual(schedule.due(IDLE_REFRESH_MS * 4, () => false), []);
  schedule.confirm({ ...request, id: uuidOf(1) }, IDLE_REFRESH_MS * 4, view(admitted));
  assert.equal(schedule.view(IDLE_REFRESH_MS * 4)[card.workerId].waiting, true);
  const acknowledged = { ...admitted, controls: { ...admitted.controls, operation: { ...admitted.controls.operation, state: 'succeeded' as const, unresolved: false } } };
  schedule.confirm(request, IDLE_REFRESH_MS * 4, view(acknowledged));
  assert.equal(schedule.view(IDLE_REFRESH_MS * 4)[card.workerId].remainingMs, IDLE_REFRESH_MS);
  assert.deepEqual(schedule.due(IDLE_REFRESH_MS * 5 - 1, () => false), []);
  const second = schedule.due(IDLE_REFRESH_MS * 5, () => false)[0]; assert(second?.action === 'refresh');
  const secondAck = { ...acknowledged, controls: { ...acknowledged.controls, basis: { state: 'present' as const, value: { leaseGeneration: 1, controlRevision: 3 } }, operation: { ...acknowledged.controls.operation, commandId: second.id } } };
  schedule.sync(view(secondAck), IDLE_REFRESH_MS * 5 + 1, { [card.workerId]: { request: second, state: 'uncertain', message: 'No response' } });
  assert.equal(schedule.view(IDLE_REFRESH_MS * 5 + 1)[card.workerId].waiting, true);
  schedule.confirm(second, IDLE_REFRESH_MS * 6, view(secondAck));
  assert.equal(schedule.view(IDLE_REFRESH_MS * 6)[card.workerId].remainingMs, IDLE_REFRESH_MS, 'second genuine cycle uses acknowledged control baseline');
  schedule.sync(view(acknowledged), IDLE_REFRESH_MS * 4 + 1, { [card.workerId]: { request: { id: uuidOf(2), target: card.workerId, action: 'remove' }, state: 'pending', message: 'Remove requested' } });
  assert.equal(schedule.view(IDLE_REFRESH_MS * 4 + 1)[card.workerId], undefined);

  const foreign = new IdleSessionSchedule(); foreign.sync(view(), 0);
  const original = foreign.due(IDLE_REFRESH_MS, () => false)[0]; assert(original.action === 'refresh');
  const foreignCard = { ...acknowledged, controls: { ...acknowledged.controls, basis: { state: 'present' as const, value: { leaseGeneration: 1, controlRevision: 3 } }, operation: { ...acknowledged.controls.operation, commandId: uuidOf(3) } } };
  foreign.sync(view(foreignCard), IDLE_REFRESH_MS + 20, { [card.workerId]: { request: original, state: 'uncertain', message: 'No response' } });
  foreign.confirm(original, IDLE_REFRESH_MS + 30, view(foreignCard));
  assert.equal(foreign.view(IDLE_REFRESH_MS + 30)[card.workerId], undefined, 'foreign same-phase control prevents stale acknowledgment rearming');
  foreign.sync(view(foreignCard), IDLE_REFRESH_MS * 8, { [card.workerId]: { request: original, state: 'confirmed', message: 'Original refresh confirmed' } });
  assert.equal(foreign.view(IDLE_REFRESH_MS * 8)[card.workerId], undefined, 'later sync cannot revive the canceled original timer');
  assert.deepEqual(foreign.due(IDLE_REFRESH_MS * 9, () => false), []);
});
