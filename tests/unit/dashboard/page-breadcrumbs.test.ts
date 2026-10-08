// @vitest-environment jsdom
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, it, vi } from 'vitest';
import { PageBreadcrumbs } from '../../../src/dashboard/ds/ui.js';
import { ActivityBreadcrumbs } from '../../../src/dashboard/surfaces/activity/activity-drilldown.js';
import { activitySample, ACTIVITY_SAMPLE_RANGE } from '../../../src/dashboard/surfaces/activity/activity-fixture.js';

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => vi.unstubAllGlobals());

it('exposes the current page as text and leaves parent navigation with its guarded owner', async () => {
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  const parent = vi.fn(); const current = vi.fn();
  try {
    await act(async () => root.render(createElement(PageBreadcrumbs, { label: 'Settings breadcrumbs', items: [
      { label: 'Dashboard', onClick: parent }, { label: 'Settings', onClick: current },
    ] })));
    assert.equal(host.querySelector('nav')?.getAttribute('aria-label'), 'Settings breadcrumbs');
    const page = host.querySelector<HTMLElement>('[aria-current="page"]'); assert(page);
    assert.equal(page.textContent, 'Settings'); assert.equal(page.getAttribute('role'), null);
    assert.equal(page.tabIndex, -1); assert.equal(host.querySelectorAll('button').length, 1);
    await act(async () => host.querySelector('button')!.click());
    assert.equal(parent.mock.calls.length, 1); assert.equal(current.mock.calls.length, 0);
    assert.equal(host.querySelector('[aria-current="page"]')?.textContent, 'Settings');
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it('returns from exact Analytics logs to the same filtered page, or directly to the overview', async () => {
  const data = activitySample(ACTIVITY_SAMPLE_RANGE, 'normal'); assert.equal(data.state, 'loaded');
  if (data.state !== 'loaded' || !data.report.runs) throw new Error('breadcrumb-test-report-missing');
  const run = data.report.runs.filter(row => row.status === 'completed' && row.workflowId === 'sample-separations' && row.seconds !== null)[20];
  assert(run);
  const selection = { metric: 'timed' as const, workflow: run.workflowId, page: 1, run: run.id };
  const onSelection = vi.fn();
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(ActivityBreadcrumbs, { report: data.report, selection, onSelection })));
    const nav = host.querySelector('nav[aria-label="Analytics breadcrumbs"]'); assert(nav);
    assert.equal(nav.querySelector('[aria-current="page"]')?.textContent, run.subject);
    const parents = [...nav.querySelectorAll('button')];
    await act(async () => parents[1].click());
    assert.deepEqual(onSelection.mock.calls[0], [{ ...selection, run: undefined }]);
    await act(async () => parents[0].click());
    assert.deepEqual(onSelection.mock.calls[1], [null]);
  } finally { await act(async () => root.unmount()); host.remove(); }
});
