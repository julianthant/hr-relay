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
import { analyticsPeriodLabel } from '../../../../src/dashboard/surfaces/activity/analytics-model.js';
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

it('counts the chart\'s runs in the header and labels open runs as a separate count', async () => {
  if (data.state !== 'loaded') throw new Error('sample not loaded');
  const [first] = data.report.analytics.workflows; assert(first);
  await render({ ...data, report: { ...data.report, analytics: { ...data.report.analytics, running: 1, workflows: [{ ...first, done: 0, failed: 0, attention: 1 }] } } });
  assert.match(document.body.textContent, /1 run in this period · 1 open now/);
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
  assert.match(document.body.textContent, /\d+ runs? in this period/);
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
  assert.doesNotMatch(document.body.textContent, /0 runs in this period|Open a row to see what went wrong/);
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

it('while the report loads, shows a busy region and no guessed sections', async () => {
  await render({ state: 'loading' });
  const frame = document.querySelector('[role="status"][aria-busy="true"][aria-label="Loading analytics report"]');
  assert(frame);
  assert.equal(frame.childElementCount, 0);
  assert.equal(document.querySelector('[data-slot="skeleton"]'), null);
});

const openRuns = () => [...document.querySelectorAll('a')].filter(link => link.textContent?.includes('Open runs'));

it('while another range loads, keeps the last report under its own period with Export and Open runs locked', async () => {
  if (!root) { const host = document.createElement('div'); document.body.append(host); root = createRoot(host); }
  const next = { from: '2026-01-01', to: '2026-01-07' };
  const opened: unknown[] = [];
  const props = { data, today: ACTIVITY_SAMPLE_TODAY, onRange() {}, onExport() {}, selection: null, onSelection(browse: unknown) { opened.push(browse); } };
  await act(async () => root?.render(createElement(ActivityView, { ...props, range: ACTIVITY_SAMPLE_RANGE })));
  const expand = document.querySelector<HTMLButtonElement>('table[aria-label="Workflows"] button[aria-expanded="false"]'); assert(expand);
  await act(async () => expand.click());
  const [link] = openRuns(); assert(link);
  assert.equal(link.getAttribute('aria-disabled'), null);
  await act(async () => link.click());
  assert.equal(opened.length, 1);
  assert.equal(document.querySelector('[data-analytics-stale]'), null);
  assert.equal(button().disabled, false);
  await act(async () => root?.render(createElement(ActivityView, { ...props, range: next, blocked: true })));
  assert(document.querySelector('table[aria-label="Workflows"] button[aria-expanded="true"]'));
  assert.deepEqual(openRuns(), [link]);
  assert.equal(link.getAttribute('aria-disabled'), 'true');
  assert.equal(link.tabIndex, -1);
  await act(async () => link.click());
  assert.equal(opened.length, 1);
  assert.equal(button().disabled, true);
  const mark = document.querySelector('[data-analytics-stale]'); assert(mark);
  assert.equal(mark.textContent, 'Updating');
  assert(mark.classList.contains('invisible'));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 350)); });
  assert.equal(mark.classList.contains('invisible'), false);
  assert.match(document.body.textContent, new RegExp(analyticsPeriodLabel(ACTIVITY_SAMPLE_RANGE)));
  assert.doesNotMatch(document.body.textContent, new RegExp(analyticsPeriodLabel(next)));
  assert.equal(document.querySelector('[aria-label="Loading analytics report"]'), null);
  await act(async () => root?.render(createElement(ActivityView, { ...props, range: ACTIVITY_SAMPLE_RANGE })));
  assert.deepEqual(openRuns(), [link]);
  assert.equal(link.getAttribute('aria-disabled'), null);
  await act(async () => link.click());
  assert.equal(opened.length, 2);
});

it('a held empty report names its own period until the chosen period arrives', async () => {
  if (!root) { const host = document.createElement('div'); document.body.append(host); root = createRoot(host); }
  const next = { from: '2026-09-01', to: '2026-09-07' };
  const props = { today: ACTIVITY_SAMPLE_TODAY, onRange() {} };
  const empty = activitySample(ACTIVITY_SAMPLE_RANGE, 'empty');
  await act(async () => root?.render(createElement(ActivityView, { ...props, data: empty, range: ACTIVITY_SAMPLE_RANGE })));
  assert.match(document.body.textContent, /No runs in this period/);
  assert.doesNotMatch(document.body.textContent, new RegExp(analyticsPeriodLabel(ACTIVITY_SAMPLE_RANGE)));
  await act(async () => root?.render(createElement(ActivityView, { ...props, data: empty, range: next, blocked: true })));
  assert.match(document.body.textContent, new RegExp(`No runs in this period.*${analyticsPeriodLabel(ACTIVITY_SAMPLE_RANGE)}`));
  assert(document.querySelector('[data-analytics-stale]'));
  await act(async () => root?.render(createElement(ActivityView, { ...props, data: activitySample(next, 'empty'), range: next })));
  assert.match(document.body.textContent, /No runs in this period/);
  assert.doesNotMatch(document.body.textContent, new RegExp(analyticsPeriodLabel(ACTIVITY_SAMPLE_RANGE)));
  assert.equal(document.querySelector('[data-analytics-stale]'), null);
});

it('agrees on one run total across the header, the legend and the table, with one name per state', async () => {
  if (data.state !== 'loaded') throw new Error('sample not loaded');
  await render(data);
  const rows = data.report.analytics.workflows;
  const total = rows.reduce((n, row) => n + row.done + row.failed + row.attention, 0);
  assert.match(document.body.textContent, new RegExp(`${total} runs? in this period`));
  const tableTotal = [...document.querySelectorAll('table[aria-label="Workflows"] tbody tr:not([data-open]) td:nth-child(3)')].reduce((n, cell) => n + Number(cell.textContent), 0);
  assert.equal(tableTotal, total);
  await act(async () => (document.querySelector('button[aria-expanded]') as HTMLButtonElement).click());
  assert.doesNotMatch(document.body.textContent, /Waiting/);
  assert.match(document.body.textContent, /Needs attention/);
});

it('opens runs with a real button', async () => {
  await render(data);
  assert.equal(document.querySelector('a[href="#"]'), null);
});
