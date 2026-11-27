// @vitest-environment jsdom
import { useAssistantController } from '../../../../src/dashboard/surfaces/assistant/assistant-controller-model.js';
import { ASSISTANT_FAILURES, ASSISTANT_MODEL_COMMAND, type AssistantM1Request, type AssistantStageResult } from '../../../../src/models/dashboard/assistant.js';

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAssistantPanel, type AssistantPorts, type AssistantFile } from '../../../../src/dashboard/surfaces/shell/assistant-panel-model.js';
import { resultClient, type ScriptedReply } from '../../../support/helpers/dashboard/assistant-served-client.js';
Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
let root: Root | undefined;
let host: HTMLDivElement;
let model: ReturnType<typeof useAssistantPanel>;
const file: AssistantFile = { id: 'people', name: 'People.csv', status: 'Attached', workbook: { name: 'People.csv', themes: {}, hasFormulas: false, sheets: [{ id: 'people', name: 'People', width: 2, hidden: [], rows: [
  { id: 'header', cells: [{ value: 'Name' }, { value: 'Hire date' }] },
  { id: 'one', cells: [{ value: 'Morgan Vega' }, { value: '2026-10-19' }] },
] }] } };
const conversationPort = { initial: () => ({ id: 'chat', title: 'New chat', files: [] }) };
afterEach(async () => { await act(async () => { root?.unmount(); }); host?.remove(); root = undefined; });

it('blocks every setup attachment before panel registration and both local file ports', async () => {
  let controller!: ReturnType<typeof useAssistantController>, registrations = 0, attachments = 0, requests = 0;
  const ports: AssistantPorts = { async onRegisterSpreadsheet() { registrations++; },
    async onAttachFile() { attachments++; return file; } };
  const client = resultClient({ async assistantRespond(): Promise<ScriptedReply> { requests++; return { state: 'answered', text: 'Unexpected' }; } });
  function Harness() { controller = useAssistantController(client, 'profile', undefined, false); model = useAssistantPanel({ conversationPort, ports, served: controller }); return null; }
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root?.render(createElement(Harness)));
  for (const text of [ASSISTANT_MODEL_COMMAND]) {
    await act(async () => controller.onAction({ type: "edit", value: text }));
    await act(async () => {
      expect(await model.attachFile(new File(['fixture'], 'fixture.txt'))).toBeNull();
      expect(await model.send({ text, files: [file], model: 'ignored', effort: 'ignored', approvalMode: 'ask' })).toBe(false);
    });
    expect(model.error).toContain('text only');
  }
  expect(registrations).toBe(0); expect(attachments).toBe(0); expect(requests).toBe(0);
  await act(async () => controller.onAction({ type: "edit", value: 'ordinary attachment' }));
  await act(async () => { expect(await model.attachFile()).toBe(file); });
  expect(attachments).toBe(1);
});

describe('assistant attachments', () => {
  const sendValue = (text: string, files: readonly AssistantFile[]) => ({ text, files, model: 'ignored', effort: 'ignored', approvalMode: 'ask' as const });
  const upload = (name: string, bytes = 'fixture', size = bytes.length) => ({ name, size, async arrayBuffer() { return new TextEncoder().encode(bytes).buffer; } }) as unknown as File;
  async function mountServed(client: ReturnType<typeof resultClient>, ports: AssistantPorts = { async onAttachFile(picked) { return { id: crypto.randomUUID(), name: picked!.name, status: 'Attached' }; } }) {
    let controller!: ReturnType<typeof useAssistantController>;
    function Harness() { controller = useAssistantController(client, 'profile', undefined, false); model = useAssistantPanel({ conversationPort, ports, served: controller }); return null; }
    host = document.createElement('div'); document.body.append(host); root = createRoot(host);
    await act(async () => root?.render(createElement(Harness)));
    return () => controller;
  }
  function recordingClient(stage: (name: string) => Promise<AssistantStageResult>) {
    const staged: { conversationId: string; name: string; mediaType: string; bytes: number }[] = [], requests: AssistantM1Request[] = [];
    const client = resultClient({
      async assistantStageAttachment(conversationId: string, picked: Readonly<{ name: string; mediaType: string; bytes: Uint8Array }>) { staged.push({ conversationId, name: picked.name, mediaType: picked.mediaType, bytes: picked.bytes.byteLength }); return stage(picked.name); },
      async assistantRespond(request: AssistantM1Request): Promise<ScriptedReply> { requests.push(request); return { state: 'answered', text: 'Read it' }; },
    });
    return { client, staged, requests };
  }
  const stagedResult = (name: string, byteLength: number, mediaType: Extract<AssistantStageResult, { state: 'staged' }>['attachment']['mediaType'] = 'application/pdf'): AssistantStageResult =>
    ({ state: 'staged', attachment: { id: crypto.randomUUID(), mediaType, name, byteLength, expiresAt: '2099-01-01T00:00:00.000Z' } });

  it('stages a PDF before send and names its staged id in the request', async () => {
    const { client, staged, requests } = recordingClient(async name => stagedResult(name, 7));
    const controller = await mountServed(client);
    let attached: AssistantFile | null = null;
    await act(async () => { attached = await model.attachFile(upload('report.pdf', '%PDF-1.4')); });
    expect(staged).toHaveLength(1);
    expect(staged[0]).toHaveProperty('conversationId', expect.any(String));
    expect(staged).toEqual([{ conversationId: staged[0]?.conversationId, name: 'report.pdf', mediaType: 'application/pdf', bytes: 8 }]);
    expect(attached).toMatchObject({ name: 'report.pdf', stage: { state: 'staged' } });
    await act(async () => controller().onAction({ type: 'edit', value: 'Check this file' }));
    await act(async () => { await model.send({ ...sendValue('Check this file', [attached!]), approvalMode: 'full-access' }); });
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0].attachments).toEqual([attached!.id]);
    expect(requests[0].approvalMode).toBe('full-access');
    expect(requests[0].conversationId).toBe(staged[0].conversationId);
  });
  it('refuses an unsupported type before any upload or send, with a plain reason', async () => {
    const { client, staged, requests } = recordingClient(async name => stagedResult(name, 1));
    await mountServed(client);
    await act(async () => { await expect(model.attachFile(upload('bad.exe'))).rejects.toThrow(ASSISTANT_FAILURES.ASSISTANT_ATTACHMENT_UNSUPPORTED); });
    expect(staged).toHaveLength(0); expect(requests).toHaveLength(0);
  });
  it('refuses an oversized file before any upload', async () => {
    const { client, staged } = recordingClient(async name => stagedResult(name, 1));
    await mountServed(client);
    await act(async () => { await expect(model.attachFile(upload('notes.txt', 'x', 33 * 1024))).rejects.toThrow(ASSISTANT_FAILURES.ASSISTANT_ATTACHMENT_TOO_LARGE); });
    expect(staged).toHaveLength(0);
  });
  it('keeps a staging failure on the chip and blocks the send until it is removed', async () => {
    const { client, requests } = recordingClient(async () => { throw new Error('500'); });
    const controller = await mountServed(client);
    let attached: AssistantFile | null = null;
    await act(async () => { attached = await model.attachFile(upload('report.pdf', '%PDF-1.4')); });
    expect(attached).toMatchObject({ stage: { state: 'failed' } });
    expect(attached).toHaveProperty('stage.message', expect.stringContaining('Try again'));
    await act(async () => controller().onAction({ type: 'edit', value: 'Check this file' }));
    await act(async () => { expect(await model.send(sendValue('Check this file', [attached!]))).toBe(false); });
    expect(model.error).toContain('Retry or remove'); expect(requests).toHaveLength(0);
  });
  it('shows a server refusal on the chip', async () => {
    const { client } = recordingClient(async () => ({ state: 'refused', code: 'ASSISTANT_ATTACHMENT_INVALID' }));
    await mountServed(client);
    let attached: AssistantFile | null = null;
    await act(async () => { attached = await model.attachFile(upload('report.pdf', 'nope')); });
    expect(attached).toMatchObject({ stage: { state: 'failed', message: ASSISTANT_FAILURES.ASSISTANT_ATTACHMENT_INVALID } });
  });
  it('keeps a csv on the spreadsheet path: not staged, labelled as such, not named in the request', async () => {
    const { client, staged, requests } = recordingClient(async name => stagedResult(name, 1));
    const controller = await mountServed(client, { async onAttachFile(picked) { return { ...file, name: picked!.name }; }, async onRegisterSpreadsheet() {} });
    let attached: AssistantFile | null = null;
    await act(async () => { attached = await model.attachFile(upload('tracker.csv', 'Name,Hire date')); });
    expect(staged).toHaveLength(0); expect(attached).toMatchObject({ stage: { state: 'spreadsheet' } });
    await act(async () => controller().onAction({ type: 'edit', value: 'Check this file' }));
    await act(async () => { await model.send(sendValue('Check this file', [attached!])); });
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0].attachments).toBeUndefined();
  });
});
