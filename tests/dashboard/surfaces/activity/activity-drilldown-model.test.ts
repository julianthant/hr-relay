// @vitest-environment jsdom
import assert from 'node:assert/strict';
import { act,createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach,beforeEach,describe,it,vi } from 'vitest';
import { ACTIVITY_RUN_PAGE_SIZE,activityDrilldown,activityOrderValue,setActivityOrder,type ActivityBrowse,type ActivitySelectionHandler } from '../../../../src/dashboard/surfaces/activity/activity-drilldown-model.js';
import { ActivityDrilldown } from '../../../../src/dashboard/surfaces/activity/activity-drilldown.js';
import { ACTIVITY_SAMPLE_RANGE,activitySample } from '../../../../src/dashboard/surfaces/activity/activity-fixture.js';

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => vi.unstubAllGlobals());

function report(scenario: 'normal' | 'incomplete' | 'empty' = 'normal') {
  const data = activitySample(ACTIVITY_SAMPLE_RANGE, scenario);
  assert.equal(data.state, 'loaded');
  if (data.state !== 'loaded' || !data.report.runs) throw new Error('activity-test-records-missing');
  return { ...data.report, runs: data.report.runs };
}

describe('Activity drilldown records and navigation', () => {
  it('uses exactly the records behind each displayed outcome and successful timing', () => {
    const value = report();
    for (const metric of ['completed', 'outstanding', 'failed'] as const) {
      const selected = activityDrilldown(value.runs, { metric, page: 0 });
      assert.equal(selected.state, 'loaded');
      if (selected.state !== 'loaded') throw new Error('activity-result-missing');
      assert.equal(selected.matches.length, value[metric]);
      assert(selected.rows.length <= ACTIVITY_RUN_PAGE_SIZE);
    }
    for (const workflow of value.workflows) {
      const selected = activityDrilldown(value.runs, { metric: 'timed', workflow: workflow.id, page: 0 });
      if (selected.state !== 'loaded') throw new Error('activity-result-missing');
      assert.equal(selected.matches.length, workflow.successfulTiming.measured);
      assert.equal(selected.matches.reduce((sum, row) => sum + row.seconds!, 0), workflow.successfulTiming.totalSeconds);
      assert(selected.matches.every(row => row.status === 'completed'));
    }
  });
  it('preserves exact run identity, page and stable subjects across report ranges', () => {
    const value = report();
    const second = activityDrilldown(value.runs, { metric: 'completed', page: 1 });
    if (second.state !== 'loaded') throw new Error('activity-page-missing');
    const run = second.rows[0];
    const selected = activityDrilldown(value.runs, { metric: 'completed', page: 1, run: run.id });
    assert.equal(selected.state, 'loaded');
    if (selected.state !== 'loaded') throw new Error('activity-run-missing');
    assert.equal(selected.run, run); assert.equal(selected.start, 20);
    const narrowed = activitySample({ from: '2026-09-25', to: '2026-09-26' }, 'normal');
    if (narrowed.state !== 'loaded') throw new Error('activity-range-missing');
    for (const row of narrowed.report.runs!) assert.equal(row.subject, value.runs.find(record => record.id === row.id)!.subject);
  });
  it('retains empty and unknown states and rejects foreign runs, invalid pages and duplicate IDs', () => {
    const value = report();
    assert.equal(activityDrilldown(value.runs, { metric: 'failed', page: 0, run: value.runs[0].id }).state, 'unavailable');
    assert.equal(activityDrilldown(value.runs, { metric: 'completed', workflow: 'missing', page: 0 }).state, 'unavailable');
    assert.equal(activityDrilldown(value.runs, { metric: 'completed', page: 99 }).state, 'unavailable');
    assert.throws(() => activityDrilldown([value.runs[0], value.runs[0]], { metric: 'completed', page: 0 }), /ACTIVITY_RUN_ID_INVALID/);
    const empty = activityDrilldown(report('empty').runs, { metric: 'completed', page: 0 });
    assert.equal(empty.state, 'loaded'); if (empty.state === 'loaded') assert.equal(empty.matches.length, 0);
    const untimed = activityDrilldown(report('incomplete').runs, { metric: 'timed', page: 0 });
    assert.equal(untimed.state, 'loaded'); if (untimed.state === 'loaded') assert.equal(untimed.matches.length, 0);
  });
  it('sorts the whole population before paging, preserves sources and puts unknown durations last', () => {
    const template = report().runs[0];
    const records = [
      { ...template, id: 'd', subject: 'Zulu', seconds: 9 },
      { ...template, id: 'b', subject: 'alpha', seconds: 100 },
      { ...template, id: 'a', subject: 'Alpha', seconds: 100 },
      { ...template, id: 'c', subject: 'Beta', seconds: null },
    ];
    const cases = [
      ['name', 'ascending', ['a', 'b', 'c', 'd']], ['name', 'descending', ['d', 'c', 'a', 'b']],
      ['duration', 'ascending', ['d', 'a', 'b', 'c']], ['duration', 'descending', ['a', 'b', 'd', 'c']],
    ] as const;
    for (const [column, direction, expected] of cases) {
      const result = activityDrilldown(records, { metric: 'completed', page: 0, sort: { column, direction } });
      if (result.state !== 'loaded') throw new Error('sorted-result-missing');
      assert.deepEqual(result.rows.map(row => row.id), expected);
    }
    assert.deepEqual(records.map(row => row.id), ['d', 'b', 'a', 'c']);
    const value = report();
    const selection = { metric: 'timed', workflow: 'sample-separations', sort: { column: 'duration', direction: 'descending' } } as const;
    const first = activityDrilldown(value.runs, { ...selection, page: 0 });
    const second = activityDrilldown(value.runs, { ...selection, page: 1 });
    if (first.state !== 'loaded' || second.state !== 'loaded') throw new Error('sorted-page-missing');
    const combined = [...first.rows, ...second.rows];
    assert.equal(combined.length, 24); assert.equal(new Set(combined.map(row => row.id)).size, 24);
    assert(combined.every((row, index) => index === 0 || combined[index - 1].seconds! >= row.seconds!));
    assert.equal(combined[0].seconds, Math.max(...combined.map(row => row.seconds!)));
  });
  it('filters all matching runs by name or exact identity before paging and retains ordering', () => {
    const value = report();
    const base: ActivityBrowse = { metric: 'timed', workflow: 'sample-separations', page: 1 };
    const ordered = setActivityOrder(base, 'duration-descending');
    assert.equal(ordered.page, 0); assert.equal(activityOrderValue(ordered), 'duration-descending');
    assert.equal(activityOrderValue(setActivityOrder(ordered, 'default')), 'default');
    assert.throws(() => setActivityOrder(base, 'unknown'), /ACTIVITY_ORDER_INVALID/);
    const first = value.runs.find(row => row.workflowId === base.workflow && row.status === 'completed' && row.seconds !== null)!;
    for (const query of [first.displayId.toLowerCase(), first.id]) {
      const result = activityDrilldown(value.runs, { ...ordered, query });
      if (result.state !== 'loaded') throw new Error('filtered-result-missing');
      assert.deepEqual(result.rows, [first]); assert.equal(result.total, 24);
    }
    const selection = { ...ordered, query: '  JORDAN   lee  ' };
    const result = activityDrilldown(value.runs, selection); if (result.state !== 'loaded') throw new Error('name-filter-missing');
    assert(result.matches.length > 1); assert(result.matches.every(row => row.subject === 'Jordan Lee'));
    assert(result.rows.every((row, index) => index === 0 || result.rows[index - 1].seconds! >= row.seconds!));
    assert.equal(activityDrilldown(value.runs, { ...selection, run: value.runs.find(row => row.subject === 'Casey Rivera')!.id }).state, 'unavailable');
    const empty = activityDrilldown(value.runs, { ...ordered, query: 'no such person' });
    if (empty.state !== 'loaded') throw new Error('empty-filter-missing');
    assert.equal(empty.rows.length, 0); assert.equal(empty.total, 24);
    const unchanged = activityDrilldown(value.runs, { ...ordered, query: '   ' });
    if (unchanged.state !== 'loaded') throw new Error('empty-query-missing');
    assert.equal(unchanged.matches.length, 24);
  });
  it('uses a filter bar, leaves headers passive and retains search focus and exact log coordinates', async () => {
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
    const value = report(); const onSelection = vi.fn<ActivitySelectionHandler>();
    const initial: ActivityBrowse = { metric: 'timed', workflow: 'sample-separations', page: 1, sort: { column: 'name', direction: 'ascending' } };
    try {
      await act(async () => root.render(createElement(ActivityDrilldown, { report: value, selection: initial, onSelection })));
      const input = host.querySelector<HTMLInputElement>('input[aria-label="Search runs"]'); assert(input);
      assert(input.closest('.ds-search-field--toolbar'));
      assert.equal(host.querySelectorAll('thead button, thead [aria-sort]').length, 0);
      assert.equal(host.querySelector('[role="group"]')?.getAttribute('aria-label'), 'Run filters');
      assert.equal(host.querySelector('[role="combobox"]')?.getAttribute('data-value'), 'name-ascending');
      await act(async () => input.focus());
      const searched: ActivityBrowse = { ...initial, query: 'Jordan', page: 0 };
      await act(async () => root.render(createElement(ActivityDrilldown, { report: value, selection: searched, onSelection })));
      assert.equal(document.activeElement, input); assert.equal(input.value, 'Jordan');
      const result = activityDrilldown(value.runs, searched); if (result.state !== 'loaded') throw new Error('filtered-run-missing');
      assert.match(host.querySelector('[role="status"]')?.textContent ?? '', new RegExp(`${result.matches.length} of 24 completed runs`));
      await act(async () => host.querySelector<HTMLButtonElement>('tbody button')!.click());
      assert.deepEqual(onSelection.mock.calls[0], [{ ...searched, run: result.rows[0].id }]);
      const empty = { ...searched, query: 'no such person' };
      await act(async () => root.render(createElement(ActivityDrilldown, { report: value, selection: empty, onSelection })));
      assert.match(host.textContent ?? '', /No runs match your search/);
      assert.equal(host.querySelector('[role="combobox"]')?.getAttribute('data-value'), 'name-ascending');
    } finally { await act(async () => root.unmount()); host.remove(); }
  });
});
