import { servedFixtureSources as previewFixtureSources } from "../../../mocks/helpers/workflow-composition.js";
import { vi } from "vitest";
// @vitest-environment jsdom
import { default as assert_m0,default as assert_m1 } from 'node:assert/strict';
import { act as act_m0,createElement as createElement_m0,createElement as createElement_m1 } from 'react';
import { createRoot as createRoot_m0 } from 'react-dom/client';
import { renderToStaticMarkup as renderToStaticMarkup_m1 } from "react-dom/server";
import { TooltipProvider as TooltipProvider_m1 } from "../../../../src/dashboard/ds/ui.js";
import { afterEach as afterEach_m0,beforeEach as beforeEach_m0,describe as describe_m0,describe as describe_m1,it as it_m0,it as it_m1 } from 'vitest';
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
      await act_m0(async () => root.render(createElement_m0(TooltipProvider_m1, null, createElement_m0(ActivityReport_m0, { source: "mock", range: '', onRange: () => {} }))));
      assert_m0.equal(host.querySelector('h1')?.textContent, 'Analytics');
      await click('button[aria-label="Show Separations details"]');
      const open = [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.trim() === 'Open runs'); assert_m0(open);
      await act_m0(async () => open.click());
      assert_m0.equal(host.querySelectorAll('tbody tr').length, 2);
      await click('button[aria-label^="Open logs for"]');
      assert_m0(host.querySelector('section[aria-label="Selected run logs"]'));
      assert_m0.doesNotMatch(host.querySelector('section[aria-label="Selected run logs"] header')?.textContent ?? '', /Attempt #|Elapsed/);
      const breadcrumbs = () => host.querySelector('nav[aria-label="Analytics breadcrumbs"]');
      assert_m0.equal(breadcrumbs()?.querySelector('[aria-current="page"]')?.textContent, host.querySelector('section[aria-label="Selected run logs"] h2')?.textContent);
      const back = [...breadcrumbs()!.querySelectorAll('button')].find(button => button.textContent !== 'Analytics'); assert_m0(back);
      await act_m0(async () => back.click());
      assert_m0.match(host.textContent ?? '', /1–2 of 2/);
      const overview = [...breadcrumbs()!.querySelectorAll('button')].find(button => button.textContent === 'Analytics'); assert_m0(overview);
      await act_m0(async () => overview.click());
      assert_m0(host.querySelector('button[aria-label="Show Separations details"]'));
    } finally { await act_m0(async () => root.unmount()); host.remove(); }
  });
  it_m0('opens served Analytics on the 7-day preset with no custom range or date fields', async () => {
    const host = document.createElement('div'); document.body.append(host);
    const root = createRoot_m0(host);
    try {
      await act_m0(async () => { root.render(createElement_m0(TooltipProvider_m1, null, createElement_m0(ActivityReport_m0, { source: "served", today: "2026-09-10", range: '', onRange: () => {} }))); });
      const period = host.querySelector<HTMLInputElement>('fieldset input[type="radio"]:checked');
      assert_m0.equal(period?.value, '7d', 'the 7d preset is pressed');
      assert_m0.equal([...host.querySelectorAll('button')].filter(button => /Custom/.test(button.textContent ?? '')).length, 0, 'no Custom range menu');
      assert_m0.equal(host.querySelector('[aria-label="Report date range"], input[type="date"], [aria-label^="Choose start date"]'), null, 'no date fields');
    } finally { await act_m0(async () => root.unmount()); host.remove(); }
  });
});
}

{


const noop = () => {};
describe_m1("frontend presentation producers", () => {
  it_m1("renders canonical surfaces without a client provider or registered-definition fallback", () => {
    const activity = renderToStaticMarkup_m1(createElement_m1(TooltipProvider_m1, null, createElement_m1(ActivityReport_m1, { source: "mock", range: "", onRange: noop })));
    assert_m1.match(activity, /Workflows/);
    assert_m1.doesNotMatch(activity, /Sample data/);
    const explorer = renderToStaticMarkup_m1(createElement_m1(TooltipProvider_m1, null, createElement_m1(WorkflowExplorer_m1, { catalog: buildWorkflowCatalog_m1([], true, previewFixtureSources([])) })));
    assert_m1.equal((explorer.match(/data-step-number=/g) ?? []).length, 22);
    assert_m1.doesNotMatch(explorer, /Registered definition|Back to dashboard/);
    const logs = renderToStaticMarkup_m1(createElement_m1(TooltipProvider_m1, null, createElement_m1(LogSample_m1)));
    assert_m1.match(logs, /Save and Submit/);
    assert_m1.doesNotMatch(logs, /Load more actions|No captures|dry run|Rerun|0s working/);
  });
});
}
