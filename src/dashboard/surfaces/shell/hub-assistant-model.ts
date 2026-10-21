import { useMemo, useRef, useState } from 'react';
import { useDashboardClient } from '../../state/client-context.js';
import { useSpreadsheetWiringAdapter } from '../../state/spreadsheet-wiring-adapter.js';
import { spreadsheetChatRegistrationPort, type SpreadsheetFileReference } from '../spreadsheets/spreadsheet-chat-registration-model.js';
import { addSpreadsheetColumn, editSpreadsheetCell, spreadsheetSaveMatches, type EditableWorkbook } from '../spreadsheets/spreadsheet-editor-model.js';
import type { ComposerDraft } from './composer-model.js';
import { createChatFilesPort, type ChatFile } from './chat-files-model.js';
import { assistantWorkflowOption, createAssistantMockProducer, readAssistantAttachment, type AssistantConversation, type AssistantFile, type AssistantPorts, type AssistantWorkflowRequest, type AssistantWorkflowResult } from './assistant-panel-model.js';
import { initialMockDraft, mockRunsForDraft, type MockRun } from '../workflows/mocks/workflow-mock-model.js';
import type { WorkflowComposition } from '../../app/workflow-sources.js';

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

export function createHubAssistantSession(id: string, adapter: ReturnType<typeof useSpreadsheetWiringAdapter>['adapter'], onTitle?: (title: string) => void, initialTitle?: string) {
  const producer = createAssistantMockProducer(id === 'a' ? 'ask-write' : 'new');
  let conversation: AssistantConversation = { ...producer.initial(), id, ...(initialTitle === undefined ? {} : { title: initialTitle }) };
  let renamedTitle: string | undefined;
  let draft: ComposerDraft = { text: '', files: [] };
  const files = createChatFilesPort(spreadsheetChatRegistrationPort(adapter));
  const references = new Map<string, SpreadsheetFileReference>();
  const bases = new Map<string, SpreadsheetFileReference>();
  const pendingFiles = new Map<string, File>();
  const mockReferences = new Map<string, ChatFile>();
  return {
    files,
    draft: { read: () => draft, retain(next: ComposerDraft) { draft = next; } },
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
        for (const file of next.files) {
          const pending = pendingFiles.get(file.id);
          if (pending) { mockReferences.set(file.id, files.attachMockFile(pending)); pendingFiles.delete(file.id); }
        }
        if (changed) onTitle?.(next.title);
    } },
    async attach(file: File): Promise<AssistantFile> {
      const attachment = await readAssistantAttachment(file);
      if (!attachment.workbook) pendingFiles.set(attachment.id, file);
      return attachment;
    },
    async register(file: AssistantFile): Promise<void> {
      if (!file.workbook) return;
      const confirmed = references.get(file.id);
      if (file.status === 'Attached' && confirmed) {
        const opened = await files.open({ id: file.id, name: file.name, kind: 'workbook', reference: confirmed });
        if (opened.kind !== 'workbook' || !spreadsheetSaveMatches(file.workbook, { state: 'confirmed', version: confirmed.version, readback: opened.document })) throw new Error('The attachment differs from its saved version.');
        return;
      }
      const base = bases.get(file.id);
      const result = await files.registerSpreadsheet({ operationId: file.id, status: file.status, workbook: base ? { ...file.workbook, libraryId: base.libraryId } : file.workbook, ...(base ? { base } : {}) });
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
    },
    reference(file: AssistantFile): ChatFile {
      const mock = mockReferences.get(file.id);
      if (mock) return mock;
      const reference = references.get(file.id);
      const entry = files.snapshot().find(candidate => reference ? candidate.kind === 'workbook' && candidate.reference.libraryId === reference.libraryId && candidate.reference.version === reference.version : candidate.id === file.id);
      if (!entry) throw new Error('This chat file has not been registered. Review the library before opening it.');
      return entry;
    },
    async select(file: ChatFile): Promise<AssistantFile> {
      const opened = await files.open(file);
      if (file.kind === 'workbook') { references.set(file.id, file.reference); bases.set(file.id, file.reference); }
      return { id: file.id, name: file.name, status: 'Attached', ...(opened.kind === 'workbook' ? { workbook: opened.document } : {}) };
    },
  };
}

export function useHubAssistant(onRunWorkflow: NonNullable<AssistantPorts['onRunWorkflow']>, onTitle: (id: string, title: string) => void) {
  const titleChanged = useRef(onTitle); titleChanged.current = onTitle;
  const client = useDashboardClient();
  const { adapter } = useSpreadsheetWiringAdapter(false, null);
  const sessions = useMemo(() => ({ adapter, values: new Map<string, ReturnType<typeof createHubAssistantSession>>() }), [adapter]);
  const [view, setView] = useState<{ id: string; mode: 'browse' | 'attach'; initialFile?: ChatFile; resolve?: (file: AssistantFile | null) => void }>();
  const [error, setError] = useState('');
  const selectionGeneration = useRef(0);
  const session = (id: string, initialTitle?: string) => { let value = sessions.values.get(id); if (!value) { value = createHubAssistantSession(id, sessions.adapter, title => titleChanged.current(id, title), initialTitle); sessions.values.set(id, value); } return value; };
  const closeFiles = () => { selectionGeneration.current++; view?.resolve?.(null); setView(undefined); setError(''); };
  return { client, view, error, closeFiles, session, forgetSession: (id: string) => { sessions.values.delete(id); },
    ports(id: string): AssistantPorts {
      const current = session(id);
      return {
        onAttachFile: async file => file ? current.attach(file) : null,
        onRegisterSpreadsheet: file => current.register(file),
        onOpenChatFile: async (file, mode = 'browse') => {
          selectionGeneration.current++;
          if (file) {
            try { setView({ id, mode: 'browse', initialFile: current.reference(file) }); setError(''); }
            catch (error) { setView({ id, mode: 'browse' }); setError(error instanceof Error ? error.message : String(error)); }
            return;
          }
          if (mode === 'browse') { if (view?.id === id) closeFiles(); else setView({ id, mode }); return; }
          return new Promise<AssistantFile | null>(resolve => setView({ id, mode, resolve }));
        },
        onRunWorkflow: async request => { const result = await onRunWorkflow(request); current.linkOutputs(request, result); return result; },
      };
    },
    async select(file: ChatFile) {
      if (!view) return;
      const generation = ++selectionGeneration.current;
      try { const selected = await session(view.id).select(file); if (generation !== selectionGeneration.current) return; view.resolve?.(selected); setView(undefined); setError(''); }
      catch (error) { if (generation === selectionGeneration.current) setError(error instanceof Error ? error.message : String(error)); }
    },
  };
}
