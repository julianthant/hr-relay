import type { useAssistantController } from "../assistant/assistant-controller-model.js";
import { useEffect, useRef, useState } from 'react';
import type { DashboardClient } from '../../client/index.js';
import type { ChatGptAccountView } from '../../../models/dashboard/chatgpt-account.js';
import { importSpreadsheetInWorker } from '../spreadsheets/spreadsheet-import-client.js';
import { cellText, type EditableWorkbook } from '../spreadsheets/spreadsheet-editor-model.js';
import { MOCK_WORKFLOWS } from '../workflows/mocks/workflow-mock-catalog.js';
import type { ComposerValue } from './composer-model.js';

export interface AssistantFile { readonly id: string; readonly name: string; readonly status: 'Attached' | 'Updated' | 'Generated'; readonly workbook?: EditableWorkbook }
export type AssistantScene = 'new' | 'conversation' | 'ask-read' | 'ask-write' | 'permission-changed' | 'auto' | 'working' | 'cancelling' | 'done' | 'failed' | 'handoff' | 'destructive' | 'delete-working' | 'resolved' | 'declined';
export interface AssistantMessage { readonly role: 'operator' | 'assistant'; readonly text: string }
export interface AssistantRow { readonly sheet: string; readonly row: number; readonly person: string; readonly values: Readonly<Record<string, string>>; readonly issue: string | null }
export interface AssistantWorkflow { readonly workflowId: string; readonly label: string; readonly file: AssistantFile; readonly rows: readonly AssistantRow[]; readonly state: 'review' | 'running' | 'complete' | 'uncertain' | 'failed'; readonly outputs: readonly AssistantFile[]; readonly message?: string }
export interface AssistantConversation { readonly id: string; readonly title: string; readonly source: 'mock'; readonly scene: AssistantScene; readonly messages: readonly AssistantMessage[]; readonly files: readonly AssistantFile[]; readonly workflow?: AssistantWorkflow }
export interface AssistantConversationPort {
  initial(): AssistantConversation;
  retain?(conversation: AssistantConversation): void;
  send(conversation: AssistantConversation, value: ComposerValue): Promise<AssistantConversation>;
  act(conversation: AssistantConversation, action: 'approve' | 'decline' | 'cancel'): Promise<AssistantConversation>;
}
export interface AssistantWorkflowRequest { readonly workflowId: string; readonly source: 'mock'; readonly dryRun: true; readonly conversationId: string; readonly file: AssistantFile; readonly rows: readonly AssistantRow[] }
export type AssistantWorkflowResult = { readonly state: 'complete'; readonly source: 'mock'; readonly files: readonly AssistantFile[] } | { readonly state: 'uncertain' | 'failed'; readonly message: string };
export interface AssistantPorts {
  readonly onAttachFile?: (file?: File) => Promise<AssistantFile | null>;
  readonly onRegisterSpreadsheet?: (file: AssistantFile) => Promise<void>;
  readonly onOpenChatFile?: (file?: AssistantFile, mode?: 'browse' | 'attach') => Promise<AssistantFile | null | void>;
  readonly onRunWorkflow?: (request: AssistantWorkflowRequest) => Promise<AssistantWorkflowResult>;
}
const workflowOptions = [
  { name: 'Separations', label: 'Separations', command: /\brun\s+(?:the\s+)?separations\b/i, date: /last day|separation date|termination date/i, identifier: /^kuali\s*id$/iu, identifierLabel: 'Kuali ID' },
  { name: 'Onboarding', label: 'Onboardings', command: /\brun\s+(?:the\s+)?onboardings?\b/i, date: /start date|hire date/i, identifier: /^(?:work\s*)?email(?:\s*address)?$/iu, identifierLabel: 'email address' },
].map(option => {
  const workflow = MOCK_WORKFLOWS.find(workflow => workflow.label === option.name);
  if (!workflow) throw new Error('Assistant sample workflow is unavailable.');
  return { ...option, id: workflow.id };
});
export function assistantWorkflowOption(id: string) { return workflowOptions.find(option => option.id === id); }
export function assistantWorkflowRows(file: AssistantFile, workflowId: string): readonly AssistantRow[] {
  const option = workflowOptions.find(option => option.id === workflowId);
  if (!option) throw new Error('This sample workflow is unavailable.');
  if (!file.workbook) throw new Error('Attach a spreadsheet with readable rows.');
  return file.workbook.sheets.flatMap(sheet => {
    const headerIndex = (sheet.headerRow ?? 1) - 1;
    const headers = sheet.rows[headerIndex]?.cells.map(cellText);
    if (!headers?.length) throw new Error(`Choose a header row for ${sheet.name}.`);
    return sheet.rows.slice(headerIndex + 1).flatMap((row, index) => {
      const cells = row.cells.map(cellText);
      if (cells.every(value => !value.trim())) return [];
      const values = Object.fromEntries(headers.map((header, column) => [header, cells[column] ?? '']));
      const personColumn = headers.findIndex(header => /^(person|name|full name|employee name)$/i.test(header));
      const dateColumn = headers.findIndex(header => option.date.test(header));
      const person = cells[personColumn]?.trim() ?? '';
      const date = cells[dateColumn]?.trim() ?? '';
      return [{ sheet: sheet.name, row: headerIndex + index + 2, person: person || `Row ${headerIndex + index + 2}`, values,
        issue: !person ? 'Needs name' : !date ? 'Needs date' : null }];
    });
  });
}
export function createAssistantMockProducer(scene: AssistantScene = 'new'): AssistantConversationPort {
  return {
    initial: () => ({ id: 'assistant-mock', title: scene === 'new' ? 'New chat' : 'Update Alex Rivera work email', source: 'mock', scene, messages: scene === 'conversation' ? [{ role: 'operator', text: 'What should I check before saving?' }, { role: 'assistant', text: 'Check the person, the destination, and the values you want to change. I’ll show the details before asking you to approve.' }, { role: 'operator', text: 'Can I keep working while you check?' }, { role: 'assistant', text: 'Yes. You can leave this chat open while you work. Come back here to review the result.' }] : [], files: [] }),
    async send(conversation, value) {
      const option = workflowOptions.find(option => option.command.test(value.text));
      const workflowId = option?.id;
      if (workflowId && conversation.workflow?.state === 'uncertain') throw new Error('The previous run outcome is unknown. Check that run before starting again.');
      const file = value.files.find(candidate => candidate.workbook);
      if (workflowId && !file) throw new Error('Attach a spreadsheet before starting this workflow.');
      if (workflowId && file) {
        const rows = assistantWorkflowRows(file, workflowId);
        if (!rows.length) throw new Error('The spreadsheet has no people to review.');
        return { ...conversation, title: conversation.title === 'New chat' ? `Run ${option.label.toLowerCase()}` : conversation.title, scene: 'conversation',
          messages: [...conversation.messages, { role: 'operator', text: value.text }], files: [...conversation.files, ...value.files],
          workflow: { workflowId, label: option.label.toLowerCase(), file, rows, state: 'review', outputs: [] } };
      }
      if (/send me the updated/i.test(value.text)) return { ...conversation, messages: [...conversation.messages, { role: 'operator', text: value.text },
        { role: 'assistant', text: conversation.files.some(file => file.status === 'Updated') ? 'Your updated spreadsheet is ready below.' : 'There is no updated spreadsheet in this chat yet.' }] };
      return { ...conversation, scene: 'conversation', title: conversation.title === 'New chat' ? value.text.slice(0, 55) : conversation.title,
        files: [...conversation.files, ...value.files], messages: [...conversation.messages, { role: 'operator', text: value.text },
          { role: 'assistant', text: 'I’ll review the record and show you the action before continuing.' }] };
    },
    async act(conversation, action) { return { ...conversation, scene: action === 'decline' ? 'declined' : action === 'cancel' ? 'cancelling' : conversation.scene === 'destructive' ? 'delete-working' : 'working' }; },
  };
}
export async function readAssistantAttachment(file: File): Promise<AssistantFile> {
  const workbook = /\.(xlsx?|csv|tsv)$/i.test(file.name) ? await importSpreadsheetInWorker(file.name, await file.arrayBuffer()) : undefined;
  return { id: crypto.randomUUID(), name: file.name, status: 'Attached', ...(workbook ? { workbook } : {}) };
}
export function useAssistantPanel({ producer, accountClient, ports, served }: { served?: ReturnType<typeof useAssistantController>; producer: AssistantConversationPort; accountClient: Pick<DashboardClient, 'chatGptAccount'>; ports: AssistantPorts }) {
  const [conversation, setConversation] = useState(() => producer.initial());
  useEffect(() => { producer.retain?.(conversation); }, [producer, conversation]);
  const [account, setAccount] = useState<ChatGptAccountView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState<'record' | 'sign-in' | null>(null);
  const transcript = useRef<HTMLDivElement>(null);
  const [showLatest, setShowLatest] = useState(false);
  const generation = useRef(0);
  const pending = useRef(false);
  const currentAuthority = useRef(served?.authorityKey); currentAuthority.current = served?.authorityKey;
  useEffect(() => {
    let current = true;
    void accountClient.chatGptAccount().then(value => { if (current) setAccount(value); }, () => { if (current) setError('Could not load ChatGPT account. Open Settings to try again.'); });
    return () => { current = false; generation.current += 1; };
  }, [accountClient]);
  async function perform(work: () => Promise<AssistantConversation>): Promise<boolean> {
    if (pending.current) return false;
    pending.current = true; setBusy(true); setError(null);
    const identity = generation.current;
    let committed = false;
    try { const next = await work(); if (identity !== generation.current) return false; setConversation(next); committed = true; }
    catch (cause) { if (identity === generation.current) setError(cause instanceof Error ? cause.message : 'The assistant action failed. Try again.'); }
    finally { pending.current = false; if (identity === generation.current) setBusy(false); }
    return committed;
  }
  async function send(value: ComposerValue) {
    const identity = generation.current, authority = currentAuthority.current;
    let dispatched = false;
    const committed = await perform(async () => {
      const next = served ? { ...conversation, files: [...conversation.files, ...value.files] } : await producer.send(conversation, value);
      for (const file of value.files) if (file.workbook) await ports.onRegisterSpreadsheet?.(file);
      if (served && identity === generation.current && authority === currentAuthority.current) {
        served.onAction({ type: 'edit', value: value.text }); served.onAction({ type: 'send' }); dispatched = true;
      }
      return next;
    });
    return served ? dispatched : committed;
  }
  async function runWorkflow() {
    const workflow = conversation.workflow;
    if (!workflow || workflow.state !== 'review' || !ports.onRunWorkflow) return;
    const rows = workflow.rows.filter(row => row.issue === null);
    if (!rows.length) return;
    await perform(async () => {
      const running = { ...conversation, workflow: { ...workflow, state: 'running' as const } };
      setConversation(running);
      let result: AssistantWorkflowResult;
      try { result = await ports.onRunWorkflow!({ workflowId: workflow.workflowId, source: 'mock', dryRun: true, conversationId: conversation.id, file: workflow.file, rows }); }
      catch { return { ...conversation, workflow: { ...workflow, state: 'uncertain', message: 'The run outcome is unknown. Check the run before continuing.' } }; }
      if (result.state !== 'complete') return { ...conversation, workflow: { ...workflow, state: result.state, message: result.message } };
      const completed = { ...conversation, files: [...conversation.files, ...result.files], workflow: { ...workflow, state: 'complete' as const, outputs: result.files } };
      setConversation(completed);
      for (const file of result.files) if (file.workbook) await ports.onRegisterSpreadsheet?.(file);
      return completed;
    });
  }
  function latest() { const element = transcript.current; if (element) element.scrollTop = element.scrollHeight; setShowLatest(false); }
  return { conversation, account, error, busy, detail, setDetail, transcript, showLatest, latest, send, runWorkflow,
    onScroll: () => { const el = transcript.current; if (el) setShowLatest(el.scrollHeight - el.clientHeight - el.scrollTop >= 48); },
    finishMockSignIn: () => { setConversation(current => ({ ...current, scene: 'ask-write' })); setDetail(null); },
    act: (action: 'approve' | 'decline' | 'cancel') => perform(() => producer.act(conversation, action)),
    newChat: () => { generation.current += 1; setConversation({ ...producer.initial(), id: crypto.randomUUID(), title: 'New chat', scene: 'new', messages: [], files: [] }); if (account) setError(null); },
  };
}
