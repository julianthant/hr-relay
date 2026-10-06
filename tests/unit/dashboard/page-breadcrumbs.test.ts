// @vitest-environment jsdom
import assert from 'node:assert/strict';
import { act, createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, it, vi } from 'vitest';
import { PageBreadcrumbs, ToastProvider } from '../../../src/dashboard/ds/ui.js';
import { MockArchiveWorkspace } from '../../../src/dashboard/surfaces/archive/archive-mock.js';
import { MOCK_ARCHIVE_RUNS } from '../../../src/dashboard/surfaces/archive/archive-mock-model.js';
import type { ArchiveBrowseState } from '../../../src/dashboard/app/navigation/archive-route-model.js';
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

it('navigates Archive report tabs through discrete history writes while retaining report and filter context', async () => {
  const run = MOCK_ARCHIVE_RUNS.find(row => row.number === 48231); assert(run);
  const writes: { browse: ArchiveBrowseState; mode: 'push' | 'replace' }[] = [];
  const exit = vi.fn();
  function Report() {
    const [browse, setBrowse] = useState<ArchiveBrowseState>({ filters: { search: 'Cameron' } });
    return createElement(ToastProvider, { children: createElement(MockArchiveWorkspace, {
      catalog: [], selection: run!.id, view: 'runs',
      folder: { dashboardKey: run!.dashboard, workflow: run!.workflow }, browse,
      onBrowse: (next, mode = 'push') => { writes.push({ browse: next, mode }); setBrowse(next); },
      onSelection: exit, onView: exit, onFolder: exit, onOpenReport: exit,
    }) });
  }
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(Report)));
    const tab = (label: string) => {
      const target = [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(button => button.textContent?.startsWith(label));
      assert(target); return target;
    };
    await act(async () => { tab('Saved settings').focus(); tab('Saved settings').click(); });
    assert.equal(tab('Saved settings').getAttribute('aria-selected'), 'true');
    await act(async () => { tab('Retained files').focus(); tab('Retained files').click(); });
    assert.equal(tab('Retained files').getAttribute('aria-selected'), 'true');
    assert.deepEqual(writes, [
      { browse: { filters: { search: 'Cameron' }, section: 3 }, mode: 'push' },
      { browse: { filters: { search: 'Cameron' }, section: 4 }, mode: 'push' },
    ]);
    assert.match(host.querySelector('h1')?.textContent ?? '', /Cameron Davis/u);
    assert.equal(exit.mock.calls.length, 0);
  } finally { await act(async () => root.unmount()); host.remove(); }
});
