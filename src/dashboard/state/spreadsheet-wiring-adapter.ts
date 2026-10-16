import { useEffect, useMemo, useSyncExternalStore } from 'react';
import type { DashboardClient } from '../client/index.js';
import { DashboardClientError } from '../client/errors.js';
import { useDashboardClient } from './client-context.js';
import type { SavedWorkbook } from '../../models/dashboard/workbooks.js';
import { cellText, spreadsheetSaveMatches, type EditableWorkbook, type SpreadsheetSaveResult } from '../surfaces/spreadsheets/spreadsheet-editor-model.js';
import { NOT_MAPPED, type RegisteredSpreadsheet } from '../surfaces/spreadsheets/spreadsheet-mock-model.js';
import { spreadsheetField } from '../surfaces/spreadsheets/spreadsheet-fields-model.js';

type WorkbookLibraryQueries = Pick<DashboardClient, 'workbookList' | 'workbookOpen' | 'workbookCreate' | 'workbookSave'>;
type SaveIntent = { draft: EditableWorkbook; expectedVersion: number; libraryId?: string; error?: unknown };
type Draft = { document: EditableWorkbook; dirty: boolean; opened?: SavedWorkbook; intent?: SaveIntent; saving?: Promise<SpreadsheetSaveResult> };
type Snapshot = { files: readonly RegisteredSpreadsheet[]; loading: boolean; opening?: string; openError: string; error: string };
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
function libraryRow(id: string, document: EditableWorkbook, addedAt?: string): RegisteredSpreadsheet {
  return { id, name: document.name, typeId: 'local', addedAt, sheets: document.sheets.map(sheet => ({ name: sheet.name, headerRow: sheet.sourceHeaderRow ?? sheet.headerRow ?? 1,
    columns: sheet.rows[(sheet.headerRow ?? 1) - 1].cells.map(cellText), mapping: sheet.columnBindings?.map(binding => binding.fieldId ? spreadsheetField(binding.fieldId).label : NOT_MAPPED) ?? [], bindings: sheet.columnBindings })) };
}

export function createSpreadsheetWiringAdapter(client: WorkbookLibraryQueries) {
  let snapshot: Snapshot = { files: [], loading: true, openError: '', error: '' };
  const listeners = new Set<() => void>();
  const drafts = new Map<string, Draft>();
  const aliases = new Map<string, string>();
  let listing = 0;
  let opening = 0;
  const publish = (patch: Partial<Snapshot> = {}) => { snapshot = { ...snapshot, ...patch }; for (const listener of listeners) listener(); };
  const keyFor = (id: string) => aliases.get(id) ?? id;
  const rowFor = (key: string, draft: Draft) => libraryRow(key, draft.document, draft.opened?.createdAt);
  const updateRow = (key: string, draft: Draft) => { const row = rowFor(key, draft); publish({ files: snapshot.files.some(file => file.id === key) ? snapshot.files.map(file => file.id === key ? row : file) : [row, ...snapshot.files] }); };
  const adapter = {
    subscribe(this: void, listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    snapshot: () => snapshot,
    key: keyFor,
    draft(id: string | null) { return id === null ? undefined : drafts.get(keyFor(id)); },
    async list() {
      const request = ++listing; publish({ loading: true, error: '' });
      try {
        const records = await client.workbookList();
        if (request !== listing) return;
        const files = records.map(record => { const key = keyFor(record.libraryId); const draft = drafts.get(key); return draft ? rowFor(key, draft) : libraryRow(key, record.workbook, record.createdAt); });
        for (const [key, draft] of drafts) if (!files.some(file => file.id === key)) files.unshift(rowFor(key, draft));
        publish({ files, loading: false });
      } catch (error) { if (request === listing) publish({ loading: false, error: message(error) }); }
    },
    async open(id: string | null) {
      const request = ++opening;
      if (id === null) { publish({ opening: undefined, openError: '' }); return; }
      const key = keyFor(id);
      if (drafts.has(key)) { publish({ opening: undefined, openError: '' }); return; }
      publish({ opening: id, openError: '' });
      try {
        const opened = await client.workbookOpen(id);
        if (request !== opening) return;
        if (!drafts.has(key)) { drafts.set(key, { document: opened.workbook, dirty: false, opened }); publish({ openError: '', opening: undefined }); }
      } catch (error) { if (request === opening) publish({ openError: message(error), opening: undefined }); }
    },
    close(id: string) {
      const key = keyFor(id), draft = drafts.get(key);
      if (!draft || draft.intent || draft.saving) return;
      drafts.delete(key);
      const opened = draft.opened;
      if (opened) {
        aliases.delete(opened.libraryId);
        publish({ files: snapshot.files.map(file => file.id === key ? libraryRow(opened.libraryId, opened.workbook, opened.createdAt) : file) });
      } else publish({ files: snapshot.files.filter(file => file.id !== key) });
    },
    discard() {
      listing++; opening++;
      for (const key of drafts.keys()) adapter.close(key);
      publish({ loading: false, opening: undefined });
    },
    create(document: EditableWorkbook) {
      const key = crypto.randomUUID(); const draft = { document, dirty: true }; drafts.set(key, draft); updateRow(key, draft); return key;
    },
    change(id: string, document: EditableWorkbook, dirty: boolean) {
      const key = keyFor(id), draft = drafts.get(key);
      if (!draft) throw new Error('SPREADSHEET_DRAFT_UNAVAILABLE');
      draft.document = document;
      draft.dirty = dirty || !!draft.intent || !draft.opened || !spreadsheetSaveMatches(document, { state: 'confirmed', version: draft.opened.version, readback: draft.opened.workbook });
      updateRow(key, draft);
    },
    async save(id: string, document: EditableWorkbook): Promise<SpreadsheetSaveResult> {
      const key = keyFor(id), draft = drafts.get(key);
      if (!draft) return { state: 'refused', reason: 'Open a workbook before saving.' };
      if (draft.saving) return draft.saving;
      const intent: SaveIntent = draft.intent ?? { draft: structuredClone(document), libraryId: draft.opened?.libraryId, expectedVersion: draft.opened?.version ?? 0 };
      const recovering = draft.intent !== undefined;
      draft.intent = intent;
      const execute = async (): Promise<SpreadsheetSaveResult> => {
        let receipt: SavedWorkbook | undefined;
        let rejection: SpreadsheetSaveResult | undefined;
        if (!recovering) {
          try { receipt = intent.libraryId ? await client.workbookSave(intent.libraryId, intent.expectedVersion, intent.draft) : await client.workbookCreate(intent.draft); }
          catch (error) {
            if (error instanceof DashboardClientError && error.kind === 'http' && error.status !== undefined && error.status >= 400 && error.status < 500 && error.code) {
              rejection = { state: error.code === 'WORKBOOK_VERSION_CONFLICT' ? 'conflict' : 'refused', reason: message(error) };
            } else {
              intent.error = error;
            }
          }
        }
        if (rejection) { draft.intent = undefined; return rejection; }
        const libraryId = receipt?.libraryId ?? intent.libraryId;
        if (!libraryId) {
          await adapter.list();
          return { state: 'uncertain', reason: `Save outcome is uncertain. The new workbook identity could not be confirmed.${intent.error === undefined ? '' : ` ${message(intent.error)}`}` };
        }
        intent.libraryId = libraryId;
        try {
          const opened = await client.workbookOpen(libraryId);
          const expected = { ...intent.draft, libraryId };
          const result: SpreadsheetSaveResult = { state: 'confirmed', version: opened.version, readback: opened.workbook };
          if (opened.libraryId !== libraryId || opened.version !== intent.expectedVersion + 1 || !spreadsheetSaveMatches(expected, result)) return { state: 'uncertain', reason: 'The library readback does not match the saved draft.' };
          draft.opened = opened; draft.intent = undefined;
          if (draft.document.libraryId === undefined) draft.document = { ...draft.document, libraryId };
          aliases.set(libraryId, key); updateRow(key, draft);
          if (!spreadsheetSaveMatches(draft.document, result)) return { state: 'uncertain', reason: 'The original save was confirmed. The current draft still has unsaved changes.' };
          return result;
        } catch (error) { intent.error = error; return { state: 'uncertain', reason: `Save outcome is uncertain. ${message(error)} Check the library before saving again.` }; }
      };
      draft.saving = execute();
      publish();
      try { return await draft.saving; }
      finally { draft.saving = undefined; publish(); }
    },
  };
  return adapter;
}

const sessions = new WeakMap<WorkbookLibraryQueries, ReturnType<typeof createSpreadsheetWiringAdapter>>();
export function useSpreadsheetWiringAdapter(enabled: boolean, selectedId: string | null) {
  const client = useDashboardClient();
  const adapter = useMemo(() => { let value = sessions.get(client); if (!value) { value = createSpreadsheetWiringAdapter(client); sessions.set(client, value); } return value; }, [client]);
  const snapshot = useSyncExternalStore(adapter.subscribe, adapter.snapshot, adapter.snapshot);
  useEffect(() => { if (enabled) void adapter.list(); }, [adapter, enabled]);
  useEffect(() => { if (enabled) void adapter.open(selectedId); }, [adapter, enabled, selectedId]);
  return { ...snapshot, adapter, key: selectedId === null ? null : adapter.key(selectedId), draft: adapter.draft(selectedId) };
}
