// @vitest-environment jsdom
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, it, vi } from 'vitest';
import { ActivityReport } from '../../../../src/dashboard/surfaces/activity/activity.js';
import { ActivityView } from '../../../../src/dashboard/surfaces/activity/activity-view.js';
import { ACTIVITY_SAMPLE_RANGE, ACTIVITY_SAMPLE_TODAY, activitySample } from '../../../../src/dashboard/surfaces/activity/activity-fixture.js';
import type { ActivityViewState } from '../../../../src/dashboard/surfaces/activity/activity-view-model.js';
Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
Reflect.set(globalThis, 'ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
let root: Root | undefined;
afterEach(async () => { await act(async () => root?.unmount()); document.body.replaceChildren(); root = undefined; });
const data = activitySample(ACTIVITY_SAMPLE_RANGE, 'normal');
async function render(report: ActivityViewState = data, onExport?: (format: 'csv' | 'xlsx') => void | Promise<void>) {
  if (!root) { const host = document.createElement('div'); document.body.append(host); root = createRoot(host); }
  await act(async () => root?.render(createElement(ActivityView, { data: report, range: ACTIVITY_SAMPLE_RANGE, today: ACTIVITY_SAMPLE_TODAY, period: 'custom', onPreset() {}, onRange() {}, onExport })));
}
const button = () => { const found = [...document.querySelectorAll('button')].find(button => button.textContent === 'Export CSV'); assert(found); return found; };
it('exports CSV exactly once while pending and retains refusal feedback', async () => {
  let reject!: () => void;
  const onExport = vi.fn(() => new Promise<void>((_, fail) => { reject = () => fail(new Error('refused')); }));
  await render(data, onExport); await act(async () => button().click());
  assert(button().disabled); assert.equal(button().getAttribute('aria-busy'), 'true');
  await act(async () => button().click()); assert.deepEqual(onExport.mock.calls, [['csv']]);
  await act(async () => reject()); assert.match(document.body.textContent, /CSV export unavailable/); assert(!button().disabled);
});
it('ignores a late refusal from a replaced report and disables missing authority', async () => {
  let reject!: () => void;
  await render(data, () => new Promise<void>((_, fail) => { reject = () => fail(new Error('late')); }));
  await act(async () => button().click());
  await render(activitySample(ACTIVITY_SAMPLE_RANGE, 'empty'));
  await act(async () => reject()); assert.doesNotMatch(document.body.textContent, /CSV export unavailable/);
  for (const report of [{ state: 'loading' }, { state: 'unavailable', reason: 'Unavailable' }, data] as const) { await render(report); assert(button().disabled); }
});
it('supports the existing synchronous export callback', async () => {
  const onExport = vi.fn(); await render(data, onExport); await act(async () => button().click()); assert.deepEqual(onExport.mock.calls, [['csv']]); assert(!button().disabled);
});

it('the mock report refuses export visibly without starting a download', async () => {
  await render();
  await act(async () => root?.render(createElement(ActivityReport, { source: "mock", range: '', onRange() {} })));
  await act(async () => button().click());
  assert.match(document.body.textContent, /CSV export is unavailable in this preview./);
  assert.equal(document.querySelectorAll('a[download]').length, 0);
});
