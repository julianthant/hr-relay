// @vitest-environment jsdom
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, it } from 'vitest';
import { DashboardApp } from '../../../src/dashboard/app/dashboard-app.js';
import { DashboardClientProvider } from '../../../src/dashboard/state/client-context.js';
import { createDashboardClient } from '../../../src/dashboard/client/index.js';
import { createFixtureBff } from '../../parity/helpers/fixture-bff.js';
import { FIXTURE_DAY_WIRE } from '../../parity/helpers/fixture-queue.js';
import { DashboardDayWireSchema, type DashboardDayWire } from '../../../src/domain/dashboard/projection.js';

Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
Reflect.set(globalThis, 'ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
let root: Root | undefined;
const disposers: (() => void)[] = [];
afterEach(async () => {
  await act(async () => root?.unmount()); root = undefined;
  for (const dispose of disposers.splice(0)) dispose();
  document.body.replaceChildren(); localStorage.clear(); window.history.replaceState(null, '', '/');
});
async function settle() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); }); }

async function mount(options: { boot?: Promise<Response>; bootFailure?: boolean; delayDay?: boolean } = {}) {
  const { app } = createFixtureBff();
  const streams: ReadableStreamDefaultController<Uint8Array>[] = [];
  const requests: { url: string; resume?: string | null }[] = [];
  let open = true;
  const publish = (stream: ReadableStreamDefaultController<Uint8Array>, message: unknown) => stream.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(message)}\n\n`));
  const snapshot = (stream: ReadableStreamDefaultController<Uint8Array>, day: DashboardDayWire) => {
    publish(stream, { type: 'hello', wireVersion: 1, descriptorHash: day.descriptorHash, projectionGeneration: day.projectionGeneration, cursor: day.snapshotCursor });
    publish(stream, { type: 'snapshot', topic: 'dashboard-day', cursor: day.snapshotCursor, payload: day });
  };
  const client = createDashboardClient({ baseUrl: 'http://fault.test', fetchImpl: async (url, init) => {
    const headers = new Headers(init?.headers);
    requests.push({ url, resume: headers.get('last-event-id') });
    if (url.endsWith('/bootstrap')) {
      if (options.boot) return options.boot;
      if (options.bootFailure) return Response.json({ code: 'FIXTURE_UNAVAILABLE', message: 'Synthetic boot unavailable' }, { status: 503 });
    }
    if (url.includes('/events/v1?')) {
      const body = new ReadableStream<Uint8Array>({ start(controller) {
        streams.push(controller);
        if (!options.delayDay) snapshot(controller, FIXTURE_DAY_WIRE);
        const abort = () => { try { controller.close(); } catch { /* The fixture may already be disconnected. */ } };
        init?.signal?.addEventListener('abort', abort, { once: true });
        disposers.push(() => init?.signal?.removeEventListener('abort', abort));
      } });
      return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
    }
    assert(open, 'no request after fixture disposal');
    return app.request(url, init);
  } });
  window.history.replaceState(null, '', `/?day=${FIXTURE_DAY_WIRE.day}`);
  localStorage.setItem('hr-dashboard.workflow-panel', 'sidebar');
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root?.render(createElement(DashboardClientProvider, { client, children: createElement(DashboardApp) })));
  await settle(); disposers.push(() => { open = false; });
  return { host, requests, streams,
    deliver: async (day: DashboardDayWire, index = streams.length - 1) => { await act(async () => snapshot(streams[index], day)); await settle(); },
    disconnect: async () => { await act(async () => streams.at(-1)!.error(new Error('Synthetic disconnect'))); await settle(); },
    stale: async (day: DashboardDayWire) => { await act(async () => publish(streams.at(-1)!, { type: 'snapshot', topic: 'dashboard-day', cursor: day.snapshotCursor, payload: day })); await settle(); },
  };
}
function withTitle(title: string, cursor: string, revision: number): DashboardDayWire {
  return DashboardDayWireSchema.parse({ ...FIXTURE_DAY_WIRE, snapshotCursor: cursor,
    queueSurfaces: FIXTURE_DAY_WIRE.queueSurfaces.map(row => row.surfaceKind === 'single' ? { ...row, title, rowRevision: revision, actions: row.actions.map(action => action.kind === "command" ? { ...action, expectedVersion: revision } : action) } : row) });
}

describe('real mounted dashboard through the typed mock transport', () => {
  it('keeps slow bootstrap in loading geometry until a parsed response arrives', async () => {
    let resolve!: (response: Response) => void;
    const boot = new Promise<Response>(done => { resolve = done; });
    const h = await mount({ boot });
    assert(h.host.querySelector('[aria-busy="true"]'));
    assert.doesNotMatch(h.host.textContent ?? '', /No workflows|No .* runs|Could not load/u);
    const { app } = createFixtureBff();
    await act(async () => resolve(await app.request('/api/v1/bootstrap'))); await settle();
    assert(h.host.querySelector('[aria-label="Queue"]'));
  });
  it('shows an unavailable bootstrap without fixture success or a misleading empty queue', async () => {
    const h = await mount({ bootFailure: true });
    assert(h.host.querySelector('[data-parity-ready="failed"]'));
    assert.equal(h.host.querySelector('[aria-label="Queue"]'), null);
    assert.equal(h.streams.length, 0);
  });
  it('keeps an initially slow stream distinct from a loaded empty day', async () => {
    const h = await mount({ delayDay: true });
    assert(h.host.querySelector('[aria-busy="true"]'));
    assert.doesNotMatch(h.host.textContent ?? '', /No Person Lookup runs/u);
    await h.deliver(FIXTURE_DAY_WIRE);
    assert(h.host.querySelector('[aria-label="Queue"]'));
  });
  it('ignores an older cursor after the current exact queue snapshot', async () => {
    const h = await mount();
    await h.deliver(withTitle('Current synthetic record', 'pc:200', 200));
    assert.match(h.host.textContent ?? '', /Current synthetic record/u);
    await h.stale(withTitle('Stale synthetic record', 'pc:199', 199));
    assert.doesNotMatch(h.host.textContent ?? '', /Stale synthetic record/u);
    assert.match(h.host.textContent ?? '', /Current synthetic record/u);
  });
  it('retains the last queue during reconnect and resumes with its exact cursor', async () => {
    const h = await mount();
    await h.deliver(withTitle('Before disconnect', 'pc:200', 200)); await h.disconnect();
    assert.match(h.host.textContent ?? '', /Before disconnect/u);
    for (let count = 0; count < 100 && h.streams.length < 2; count++) await settle();
    assert.equal(h.streams.length, 2);
    assert.equal(h.requests.filter(request => request.url.includes('/events/v1?')).at(-1)?.resume, 'pc:200');
    await h.deliver(withTitle('After reconnect', 'pc:201', 201));
    assert.match(h.host.textContent ?? '', /After reconnect/u);
    assert.doesNotMatch(h.host.textContent ?? '', /Before disconnect/u);
  });
});
