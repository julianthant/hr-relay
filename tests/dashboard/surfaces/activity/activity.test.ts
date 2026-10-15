import { vi } from "vitest";
// @vitest-environment jsdom
import { default as assert_m0,default as assert_m1 } from 'node:assert/strict';
import { act as act_m0,createElement as createElement_m0,createElement as createElement_m1 } from 'react';
import { createRoot as createRoot_m0 } from 'react-dom/client';
import { renderToStaticMarkup as renderToStaticMarkup_m1 } from "react-dom/server";
import { afterEach as afterEach_m0,beforeEach as beforeEach_m0,describe as describe_m0,describe as describe_m1,it as it_m0,it as it_m1 } from 'vitest';
import { ACTIVITY_SAMPLE_TODAY as ACTIVITY_SAMPLE_TODAY_m0 } from '../../../../src/dashboard/surfaces/activity/activity-fixture.js';
import { activityPresetRange as activityPresetRange_m0,activityRangeValue as activityRangeValue_m0 } from '../../../../src/dashboard/surfaces/activity/activity-model.js';
import { ActivityReport as ActivityReport_m0,ActivityReport as ActivityReport_m1 } from '../../../../src/dashboard/surfaces/activity/activity.js';
import { WorkflowExplorer as WorkflowExplorer_m1 } from "../../../../src/dashboard/surfaces/explorer/explorer.js";
import { LogSample as LogSample_m1 } from "../../../../src/dashboard/surfaces/run-detail/logs/log-sample.js";
import { buildWorkflowCatalog as buildWorkflowCatalog_m1 } from "../../../../src/dashboard/surfaces/workflows/workflow-catalog-model.js";


{


const _beforeEachFixture0 = () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
};
const _afterEachFixture1 = () => vi.unstubAllGlobals();

describe_m0('Activity drilldown records and navigation', () => {
beforeEach_m0(_beforeEachFixture0);
afterEach_m0(_afterEachFixture1);

  it_m0('opens a matching run and returns to its list and overview through mounted controls', async () => {
    const host = document.createElement('div'); document.body.append(host);
    const root = createRoot_m0(host);
    const click = async (selector: string) => {
      const element = host.querySelector<HTMLButtonElement>(selector); assert_m0(element);
      await act_m0(async () => element.click());
    };
    try {
      await act_m0(async () => root.render(createElement_m0(ActivityReport_m0, { source: "mock", range: '', onRange: () => {} })));
      assert_m0.equal(host.querySelector('h1')?.textContent, 'Analytics');
      await click('button[aria-label="View completed runs (38)"]');
      assert_m0.equal(host.querySelectorAll('tbody tr').length, 20);
      await click('button[aria-label^="Open logs for"]');
      assert_m0(host.querySelector('section[aria-label="Selected run logs"]'));
      assert_m0.doesNotMatch(host.querySelector('section[aria-label="Selected run logs"] header')?.textContent ?? '', /Attempt #|Elapsed/);
      const breadcrumbs = () => host.querySelector('nav[aria-label="Analytics breadcrumbs"]');
      assert_m0.equal(breadcrumbs()?.querySelector('[aria-current="page"]')?.textContent, host.querySelector('section[aria-label="Selected run logs"] h2')?.textContent);
      const back = [...breadcrumbs()!.querySelectorAll('button')].find(button => button.textContent === 'Completed runs'); assert_m0(back);
      await act_m0(async () => back.click());
      assert_m0.match(host.textContent ?? '', /1–20 of 38/);
      assert_m0.equal(breadcrumbs()?.querySelector('[aria-current="page"]')?.textContent, 'Completed runs');
      const overview = [...breadcrumbs()!.querySelectorAll('button')].find(button => button.textContent === 'Analytics'); assert_m0(overview);
      await act_m0(async () => overview.click());
      assert_m0(host.querySelector('button[aria-label="View completed runs (38)"]'));
    } finally { await act_m0(async () => root.unmount()); host.remove(); }
  });
  it_m0('keeps Custom selected when its applied dates equal a preset', async () => {
    const host = document.createElement('div'); document.body.append(host);
    const root = createRoot_m0(host);
    const changes: string[] = [];
    const preset = activityPresetRange_m0('this-week', ACTIVITY_SAMPLE_TODAY_m0);
    const applied = activityRangeValue_m0(preset);
    const fullDayLabel = (day: string) => new Intl.DateTimeFormat('en-US', {
      timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    }).format(new Date(`${day}T00:00:00Z`));
    const rangeCell = (day: string) => {
      const label = fullDayLabel(day);
      const cells = [...document.body.querySelectorAll<HTMLElement>('[aria-label]')].filter(element =>
        element.getAttribute('aria-label')?.includes(label) === true && element.textContent?.trim() === String(Number(day.slice(8))));
      assert_m0.equal(cells.length, 1, `expected one range cell for "${label}", found ${String(cells.length)}`);
      const found = cells[0];
      assert_m0.ok(found, `no range cell for "${label}"`);
      return found;
    };
    try {
      await act_m0(async () => { root.render(createElement_m0(ActivityReport_m0, { source: "mock", range: applied, onRange: next => { changes.push(next); } })); });
      const period = () => host.querySelector<HTMLElement>('button[aria-label="Report period"]');
      const periodValue = () => host.querySelector<HTMLElement>('button[aria-label="Report period"] [data-slot="select-value"]')?.textContent?.trim();
      assert_m0.equal(period()?.getAttribute('data-value'), 'this-week');
      assert_m0.equal(periodValue(), 'This week');
      // The operator picks Custom first, then edits dates — the ordinary way to name a range by hand.
      await act_m0(async () => { period()!.click(); });
      const custom = [...document.body.querySelectorAll<HTMLElement>('[role="option"]')].find(option => option.textContent?.trim() === 'Custom range');
      assert_m0.ok(custom, 'the period control offers its Custom range preset');
      await act_m0(async () => { custom.click(); });
      assert_m0.equal(period()?.getAttribute('data-value'), 'custom');
      assert_m0.deepEqual(changes, [], 'choosing Custom edits no range on its own');
      const trigger = host.querySelector<HTMLButtonElement>('button[aria-label="Choose start date range"]');
      assert_m0.ok(trigger, 'the range control owns its calendar trigger');
      await act_m0(async () => { trigger.click(); });
      for (const day of [preset.from, preset.to]) await act_m0(async () => { rangeCell(day).click(); });
      assert_m0.deepEqual(changes, [applied], 'the applied range is exactly the preset it equals');
      assert_m0.equal(period()?.getAttribute('data-value'), 'custom', 'an applied range equal to a preset keeps the operator\'s Custom choice');
      assert_m0.equal(periodValue(), 'Custom range');
    } finally { await act_m0(async () => root.unmount()); host.remove(); }
  });
});
}

{


const noop = () => {};
describe_m1("frontend presentation producers", () => {
  it_m1("renders canonical surfaces without a client provider or registered-definition fallback", () => {
    const activity = renderToStaticMarkup_m1(createElement_m1(ActivityReport_m1, { source: "mock", range: "", onRange: noop }));
    assert_m1.match(activity, /Workflow outcomes/);
    assert_m1.match(activity, /34 measured/);
    assert_m1.doesNotMatch(activity, /Sample data/);
    const explorer = renderToStaticMarkup_m1(createElement_m1(WorkflowExplorer_m1, { catalog: buildWorkflowCatalog_m1([]) }));
    assert_m1.equal((explorer.match(/data-step-number=/g) ?? []).length, 22);
    assert_m1.doesNotMatch(explorer, /Registered definition|Back to dashboard/);
    const logs = renderToStaticMarkup_m1(createElement_m1(LogSample_m1));
    assert_m1.match(logs, /Save and Submit/);
    assert_m1.doesNotMatch(logs, /Load more actions|No captures|dry run|Rerun|0s working/);
  });
});
}
