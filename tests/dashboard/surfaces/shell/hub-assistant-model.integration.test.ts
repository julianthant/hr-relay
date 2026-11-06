// @vitest-environment jsdom
import assert from 'node:assert/strict';
import { afterEach, it } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DashboardClientProvider } from '../../../../src/dashboard/state/client-context.js';
import { createDashboardClient } from '../../../../src/dashboard/client/index.js';
import { createSpreadsheetWiringAdapter } from '../../../../src/dashboard/state/spreadsheet-wiring-adapter.js';
import { createHubAssistantSession, prepareHubWorkflow, useHubAssistant } from '../../../../src/dashboard/surfaces/shell/hub-assistant-model.js';
import { assistantWorkflowRows, type AssistantFile } from '../../../../src/dashboard/surfaces/shell/assistant-panel-model.js';
import { useComposer } from '../../../../src/dashboard/surfaces/shell/composer-model.js';
import { workflowComposition } from '../../../../src/dashboard/app/workflow-sources.js';
import { disposeHttpRouteHarness, harness } from '../../../support/helpers/backend/http-route-harness.js';
Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
let root: Root | undefined;
afterEach(async () => { await act(async () => root?.unmount()); document.body.replaceChildren(); await disposeHttpRouteHarness(); });
it('registers attached, updated and generated files through HTTP/SQLite, reopens exact versions and isolates chats', async () => {
  const h = await harness(), writes: string[] = [];
  const client = createDashboardClient({ baseUrl: 'http://localhost', fetchImpl: async (url, init) => {
    if (init?.method === 'POST') writes.push(new URL(String(url)).pathname);
    return h.app.request(String(url), { ...init, headers: { ...Object.fromEntries(new Headers(init?.headers)), host: 'localhost', origin: 'http://localhost' } });
  } });
  const adapter = createSpreadsheetWiringAdapter(client), session = createHubAssistantSession('chat', adapter);
  const file: AssistantFile = { id: 'people', name: 'People.csv', status: 'Attached', workbook: { name: 'People.csv', themes: [], hasFormulas: false, sheets: [{ id: 's', name: 'People', width: 3, hidden: [], rows: [
    { id: 'head', cells: ['Name', 'Separation date', 'Kuali ID'].map(value => ({ value })) }, { id: 'person', cells: ['Alex Rivera', '2026-10-19', '2230001'].map(value => ({ value })) },
  ] }] } };
  await session.register(file); await session.register(file);
  const request = { workflowId: 'separations', source: 'mock', dryRun: true, conversationId: 'chat', file, rows: assistantWorkflowRows(file, 'separations') } as const;
  const { result } = prepareHubWorkflow(request, workflowComposition({ separations: 'mock' }), 0);
  if (result.state !== 'complete') throw Error('missing result');
  session.linkOutputs(request, result);
  for (const output of result.files) { await session.register(output); await session.register(output); }
  assert.equal(writes.length, 3); assert.ok(writes.every(path => /^\/api\/v1\/workbooks(?:\/[^/]+\/save)?$/u.test(path)));
});

it('keeps drafts on refused or failed sends, clears successful sends and forgets deleted sessions', async () => {
  const client = createDashboardClient({ baseUrl: 'http://localhost', fetchImpl: () => { throw Error('Unused'); } });
  let model!: ReturnType<typeof useHubAssistant>, composer!: ReturnType<typeof useComposer>;
  let outcome: 'refused' | 'failed' | 'sent' = 'refused';
  function Harness() {
    model = useHubAssistant(async () => ({ state: 'failed', message: 'Unused' }), () => {});
    composer = useComposer({ draft: model.session('chat').draft, async onSend() { if (outcome === 'failed') throw Error('Fixture send failed'); return outcome === 'sent'; } });
    return null;
  }
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root?.render(createElement(DashboardClientProvider, { client, children: createElement(Harness) })));
  const file: AssistantFile = { id: 'notes', name: 'Notes.txt', status: 'Attached' };
  await act(async () => { composer.setText('  Unsent text  '); composer.setFiles([file]); });
  const draft = model.session('chat').draft.read();
  await act(async () => { await composer.send(); });
  assert.deepEqual(model.session('chat').draft.read(), draft);
  outcome = 'failed';
  await act(async () => { await assert.rejects(composer.send(), /Fixture send failed/); });
  assert.deepEqual(model.session('chat').draft.read(), draft);
  outcome = 'sent';
  await act(async () => { await composer.send(); });
  assert.deepEqual(model.session('chat').draft.read(), { text: '', files: [] });
  model.session('chat').draft.retain(draft);
  const deleted = model.session('chat');
  model.forgetSession('chat');
  assert.notEqual(model.session('chat'), deleted);
  assert.deepEqual(model.session('chat').draft.read(), { text: '', files: [] });
  assert.deepEqual(model.session('other').draft.read(), { text: '', files: [] });
});

it('synchronizes explicit renames and rejects stale retained titles after a send settles', async () => {
  const client = createDashboardClient({ baseUrl: 'http://localhost', fetchImpl: () => { throw Error('Unused'); } });
  const titles: string[] = [], session = createHubAssistantSession('chat', createSpreadsheetWiringAdapter(client), title => titles.push(title));
  const seeded = createHubAssistantSession('seeded', createSpreadsheetWiringAdapter(client), undefined, 'Existing chat title');
  assert.equal(seeded.producer.initial().title, 'Existing chat title');
  const beforeRename = session.producer.initial();
  session.rename('  Operator title  ');
  assert.equal(session.producer.initial().title, 'Operator title');
  const next = await session.producer.send(beforeRename, { text: 'First message', files: [], model: 'Default', effort: 'Medium', approval: 'Ask before every action' });
  assert.equal(next.title, 'Operator title');
  session.rename('Newer operator title');
  session.autoTitle('Late automatic title');
  session.producer.retain(next);
  assert.equal(session.producer.initial().title, 'Newer operator title');
  assert.equal(titles.length, 0);
  const fresh = createHubAssistantSession('fresh', createSpreadsheetWiringAdapter(client), title => titles.push(title));
  const old = fresh.producer.initial();
  fresh.autoTitle('First request'); fresh.producer.retain(old); fresh.autoTitle('Later request');
  assert.equal(fresh.producer.initial().title, 'First request'); assert.deepEqual(titles, ['First request']);
});
