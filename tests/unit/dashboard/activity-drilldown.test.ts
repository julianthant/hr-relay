// @vitest-environment jsdom
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, it, vi } from 'vitest';
import { ActivityReport } from '../../../src/dashboard/surfaces/activity/activity.js';
import { activitySample, ACTIVITY_SAMPLE_RANGE } from '../../../src/dashboard/surfaces/activity/activity-fixture.js';
import { activityDrilldown, ACTIVITY_RUN_PAGE_SIZE } from '../../../src/dashboard/surfaces/activity/activity-drilldown-model.js';
import { parseViewRoute } from '../../../src/dashboard/app/navigation/view-route-model.js';
import { parseRoute, routeToSearch } from '../../../src/dashboard/app/navigation/url-state.js';

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
  it('bounds and validates public Activity coordinates in the existing history schema', () => {
    const browse = { metric: 'timed', workflow: 'sample-separations', page: 1, run: 'activity-sample-4' } as const;
    assert.deepEqual(parseViewRoute(JSON.stringify({ activityBrowse: browse })), { activityBrowse: browse });
    for (const invalid of [{ ...browse, metric: 'all' }, { ...browse, page: -1 }, { ...browse, subject: 'private draft' }]) assert.equal(parseViewRoute(JSON.stringify({ activityBrowse: invalid })), null);
    const fixture = parseRoute('?settings=activity&activityPreview=empty');
    assert.equal(fixture.view?.activityPreview, 'empty');
    assert.equal(parseRoute(routeToSearch({ ...fixture, view: { ...fixture.view, activityBrowse: browse } })).view?.activityPreview, 'empty');
    assert.equal(parseRoute('?settings=activity&activityPreview=missing').viewInvalid, true);
  });
  it('opens a matching run and returns to its list and overview through mounted controls', async () => {
    const host = document.createElement('div'); document.body.append(host);
    const root = createRoot(host);
    const click = async (selector: string) => {
      const element = host.querySelector<HTMLButtonElement>(selector); assert(element);
      await act(async () => element.click());
    };
    try {
      await act(async () => root.render(createElement(ActivityReport, { range: '', onRange: () => {} })));
      assert.equal(host.querySelector('h1')?.textContent, 'Analytics');
      await click('button[aria-label="View completed runs (38)"]');
      assert.equal(host.querySelectorAll('tbody tr').length, 20);
      await click('button[aria-label^="Open logs for"]');
      assert(host.querySelector('section[aria-label="Selected run logs"]'));
      assert.match(host.textContent ?? '', /Attempt #1/);
      const breadcrumbs = () => host.querySelector('nav[aria-label="Analytics breadcrumbs"]');
      assert.equal(breadcrumbs()?.querySelector('[aria-current="page"]')?.textContent, host.querySelector('section[aria-label="Selected run logs"] h2')?.textContent);
      const back = [...breadcrumbs()!.querySelectorAll('button')].find(button => button.textContent === 'Completed runs'); assert(back);
      await act(async () => back.click());
      assert.match(host.textContent ?? '', /1–20 of 38/);
      assert.equal(breadcrumbs()?.querySelector('[aria-current="page"]')?.textContent, 'Completed runs');
      const overview = [...breadcrumbs()!.querySelectorAll('button')].find(button => button.textContent === 'Analytics'); assert(overview);
      await act(async () => overview.click());
      assert(host.querySelector('button[aria-label="View completed runs (38)"]'));
    } finally { await act(async () => root.unmount()); host.remove(); }
  });
});
