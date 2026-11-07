import { useMemo, useRef } from 'react';
import { useDashboardClient } from '../../state/client-context.js';
import { useSpreadsheetWiringAdapter } from '../../state/spreadsheet-wiring-adapter.js';
import { spreadsheetChatRegistrationPort, type SpreadsheetFileReference } from '../spreadsheets/spreadsheet-chat-registration-model.js';
import { addSpreadsheetColumn, editSpreadsheetCell, spreadsheetSaveMatches } from '../spreadsheets/spreadsheet-editor-model.js';
import { type EditableWorkbook } from '../../../rules/spreadsheets/workbook-io.js';
import type { ComposerDraft } from './composer-model.js';
import { assistantWorkflowOption, createAssistantMockProducer, readAssistantAttachment, type AssistantConversation, type AssistantFile, type AssistantPorts, type AssistantWorkflowRequest, type AssistantWorkflowResult } from './assistant-panel-model.js';
import { initialMockDraft, mockRunsForDraft, type MockRun } from '../workflows/mocks/workflow-mock-model.js';
import type { WorkflowComposition } from '../../app/workflow-sources.js';
import type { AssistantHistory } from '../assistant/assistant-history-model.js';

export function prepareHubWorkflow(request: AssistantWorkflowRequest, composition: WorkflowComposition, sequence: number): { runs: readonly MockRun[]; result: AssistantWorkflowResult } {
  const option = assistantWorkflowOption(request.workflowId);
  if (request.source !== 'mock' || request.dryRun !== true || !option || composition.sourceForRoute(request.workflowId, true) !== 'mock') throw new Error('This assistant supports sample dry runs only.');
  const workbook = request.file.workbook;
  if (!workbook || !request.rows.length || request.rows.some(row => row.issue !== null)) throw new Error('Review the spreadsheet rows before starting.');
  const id = option.id;
  const runs = request.rows.flatMap((row, index) => {
    const field = Object.entries(row.values).filter(([key]) => option.identifier.test(key));
    if (field.length !== 1 || !field[0][1].trim()) throw new Error(`${row.person}: provide one ${option.identifierLabel} column before starting.`);
    const created = mockRunsForDraft(id, { ...initialMockDraft(id), method: 'typed', text: field[0][1].trim(), dryRun: true }, sequence + index);
    if (created.length !== 1) throw new Error(`${row.person}: provide one ${option.identifierLabel} per row before starting.`);
    return created.map(run => ({ ...run, title: row.person }));
  });
  const status = 'Sample dry run complete';
  const updated: EditableWorkbook = { ...workbook, sheets: workbook.sheets.map(sheet => {
    const rows = request.rows.filter(row => row.sheet === sheet.name);
    if (!rows.length) return sheet;
    let next = addSpreadsheetColumn(sheet, 'Relay result');
    for (const row of rows) {
      const target = sheet.rows[row.row - 1];
      if (!target) throw new Error('The reviewed spreadsheet row is unavailable.');
      next = editSpreadsheetCell(next, target.id, sheet.width, status);
    }
    return next;
  }) };
  const generated: EditableWorkbook = { name: 'Results.csv', themes: {}, hasFormulas: false, sheets: [{ id: 'results', name: 'Results', width: 4, hidden: [], rows: [
    { id: 'header', cells: ['Name', 'Source sheet', 'Source row', 'Result'].map(value => ({ value })) },
    ...request.rows.map((row, index) => ({ id: `result-${index}`, cells: [row.person, row.sheet, row.row, status].map(value => ({ value })) })),
  ] }] };
  return { runs, result: { state: 'complete', source: 'mock', files: [
    { id: `${request.file.id}:updated`, name: workbook.name, status: 'Updated', workbook: updated },
    { id: `${request.file.id}:results`, name: generated.name, status: 'Generated', workbook: generated },
  ] } };
}

export function createHubAssistantSession(id: string, adapter: ReturnType<typeof useSpreadsheetWiringAdapter>['adapter'], onTitle?: (title: string) => void, initialTitle?: string, retainedDraft?: { read(): string; retain(text: string): void }) {
  const producer = createAssistantMockProducer(id === 'a' ? 'ask-write' : 'new');
  let conversation: AssistantConversation = { ...producer.initial(), id, ...(initialTitle === undefined ? {} : { title: initialTitle }) };
  let renamedTitle: string | undefined;
  let draft: ComposerDraft = { text: retainedDraft?.read() ?? '', files: [] };
  const registry = spreadsheetChatRegistrationPort(adapter);
  const references = new Map<string, SpreadsheetFileReference>();
  const bases = new Map<string, SpreadsheetFileReference>();
  return {
    draft: { read: () => draft, retain(next: ComposerDraft) { draft = next; retainedDraft?.retain(next.text); } },
    autoTitle(title: string) {
      if (conversation.title !== 'New chat') return;
      renamedTitle = title.trim(); conversation = { ...conversation, title: renamedTitle }; onTitle?.(conversation.title);
    },
    rename(title: string) { renamedTitle = title.trim(); conversation = { ...conversation, title: renamedTitle }; },
    producer: { ...producer, initial: () => conversation,
      send: (current: AssistantConversation, value: Parameters<typeof producer.send>[1]) => producer.send({ ...current, title: conversation.title }, value),
      retain(next: AssistantConversation) {
        if (renamedTitle !== undefined) next = { ...next, title: renamedTitle };
        const changed = conversation.title !== next.title; conversation = next;
        if (changed) onTitle?.(next.title);
    } },
    async attach(file: File): Promise<AssistantFile> {
      return readAssistantAttachment(file);
    },
    async register(file: AssistantFile): Promise<void> {
      if (!file.workbook) return;
      const confirmed = references.get(file.id);
      if (file.status === 'Attached' && confirmed) {
        const opened = await registry.open(confirmed);
        if (!spreadsheetSaveMatches(file.workbook, { state: 'confirmed', version: confirmed.version, readback: opened })) throw new Error('The attachment differs from its saved version.');
        return;
      }
      const base = bases.get(file.id);
      const result = await registry.register({ operationId: file.id, status: file.status, workbook: base ? { ...file.workbook, libraryId: base.libraryId } : file.workbook, ...(base ? { base } : {}) });
      if (result.state !== 'confirmed') throw new Error(result.reason);
      references.set(file.id, result.file);
    },
    linkOutputs(request: AssistantWorkflowRequest, result: AssistantWorkflowResult) {
      if (result.state !== 'complete') return;
      for (const file of result.files) if (file.status === 'Updated') {
        const base = references.get(request.file.id);
        if (!base) throw new Error('The original spreadsheet registration is unavailable.');
        bases.set(file.id, base);
      }
    }
  };
}

export function useHubAssistant(onRunWorkflow: NonNullable<AssistantPorts['onRunWorkflow']>, onTitle: (id: string, title: string) => void, history?: AssistantHistory) {
  const titleChanged = useRef(onTitle); titleChanged.current = onTitle;
  const client = useDashboardClient();
  const { adapter } = useSpreadsheetWiringAdapter(false, null);
  const sessions = useMemo(() => ({ adapter, history, values: new Map<string, ReturnType<typeof createHubAssistantSession>>() }), [adapter, history]);
  const session = (id: string, initialTitle?: string) => { let value = sessions.values.get(id); if (!value) { value = createHubAssistantSession(id, sessions.adapter, title => titleChanged.current(id, title), initialTitle, history?.draft(id)); sessions.values.set(id, value); } return value; };
  return { client, session, forgetSession: (id: string) => { sessions.values.delete(id); },
    ports(id: string): AssistantPorts {
      const current = session(id);
      return {
        onAttachFile: async file => file ? current.attach(file) : null,
        onRegisterSpreadsheet: file => current.register(file),
        onRunWorkflow: async request => { const result = await onRunWorkflow(request); current.linkOutputs(request, result); return result; },
      };
    },
  };
}
