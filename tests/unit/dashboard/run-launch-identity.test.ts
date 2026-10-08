// @vitest-environment jsdom
import assert from 'node:assert/strict';
import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, it } from 'vitest';
import { ViewNavigationProvider } from '../../../src/dashboard/app/navigation/view-navigation.js';
import type { AppRouteState } from '../../../src/dashboard/app/navigation/url-state.js';
import { ViewRouteSchema, type RouteSetter } from '../../../src/dashboard/app/navigation/view-route-model.js';
import { useRunLaunch } from '../../../src/dashboard/surfaces/run-start/run-launch-model.js';

Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
let root: Root | undefined;
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; document.body.replaceChildren(); });

const RAW = { runId: '00000000-0004-4000-8000-000000000004', expectedVersion: 4, label: 'EID 10555001', traceId: 'pl-090404-0004' };
const sourceOf = (raw: typeof RAW) => { const source = ViewRouteSchema.parse({ launchRerun: raw }).launchRerun; assert.ok(source); return source; };
const SOURCE = sourceOf(RAW);

describe('served rerun launch source identity', () => {
  it('keeps the rerun source identity while unrelated launch coordinates change', async () => {
    const seen: unknown[] = [];
    let update: RouteSetter | undefined;
    function Probe() { seen.push(useRunLaunch(true, 'main').rerunSource); return null; }
    function Harness() {
      const [route, setRoute] = useState<AppRouteState>({ start: true, view: { launchRerun: SOURCE, launchStage: 'Steps' } });
      update = setRoute;
      return createElement(ViewNavigationProvider, { route, setRoute, children: createElement(Probe) });
    }
    const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
    await act(async () => root?.render(createElement(Harness)));
    const first = seen.at(-1);
    assert.deepEqual(first, SOURCE);
    // Advancing a stage re-parses the whole view; the unchanged source must not look like a new rerun.
    await act(async () => update?.(current => ({ ...current, view: { ...current.view, launchRerun: { ...SOURCE }, launchStage: 'Values' } })));
    assert.equal(seen.at(-1), first);
    await act(async () => update?.(current => ({ ...current, view: { ...current.view, launchRerun: sourceOf({ ...RAW, expectedVersion: 5 }) } })));
    assert.notEqual(seen.at(-1), first);
    assert.equal((seen.at(-1) as typeof SOURCE | undefined)?.expectedVersion, 5);
  });
});
