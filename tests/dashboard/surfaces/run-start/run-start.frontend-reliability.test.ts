// @vitest-environment jsdom
import assert from 'node:assert/strict';
import { act,createElement,useState } from 'react';
import { createRoot,type Root } from 'react-dom/client';
import { afterEach,describe,it,vi } from 'vitest';
import type { AppRouteState } from '../../../../src/dashboard/app/navigation/url-state.js';
import { ViewNavigationProvider } from '../../../../src/dashboard/app/navigation/view-navigation.js';
import { createDashboardClient } from '../../../../src/dashboard/client/index.js';
import { ToastProvider } from '../../../../src/dashboard/ds/ui.js';
import { DashboardClientProvider } from '../../../../src/dashboard/state/client-context.js';
import { RunStartSurfaces } from '../../../../src/dashboard/surfaces/run-start/run-start.js';
import { seedMockRuns } from '../../../../src/dashboard/surfaces/workflows/mocks/workflow-mock-model.js';
import { buildWorkflowCatalog } from '../../../../src/dashboard/surfaces/workflows/workflow-catalog-model.js';

Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
let root: Root | undefined;
afterEach(async () => { await act(async () => root?.unmount()); document.body.replaceChildren(); vi.useRealTimers(); vi.unstubAllGlobals(); });
async function mount(element: ReturnType<typeof createElement>) { const host = document.createElement('div'); document.body.append(host); root = createRoot(host); await act(async () => root?.render(element)); return host; }
const button = (name: string) => { const found = [...document.querySelectorAll('button')].find(node => (node.getAttribute('aria-label') ?? node.textContent?.trim()) === name); assert(found, name); return found; };
const press = async (name: string) => act(async () => button(name).click());
describe('mounted frontend reliability contracts', () => {
  it('keeps mock rerun stages under the mock form when its routed dialog mounts or restores', async () => {
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
    const runs = seedMockRuns(), source = runs.find(run => run.workflowId === 'onboarding'); assert(source);
    const previewLaunch = { workflowId: source.workflowId, source }, catalog = buildWorkflowCatalog([]);
    const requests: string[] = [];
    const client = createDashboardClient({ baseUrl: 'http://localhost', fetchImpl: async url => { requests.push(String(url)); throw new Error('Unexpected backend request'); } });
    let current: AppRouteState;
    function Harness() {
      const [route, setRoute] = useState<AppRouteState>({ start: true, view: { launchStage: 'Steps' } }); current = route;
      return createElement(ViewNavigationProvider, { route, setRoute, children: createElement(DashboardClientProvider, { client, children: createElement(ToastProvider, { children: createElement(RunStartSurfaces, {
        catalog, open: true, onOpenChange: () => {}, panelWorkflowId: previewLaunch.workflowId, actorId: 'local-operator', previewLaunch, previewRuns: runs,
        onSubmitPreview: () => {}, onOpenIntake: () => { throw new Error('Unexpected intake'); },
      }) }) }) });
    }
    await mount(createElement(Harness));
    assert.match(document.body.textContent ?? '', /Choose what to run again/u);
    assert.equal(current!.view?.launchStage, 'Steps');
    await press('Continue'); assert.match(document.body.textContent ?? '', /Values for the new run/u);
    assert.equal(current!.view?.launchStage, 'Values');
    await press('Back'); assert.equal(current!.view?.launchStage, 'Steps');
    await press('Continue'); await press('Continue'); await press('Preview plan');
    assert.match(document.body.textContent ?? '', /Review the plan/u); assert.equal(current!.view?.launchStage, 'Confirm');
    assert.deepEqual(requests, [], 'a local mock rerun must not ask a served planner to reconcile its stage');
  });
});
