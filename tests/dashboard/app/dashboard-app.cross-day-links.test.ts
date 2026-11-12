import { createPersonPreferences } from "../../../src/dashboard/state/person-preferences-model.js";
import { NEUTRAL_PERSON_PREFERENCES } from "../../../src/models/config/person-preferences.js";
// @vitest-environment jsdom
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, it, vi } from 'vitest';
import { DashboardApp } from '../../../src/dashboard/app/dashboard-app.js';
import { createDashboardClient } from '../../../src/dashboard/client/index.js';
import { DashboardClientProvider } from '../../../src/dashboard/state/client-context.js';
import { DashboardDayWireSchema, QueueSurfaceWireSchema } from '../../../src/models/dashboard/projection.js';
import { RunDetailWireSchema, NotePageSchema } from '../../../src/models/dashboard/run-detail.js';
import { queueParentFixture } from '../../support/helpers/dashboard/queue-parent-fixture.js';
import { FrontendBootstrapWireSchema } from '../../../src/models/dashboard/bootstrap.js';
import { FIXTURE_NOW } from '../../support/fixtures/dashboard/fixture-identity.js';
import { FIXTURE_DAY_WIRE } from '../../mocks/helpers/fixture-queue.js';
import { MOCK_WORKFLOW_COMPOSITION } from '../../mocks/helpers/workflow-composition.js';
import { createFixtureBff } from '../../support/helpers/dashboard/fixture-bff.js';

Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
Reflect.set(globalThis, 'ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
let root: Root | undefined;
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; document.body.replaceChildren(); localStorage.clear(); window.history.replaceState(null, '', '/'); });
it('opens a linked child using its own partition day and exact run identity', async () => {
  const parent = FIXTURE_DAY_WIRE.queueSurfaces.find(row => row.surfaceKind === 'single');
  const child = FIXTURE_DAY_WIRE.queueSurfaces.find(row => row.surfaceKind === 'single' && row.runId !== parent?.runId);
  assert(parent && child);
  const childDay = FIXTURE_DAY_WIRE.day;
  const link = { runId: child.runId, partitionDay: childDay, workflowId: child.workflowId, label: 'Next day child', panelKind: child.panelKind, status: child.status };
  const parentWire = DashboardDayWireSchema.parse({ ...FIXTURE_DAY_WIRE, day: '2026-08-02', queueSurfaces: [{ ...parent, linkedRuns: [link] }] });
  const childWire = DashboardDayWireSchema.parse({ ...FIXTURE_DAY_WIRE, day: childDay, queueSurfaces: [{ ...child,parent: queueParentFixture(parent.runId,{ workflowId: parent.workflowId,partitionDay: parentWire.day,panelKind: parent.panelKind,visibility: 'linked' }) }] });
  const { app } = createFixtureBff();
  const requestedDays: string[] = [];
  const transport = createDashboardClient({ baseUrl: 'http://fixture.test', fetchImpl: async (url, init) => new URL(url).pathname.endsWith('/dashboard')
    ? Response.json(new URL(url).searchParams.get('day') === childDay ? childWire : parentWire) : app.request(url, init) });
  const client = { ...transport, subscribeDay: (input: Parameters<typeof transport.subscribeDay>[0]) => {
    requestedDays.push(input.day);
    input.onDay(input.day === childDay ? childWire : parentWire); input.onState({ state: 'live' });
    return { close: () => undefined };
  } };
  window.history.replaceState(null, '', `/?day=${parentWire.day}`);
  const preview = createPersonPreferences("preview", { ...NEUTRAL_PERSON_PREFERENCES, workflowPanelMode: "sidebar" });
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root?.render(createElement(DashboardClientProvider, { client, children: createElement(DashboardApp, { workflowComposition: MOCK_WORKFLOW_COMPOSITION, previewPreferences: preview }) })));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  const chip = host.querySelector<HTMLButtonElement>('button[aria-label^="Next day child —"]'); assert(chip);
  await act(async () => { chip.click(); await new Promise(resolve => setTimeout(resolve, 20)); });
  const params = new URLSearchParams(window.location.search);
  assert.equal(params.get('day'), childDay);
  assert.equal(params.get('run'), child.runId);
  assert.equal(params.get('section'), 'logs');
  assert.equal(requestedDays.at(-1), childDay);
  assert.equal(host.textContent?.includes('Run unavailable'), false);
});

it('authenticates a child-only OCR destination after midnight when every approved record targets a downstream member', async () => {
  const f = await relatedFixture();
  const preference = f.preferences.snapshot().value.selectedWorkflowId;
  await act(async () => f.chip().click());
  await vi.waitFor(() => assert.equal(new URLSearchParams(window.location.search).get('run'),f.child.runId));
  assert.equal(f.preferences.snapshot().value.selectedWorkflowId,preference);
  assert.equal(new URLSearchParams(window.location.search).get('day'),f.childDay);
  assert.ok(f.reads.includes(`day:${f.childDay}`));
  assert.ok(f.reads.includes(`run:${f.parent.runId}`));
  assert.ok(f.reads.includes(`run:${f.child.runId}`));
  assert.equal(f.host.textContent?.includes('Workflow unavailable'),false);
  assert.equal(f.host.textContent?.includes('Run unavailable'),false);
  await vi.waitFor(() => assert.equal(f.host.querySelector('[aria-label="Selected run logs"] h2')?.textContent,f.child.title));
  assert.ok(f.host.querySelector(`[data-demo-row-id="${f.child.runId}"]`));
  const back = f.host.querySelector<HTMLButtonElement>('button[aria-label*="the run that delegated this one"]');assert.ok(back);
  await act(async () => back.click());
  await vi.waitFor(() => assert.equal(new URLSearchParams(window.location.search).get('run'),f.parent.runId));
  assert.equal(new URLSearchParams(window.location.search).get('day'),f.parentDay);
  assert.equal(f.preferences.snapshot().value.selectedWorkflowId,f.parent.workflowId);
  await vi.waitFor(() => assert.equal(f.host.querySelector('[aria-label="Selected run logs"] h2')?.textContent,f.parent.title));
});

for (const failure of ['missing','wrong-parent','owner-trace','read-failed','wrong-day'] as const) it(`refuses a related destination with ${failure} authority without changing route or preference`,async () => {
  const f = await relatedFixture({ failure });
  const before = window.location.search,preference = f.preferences.snapshot().value.selectedWorkflowId;
  await act(async () => f.chip().click());
  await vi.waitFor(() => assert.ok(f.host.textContent?.includes('Workflow unavailable')));
  assert.equal(window.location.search,before);
  assert.equal(f.preferences.snapshot().value.selectedWorkflowId,preference);
  assert.equal(f.host.textContent?.includes('Discard unsaved settings?'),false);
});

it('drops an old owner revision while exact related-run reads are pending',async () => {
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const f = await relatedFixture({ pending });
  await act(async () => f.chip().click());
  await vi.waitFor(() => assert.ok(f.reads.includes(`day:${f.childDay}`)));
  const before = window.location.search;
  await act(async () => f.changeOwner());
  await act(async () => { release();await pending; });
  await vi.waitFor(() => assert.ok(f.reads.includes(`run:${f.child.runId}`)));
  assert.equal(window.location.search,before);
  assert.equal(f.host.textContent?.includes('Workflow unavailable'),false);
});

it.each(['ready','read-failed'] as const)('leaves a new dirty Settings draft untouched when an older related destination is %s',async outcome => {
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const f = await relatedFixture({ pending,...(outcome === 'read-failed' ? { failure: outcome } : {}) });
  await act(async () => f.chip().click());
  await vi.waitFor(() => assert.ok(f.reads.includes(`day:${f.childDay}`)));
  const settings = f.host.querySelector<HTMLButtonElement>('button[aria-label="Settings"]');assert.ok(settings);
  await act(async () => settings.click());
  await vi.waitFor(() => assert.ok(f.host.querySelector('[data-settings-path="browser.headless"] button[aria-label="Browser window"]')));
  const select = f.host.querySelector<HTMLElement>('[data-settings-path="browser.headless"] button[aria-label="Browser window"]');assert.ok(select);
  await act(async () => select.click());
  const option = document.querySelector<HTMLElement>('[role="option"][data-value="Small"]');assert.ok(option);
  await act(async () => option.click());
  const before = window.location.search,preference = f.preferences.snapshot().value.selectedWorkflowId;
  assert.equal(f.host.querySelector<HTMLElement>('[data-settings-path="browser.headless"] button[aria-label="Browser window"]')?.dataset.value,'Small');
  await act(async () => { release();await pending; });
  if (outcome === 'ready') await vi.waitFor(() => assert.ok(f.reads.includes(`run:${f.child.runId}`)));
  assert.equal(window.location.search,before);
  assert.equal(f.preferences.snapshot().value.selectedWorkflowId,preference);
  assert.equal(f.host.querySelector<HTMLElement>('[data-settings-path="browser.headless"] button[aria-label="Browser window"]')?.dataset.value,'Small');
  assert.equal(f.host.textContent?.includes('Discard unsaved settings?'),false);
  assert.equal(f.host.textContent?.includes('Workflow unavailable'),false);
});

async function relatedFixture(options: Readonly<{ failure?: 'missing' | 'wrong-parent' | 'owner-trace' | 'read-failed' | 'wrong-day';pending?: Promise<void> }> = {}) {
  const base = FIXTURE_DAY_WIRE.queueSurfaces.find(row => row.surfaceKind === 'operation'); assert.ok(base?.surfaceKind === 'operation');
  const childId = base.memberRunIds[0]; assert.ok(childId);
  const template = FIXTURE_DAY_WIRE.queueSurfaces.find(row => row.runId === childId); assert.ok(template);
  const parentDay = '2026-08-02',childDay = FIXTURE_DAY_WIRE.day;
  const link = { runId: childId,partitionDay: childDay,workflowId: 'ocr',label: 'OCR',panelKind: 'review',status: 'done' };
  const memberIds = ['00000000-0000-4000-8000-000000000996','00000000-0000-4000-8000-000000000997'];
  const members = [1,2].map(page => ({ kind: 'record',record: { runId: childId,recordId: `${'a'.repeat(64)}#emergency-contact#${page}` },
    title: `Person ${page}`,status: 'running',statusLabel: 'Saving',childRunIds: [memberIds[page-1]],
    target: { ...link,runId: memberIds[page-1],workflowId: 'emergency-contact-member',label: 'Emergency Contact member',panelKind: 'member',status: 'running',section: 'logs' } }));
  const parent = QueueSurfaceWireSchema.parse({ ...base,workflowId: 'emergency-contact',title: 'Approved contacts',status: 'running',
    gateOpenedAt: { state: 'absent',reason: 'Not waiting' },endedAt: { state: 'absent',reason: 'Running' },linkedRuns: [link],
    memberRunIds: [],memberRollup: { total: 0,terminal: 0,failed: 0 },recordMembers: { runIds: memberIds,members } });
  const child = QueueSurfaceWireSchema.parse({ ...template,workflowId: 'ocr',surfaceKind: 'operation',panelKind: 'review',status: 'done',
    gateOpenedAt: { state: 'absent',reason: 'Not waiting' },endedAt: { state: 'present',value: FIXTURE_NOW },linkedRuns: [],
    parent: queueParentFixture(parent.runId,{ workflowId: parent.workflowId,partitionDay: parentDay,panelKind: parent.panelKind,visibility: 'linked' }),
    memberRunIds: [],memberRollup: { total: 0,terminal: 0,failed: 0 },memberPreview: { state: 'absent',reason: 'No inline children' } });
  const parentWire = DashboardDayWireSchema.parse({ ...FIXTURE_DAY_WIRE,day: parentDay,queueSurfaces: [parent],attemptHistory: undefined });
  const childWire = DashboardDayWireSchema.parse({ ...FIXTURE_DAY_WIRE,day: childDay,queueSurfaces: [child],attemptHistory: undefined });
  const detail = (row: typeof parent) => RunDetailWireSchema.parse({ runId: row.runId,rowRevision: row.rowRevision,panelKind: row.panelKind,
    header: { runId: row.runId,workflowId: row.workflowId,traceId: row.traceId,attempt: row.attempt,title: row.title,status: row.status },
    timeline: { steps: [],events: [] },gate: { state: 'absent',reason: 'Fixture' },outcome: { state: 'absent',reason: 'Fixture' },
    context: { dataFacts: 0,evidenceFacts: 0,attempts: 1 },availableSections: ['logs'] });
  const reads: string[] = [];
  const { app } = createFixtureBff();
  const transport = createDashboardClient({ baseUrl: 'http://fixture.test',fetchImpl: async (url,init) => {
    const parsed = new URL(url),path = parsed.pathname;
    if (path.endsWith('/dashboard')) {
      const day = parsed.searchParams.get('day');reads.push(`day:${day}`);
      if (day === parentDay) return Response.json(parentWire);
      await options.pending;
      if (options.failure === 'read-failed') throw new Error('Synthetic related read unavailable');
      return Response.json({ ...childWire,day: options.failure === 'wrong-day' ? parentDay : childDay,
        queueSurfaces: options.failure === 'missing' ? [] : options.failure === 'wrong-parent'
          ? [{ ...child,parent: { ...child.parent,runId: '00000000-0000-4000-8000-000000000995' } }] : [child] });
    }
    if (path.includes('/runs/')) {
      const id = path.split('/runs/')[1].split('/')[0];reads.push(`run:${id}`);
      if (path.endsWith('/logs')) return Response.json({ section: 'logs',payload: NotePageSchema.parse({ runId: id,rows: [],notes: [],nextCursor: { state: 'absent',reason: 'end-of-page' } }) });
      const response = detail(id === parent.runId ? parent : child);
      return Response.json(options.failure === 'owner-trace' && id === parent.runId ? { ...response,header: { ...response.header,traceId: 'ec-000000-ffff' } } : response);
    }
    return app.request(url,init);
  } });
  let subscription: Parameters<typeof transport.subscribeDay>[0] | undefined;
  const client = { ...transport,bootstrap: async () => { const boot = await transport.bootstrap();const first = boot.workflows[0];assert.ok(first);
    return FrontendBootstrapWireSchema.parse({ ...boot,workflows: [{ ...first,id: 'emergency-contact',code: 'ec',label: 'Emergency Contact' }] }); },
    subscribeDay(input: Parameters<typeof transport.subscribeDay>[0]) { subscription = input;input.onDay(input.day === parentDay ? parentWire : childWire);input.onState({ state: 'live' });return { close() {} }; } };
  window.history.replaceState(null,'',`/?day=${parentDay}`);
  const preferences = createPersonPreferences('preview',{ ...NEUTRAL_PERSON_PREFERENCES,workflowPanelMode: 'sidebar' });
  const host = document.createElement('div');document.body.append(host);root = createRoot(host);
  await act(async () => root?.render(createElement(DashboardClientProvider,{ client,children: createElement(DashboardApp,{ workflowComposition: workflows => { const composition = MOCK_WORKFLOW_COMPOSITION(workflows);return { ...composition,logsSources: composition.sources }; },
    previewPreferences: preferences }) })));
  const chip = () => { const chip = host.querySelector<HTMLButtonElement>(`[data-demo-row-id="${parent.runId}"] button[data-demo-row-link]`);assert.ok(chip);return chip; };
  await vi.waitFor(() => assert.ok(chip()));
  assert.ok(parent.surfaceKind === 'operation');
  assert.ok(parent.recordMembers?.members.every(member => member.target.workflowId !== child.workflowId));
  return { parent,child,parentDay,childDay,host,reads,chip,preferences,changeOwner() {
    assert.ok(subscription);
    subscription.onDay(DashboardDayWireSchema.parse({ ...parentWire,projectionGeneration: parentWire.projectionGeneration+1,snapshotCursor: parentWire.snapshotCursor+1,
      queueSurfaces: [{ ...parent,rowRevision: parent.rowRevision+1,actions: [] }] }));
  } };
}
