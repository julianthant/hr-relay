import { vi } from "vitest";
// @vitest-environment jsdom
import assert_m0 from 'node:assert/strict';
import { act as act_m0,createElement as createElement_m0 } from 'react';
import { createRoot as createRoot_m0 } from 'react-dom/client';
import { afterEach as afterEach_m0,beforeEach as beforeEach_m0,describe as describe_m0,it as it_m0 } from 'vitest';
import { type ActivityBrowse as ActivityBrowse_m0 } from '../../../../src/dashboard/surfaces/activity/activity-drilldown-model.js';
import { ActivityDrilldown as ActivityDrilldown_m0 } from '../../../../src/dashboard/surfaces/activity/activity-drilldown.js';
import { ACTIVITY_SAMPLE_RANGE as ACTIVITY_SAMPLE_RANGE_m0,activitySample as activitySample_m0 } from '../../../../src/dashboard/surfaces/activity/activity-fixture.js';
// @vitest-environment jsdom
import assert_m1 from 'node:assert/strict';
import { act as act_m1,createElement as createElement_m1 } from 'react';
import { createRoot as createRoot_m1 } from 'react-dom/client';
import { it as it_m1 } from 'vitest';
import { ActivityBreadcrumbs as ActivityBreadcrumbs_m1 } from '../../../../src/dashboard/surfaces/activity/activity-drilldown.js';
import { ACTIVITY_SAMPLE_RANGE as ACTIVITY_SAMPLE_RANGE_m1,activitySample as activitySample_m1 } from '../../../../src/dashboard/surfaces/activity/activity-fixture.js';


{


const _beforeEachFixture0 = () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
};
const _afterEachFixture1 = () => vi.unstubAllGlobals();

function report(scenario: 'normal' | 'incomplete' | 'empty' = 'normal') {
  const data = activitySample_m0(ACTIVITY_SAMPLE_RANGE_m0, scenario);
  assert_m0.equal(data.state, 'loaded');
  if (data.state !== 'loaded' || !data.report.runs) throw new Error('activity-test-records-missing');
  return { ...data.report, runs: data.report.runs };
}

describe_m0('Activity drilldown records and navigation', () => {
beforeEach_m0(_beforeEachFixture0);
afterEach_m0(_afterEachFixture1);

  it_m0('names the chosen workflow and only repeats facts that vary within the selected scope', async () => {
    const host = document.createElement('div'); document.body.append(host);
    const root = createRoot_m0(host);
    const value = report(); const onSelection = vi.fn();
    const cases: readonly { selection: ActivityBrowse_m0; title: string; columns: readonly string[] }[] = [
      { selection: { metric: 'timed', workflow: 'sample-separations', page: 0 }, title: 'Separations run times', columns: ['Name', 'Duration'] },
      { selection: { metric: 'completed', page: 0 }, title: 'Completed runs', columns: ['Name', 'Workflow', 'Duration'] },
      { selection: { metric: 'failed', page: 0 }, title: 'Failed runs', columns: ['Name', 'Workflow', 'Duration'] },
      { selection: { metric: 'outstanding', page: 0 }, title: 'Outstanding runs', columns: ['Name', 'Workflow', 'Status', 'Duration'] },
    ];
    try {
      for (const scenario of cases) {
        await act_m0(async () => root.render(createElement_m0(ActivityDrilldown_m0, { report: value, selection: scenario.selection, onSelection })));
        assert_m0.equal(host.querySelector('h2')?.textContent, scenario.title);
        const table = host.querySelector('table'); assert_m0(table);
        assert_m0.equal(table.getAttribute('aria-label'), scenario.title);
        assert_m0.deepEqual([...table.querySelectorAll('th')].map(cell => cell.textContent), scenario.columns);
        assert_m0([...table.querySelectorAll('tbody tr')].every(row => row.children.length === scenario.columns.length));
        if (scenario.selection.metric === 'timed') {
          assert_m0.match(host.textContent ?? '', /24 completed runs with recorded duration/);
          assert_m0.doesNotMatch(table.textContent ?? '', /Separations|Done/);
          await act_m0(async () => table.querySelector<HTMLButtonElement>('tbody button')!.click());
          assert_m0.deepEqual(onSelection.mock.calls[0], [{ ...scenario.selection, run: value.runs.find(row => row.workflowId === 'sample-separations' && row.status === 'completed' && row.seconds !== null)!.id }]);
        }
        if (scenario.selection.metric === 'outstanding') {
          assert_m0.match(table.textContent ?? '', /Running/); assert_m0.match(table.textContent ?? '', /Review/);
        }
      }
    } finally { await act_m0(async () => root.unmount()); host.remove(); }
  });
});
}

{


const _beforeEachFixture0 = () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
};
const _afterEachFixture1 = () => vi.unstubAllGlobals();

it_m1('returns from exact Analytics logs to the same filtered page, or directly to the overview', async () => {
try {
_beforeEachFixture0();

  const data = activitySample_m1(ACTIVITY_SAMPLE_RANGE_m1, 'normal'); assert_m1.equal(data.state, 'loaded');
  if (data.state !== 'loaded' || !data.report.runs) throw new Error('breadcrumb-test-report-missing');
  const run = data.report.runs.filter(row => row.status === 'completed' && row.workflowId === 'sample-separations' && row.seconds !== null)[20];
  assert_m1(run);
  const selection = { metric: 'timed' as const, workflow: run.workflowId, page: 1, run: run.id };
  const onSelection = vi.fn();
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot_m1(host);
  try {
    await act_m1(async () => root.render(createElement_m1(ActivityBreadcrumbs_m1, { report: data.report, selection, onSelection })));
    const nav = host.querySelector('nav[aria-label="Analytics breadcrumbs"]'); assert_m1(nav);
    assert_m1.equal(nav.querySelector('[aria-current="page"]')?.textContent, run.subject);
    const parents = [...nav.querySelectorAll('button')];
    await act_m1(async () => parents[1].click());
    assert_m1.deepEqual(onSelection.mock.calls[0], [{ ...selection, run: undefined }]);
    await act_m1(async () => parents[0].click());
    assert_m1.deepEqual(onSelection.mock.calls[1], [null]);
  } finally { await act_m1(async () => root.unmount()); host.remove(); }

} finally {
_afterEachFixture1();
}
});
}
