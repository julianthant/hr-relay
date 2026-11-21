// @vitest-environment jsdom
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, it, vi } from 'vitest';
import { ActivityReport } from '../../../../src/dashboard/surfaces/activity/activity.js';
import { ActivityView } from '../../../../src/dashboard/surfaces/activity/activity-view.js';
import { activityRangeValue } from '../../../../src/dashboard/surfaces/activity/activity-model.js';
import { ERROR_CATALOG } from '../../../../src/models/failures/error-catalog.js';
import { ACTIVITY_SAMPLE_RANGE, ACTIVITY_SAMPLE_TODAY, activitySample, useActivitySampleReport } from '../../../support/fixtures/dashboard/activity-sample.js';
import type { ActivityViewState } from '../../../../src/dashboard/surfaces/activity/activity-view-model.js';
Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
Reflect.set(globalThis, 'ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
let root: Root | undefined;
afterEach(async () => { await act(async () => root?.unmount()); document.body.replaceChildren(); root = undefined; });
const data = activitySample(ACTIVITY_SAMPLE_RANGE, 'normal');
async function render(report: ActivityViewState = data, onExport?: (format: 'csv' | 'xlsx') => void | Promise<void>) {
  if (!root) { const host = document.createElement('div'); document.body.append(host); root = createRoot(host); }
  await act(async () => root?.render(createElement(ActivityView, { data: report, range: ACTIVITY_SAMPLE_RANGE, today: ACTIVITY_SAMPLE_TODAY, onRange() {}, onExport })));
}
const button = () => { const found = [...document.querySelectorAll('button')].find(button => button.textContent === 'Export'); assert(found); return found; };
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
  await act(async () => root?.render(createElement(ActivityReport, { useReport: useActivitySampleReport, today: ACTIVITY_SAMPLE_TODAY, range: activityRangeValue(ACTIVITY_SAMPLE_RANGE), onRange() {} })));
  await act(async () => button().click());
  assert.ok(document.body.textContent.includes(ERROR_CATALOG.DASHBOARD_READ_FAILED.text));
  assert.equal(document.querySelectorAll('a[download]').length, 0);
});

it('resets the workflow filter to All when the selected workflow leaves the period', async () => {
  const loaded = (report: typeof data) => report;
  if (data.state !== 'loaded') throw new Error('sample not loaded');
  const [first, second] = data.report.analytics.workflows;
  assert(first && second);
  await render(data);
  const trigger = [...document.querySelectorAll('button')].find(item => item.textContent === 'By workflow'); assert(trigger);
  await act(async () => { trigger.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowDown' })); });
  const option = [...document.querySelectorAll('[role="menuitemradio"]')].find(item => item.textContent === first.label) as HTMLElement | undefined; assert(option);
  await act(async () => option.click());
  assert(![...document.querySelectorAll('button')].some(item => item.textContent === 'By workflow'));
  await render(loaded({ ...data, report: { ...data.report, analytics: { ...data.report.analytics, workflows: [second] } } }));
  assert([...document.querySelectorAll('button')].some(item => item.textContent === 'By workflow'));
  assert.doesNotMatch(document.body.textContent, /No workflow activity in this period/);
});

it('counts a parked run as open, not as finished', async () => {
  if (data.state !== 'loaded') throw new Error('sample not loaded');
  const [first] = data.report.analytics.workflows; assert(first);
  await render({ ...data, report: { ...data.report, analytics: { ...data.report.analytics, running: 1, workflows: [{ ...first, done: 0, failed: 0, attention: 1 }] } } });
  assert.match(document.body.textContent, /0 finished runs · 1 still open/);
});

const days = (count: number) => Array.from({ length: count }, (_, index) => `2026-09-${String(20 + index)}`);
const withAssistant = (messages: readonly number[], proposed: readonly number[]): ActivityViewState => {
  if (data.state !== 'loaded') throw new Error('sample not loaded');
  return { ...data, report: { ...data.report, analytics: { ...data.report.analytics, assistant: {
    messages: days(7).map((date, index) => ({ date, count: messages[index] ?? 0 })), actions: days(7).map((date, index) => ({ date, proposed: proposed[index] ?? 0 })) } } } };
};
const headings = () => [...document.querySelectorAll('h2, h3')].map(item => item.textContent);

it('draws Messages and Actions, with the served counts', async () => {
  await render(withAssistant([1, 2, 3, 0, 0, 4, 5], [0, 1, 0, 0, 2, 0, 0]));
  const order = headings().filter(text => ['Why runs failed', 'Messages', 'Tools used', 'Actions'].includes(text ?? ''));
  assert.deepEqual(order, ['Messages', 'Actions'], 'Why runs failed is no longer drawn');
  assert.match(document.body.textContent, /Messages sent to the assistant each day\./);
  const messages = document.querySelector('figure[aria-label="Messages per day"]'); assert(messages);
  assert.match(messages.textContent ?? '', /Messages\s*15/);
  assert.deepEqual([...messages.querySelectorAll('table tbody tr')].map(row => row.lastElementChild?.textContent), ['1', '2', '3', '0', '0', '4', '5']);
  const actions = document.querySelector('figure[aria-label="Proposed actions per day"]'); assert(actions);
  assert.match(actions.textContent ?? '', /Proposed actions\s*3/);
  assert.deepEqual([...actions.querySelectorAll('table tbody tr')].map(row => row.lastElementChild?.textContent), ['0', '1', '0', '0', '2', '0', '0']);
});

it('shows no tools section and no not-recorded line, since neither is recorded', async () => {
  await render(withAssistant([1], [1]));
  assert.equal(headings().includes('Tools used'), false);
  assert.equal(document.querySelector('figure[aria-label="Tool calls per day"]'), null);
  assert.doesNotMatch(document.body.textContent, /not recorded yet/);
});

it('shows each assistant section empty when the range has no assistant use', async () => {
  await render(withAssistant([], []));
  assert.match(document.body.textContent, /No messages in this period/);
  assert.match(document.body.textContent, /No actions proposed in this period/);
  assert.doesNotMatch(document.body.textContent, /not recorded yet/);
  assert.equal(document.querySelector('figure[aria-label="Messages per day"]'), null);
  assert.equal(document.querySelector('figure[aria-label="Proposed actions per day"]'), null);
});

it('leaves the run sections as they were', async () => {
  await render(withAssistant([1], [1]));
  assert.match(document.body.textContent, /finished runs/);
  assert(document.querySelector('figure[aria-label="Runs per day"]'));
  assert(document.querySelector('table[aria-label="Workflows"]'));
});

it('offers one Retry beneath a plain sentence when the report cannot be shown', async () => {
  const onRetry = vi.fn();
  await act(async () => { if (!root) { const host = document.createElement('div'); document.body.append(host); root = createRoot(host); } root.render(createElement(ActivityView, { data: { state: 'unavailable', reason: 'x' }, range: ACTIVITY_SAMPLE_RANGE, today: ACTIVITY_SAMPLE_TODAY, onRange() {}, onRetry })); });
  const retries = [...document.querySelectorAll('button')].filter(item => item.textContent === 'Retry');
  assert.equal(retries.length, 1);
  assert.match(document.body.textContent, /Couldn't load Analytics\./);
  assert.doesNotMatch(document.body.textContent, /Copy details/);
  await act(async () => retries[0]?.click()); assert.equal(onRetry.mock.calls.length, 1);
});

it('says one plain sentence for an empty period and keeps the period control', async () => {
  await render(activitySample(ACTIVITY_SAMPLE_RANGE, 'empty'));
  assert.match(document.body.textContent, /No runs in this period/);
  assert.doesNotMatch(document.body.textContent, /0 finished runs|Open a row to see what went wrong/);
  assert([...document.querySelectorAll('fieldset legend')].some(item => item.textContent === 'Report period'));
});

it('a bad range keeps the period control and never echoes the raw value', async () => {
  await render();
  await act(async () => root?.render(createElement(ActivityReport, { useReport: useActivitySampleReport, today: ACTIVITY_SAMPLE_TODAY, range: 'not-a-range', onRange() {} })));
  assert.doesNotMatch(document.body.textContent, /not-a-range/);
  assert.match(document.body.textContent, /That date range is not valid/);
  assert(['7d', '30d', '90d'].every(value => document.querySelector(`fieldset input[type="radio"][value="${value}"]`)));
});

it('shows a dash for the time of a workflow with no run in the period, and ranks the rest', async () => {
  if (data.state !== 'loaded') throw new Error('sample not loaded');
  const [first, second] = data.report.analytics.workflows; assert(first && second);
  const empty = { ...first, id: 'empty', label: 'Empty workflow', done: 0, failed: 0, attention: 0, typicalSeconds: 407 };
  await render({ ...data, report: { ...data.report, analytics: { ...data.report.analytics, workflows: [empty, { ...second, typicalSeconds: 90 }] } } });
  const row = [...document.querySelectorAll('table[aria-label="Workflows"] tbody tr')].find(item => item.textContent?.includes('Empty workflow')); assert(row);
  assert.equal(row.lastElementChild?.textContent, '—');
  const ranked = [...document.querySelectorAll('ol[aria-label="Typical time per workflow"] li')];
  assert.equal(ranked.length, 2); assert.match(ranked[0]?.textContent ?? '', new RegExp(second.label)); assert.match(ranked[1]?.textContent ?? '', /Empty workflow.*—/);
});

it('while the report loads, the Runs card keeps the loaded card\'s period row, plot and three key figures', async () => {
  await render({ state: 'loading' });
  const frame = document.querySelector('[role="status"][aria-busy="true"][aria-label="Loading analytics report"]');
  assert(frame);
  await render(data);
  const loaded = document.querySelector('figure.ds-chart');
  assert(loaded);
  const loadedFigures = loaded.querySelectorAll('[aria-label="Key figures"] > li').length;
  assert.equal(frame.querySelectorAll('ul > li').length, loadedFigures);
  assert.equal(frame.querySelector('.mb-4.flex')?.querySelectorAll('[data-slot="skeleton"].size-6').length, 2, 'previous and next period');
  assert(frame.querySelector('.ml-9 [data-slot="skeleton"]'), 'the plot beside its axis labels');
});
