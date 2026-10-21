// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { createAssistantMockProducer, useAssistantPanel, type AssistantPorts, type AssistantFile } from '../../../../src/dashboard/surfaces/shell/assistant-panel-model.js';
import { ChatGptAccountViewSchema } from '../../../../src/models/dashboard/chatgpt-account.js';
import type { DashboardClient } from '../../../../src/dashboard/client/index.js';
Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
let root: Root | undefined;
let host: HTMLDivElement;
let model: ReturnType<typeof useAssistantPanel>;
const file: AssistantFile = { id: 'people', name: 'People.csv', status: 'Attached', workbook: { name: 'People.csv', themes: {}, hasFormulas: false, sheets: [{ id: 'people', name: 'People', width: 2, hidden: [], rows: [
  { id: 'header', cells: [{ value: 'Name' }, { value: 'Hire date' }] },
  { id: 'one', cells: [{ value: 'Morgan Vega' }, { value: '2026-10-19' }] },
] }] } };
const accountClient: Pick<DashboardClient, 'chatGptAccount'> = { async chatGptAccount() { return ChatGptAccountViewSchema.parse({ state: 'connected', name: 'Fixture', email: 'fixture@example.edu', expiresAt: '2099-10-19T00:00:00Z', planUsage: 'enabled' }); } };
async function mount(ports: AssistantPorts, client = accountClient) {
  const producer = createAssistantMockProducer();
  function Harness() { model = useAssistantPanel({ producer, accountClient: client, ports }); return null; }
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => { root!.render(createElement(Harness)); });
}
afterEach(async () => { await act(async () => { root?.unmount(); }); host?.remove(); root = undefined; });
async function review() { await act(async () => { await model.send({ text: 'run onboardings', files: [file], model: 'Default', effort: 'Medium', approval: 'Ask only before submits' }); }); }
describe('assistant port settlements', () => {
  it('uses the existing account read and does not turn its failure into connected mock state', async () => {
    await mount({}, { async chatGptAccount() { throw Error('fixture unavailable'); } });
    expect(model.account).toBeNull(); expect(model.error).toContain('Could not load ChatGPT account');
    await act(async () => { model.newChat(); });
    expect(model.account).toBeNull(); expect(model.error).toContain('Could not load ChatGPT account');
  });
  it('preserves unknown run outcomes and refuses a second start', async () => {
    let starts = 0;
    await mount({ async onRunWorkflow(request) { starts++; expect(request.dryRun).toBe(true); expect(request.workflowId).toBe('onboarding'); expect(request.rows[0].person).toBe('Morgan Vega'); throw Error('transport ended'); } });
    await review(); await act(async () => { await model.runWorkflow(); });
    expect(model.conversation.workflow?.state).toBe('uncertain');
    await act(async () => { await model.runWorkflow(); }); expect(starts).toBe(1);
    await review(); expect(model.conversation.workflow?.state).toBe('uncertain');
    expect(model.error).toContain('previous run outcome is unknown');
    await act(async () => { await model.runWorkflow(); }); expect(starts).toBe(1);
  });
  it('keeps returned files and terminal completion when library registration fails', async () => {
    let registrations = 0;
    await mount({ async onRunWorkflow() { return { state: 'complete', source: 'mock', files: [{ ...file, id: 'updated', status: 'Updated' }] }; }, async onRegisterSpreadsheet() { if (++registrations > 1) throw Error('Library registration failed'); } });
    await review(); await act(async () => { await model.runWorkflow(); });
    expect(model.conversation.workflow?.state).toBe('complete');
    expect(model.conversation.files.map(file => file.status)).toEqual(['Attached', 'Updated']);
    expect(model.error).toBe('Library registration failed');
  });
});
