import { ERROR_CATALOG } from "../../models/failures/error-catalog.js";
import { readWithDeadline } from "../client/read-deadline.js";
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import type { DashboardClient } from '../client/index.js';
import { DashboardClientError } from '../client/errors.js';
import { useDashboardClient, useDashboardCommandBinding } from './client-context.js';
import { encodeEditableWorkbook, type SavedWorkbook, type WorkbookType } from '../../models/dashboard/workbooks.js';
import type { WorkbookCompatibility, WorkbookLibraryEntry, WorkbookLibraryAction, WorkbookLibraryActionResult } from '../../models/dashboard/workbook-library.js';
import { canonicalJsonStringify } from '../../rules/validation/canonical-json.js';
import { spreadsheetSaveMatches, type SpreadsheetSaveResult } from '../surfaces/spreadsheets/spreadsheet-editor-model.js';
import { cellText, type EditableWorkbook } from '../../rules/spreadsheets/workbook-io.js';
import { NOT_MAPPED, type RegisteredSpreadsheet } from '../surfaces/spreadsheets/spreadsheet-mock-model.js';
import { spreadsheetEditorField } from '../surfaces/spreadsheets/spreadsheet-fields-model.js';

type WorkbookLibraryQueries = Pick<DashboardClient, 'workbookList' | 'workbookOpen' | 'workbookRevision' | 'workbookCreate' | 'workbookSave' | 'workbookHistory'
  | 'workbookCatalog' | 'workbookCompatibility' | 'workbookLibraryAction' | 'workbookLibraryActionStatus' | 'workbookLibraryVersion' | 'workbookTypes' | 'workbookPutType'>;
export type LibraryChangeResult = Readonly<{ state: 'confirmed' }> | Readonly<{ state: 'refused' | 'uncertain' | 'recorded'; message: string }>;
type SaveIntent = { draft: EditableWorkbook; expectedVersion: number; libraryId?: string; error?: unknown };
type Draft = { document: EditableWorkbook; dirty: boolean; opened?: SavedWorkbook; intent?: SaveIntent; saving?: Promise<SpreadsheetSaveResult> };
type Snapshot = { files: readonly RegisteredSpreadsheet[]; loading: boolean; refreshing: boolean; opening?: string; openError: string; error: string;
  catalog: readonly WorkbookLibraryEntry[]; compatibility?: WorkbookCompatibility; types: readonly WorkbookType[]; typesError: string; catalogLoading: boolean; catalogRefreshing: boolean; catalogError: string; pendingLibraries: readonly string[]; pendingTypes: readonly WorkbookType[] };
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
function assertCatalogCompatibility(catalog: readonly WorkbookLibraryEntry[], compatibility: WorkbookCompatibility): void {
  const local = catalog.filter(entry => entry.state.origin.kind === 'local' && !entry.state.removed);
  if (compatibility.libraries.length !== local.length || compatibility.libraries.some(library =>
    local.find(entry => entry.libraryId === library.libraryId)?.state.selectedVersionId !== library.versionId))
    throw new Error('WORKBOOK_COMPATIBILITY_CATALOG_MISMATCH');
}
function libraryRow(id: string, document: EditableWorkbook, addedAt?: string, version?: number): RegisteredSpreadsheet {
  return { id, name: document.name, typeId: 'local', addedAt, version, rowCount: document.sheets.reduce((count, sheet) => count + sheet.rows.length - (sheet.headerRow ?? 1), 0), status: version !== undefined && version > 1 ? 'Updated' : undefined, sheets: document.sheets.map(sheet => ({ name: sheet.name, headerRow: sheet.sourceHeaderRow ?? sheet.headerRow ?? 1,
    columns: sheet.rows[(sheet.headerRow ?? 1) - 1].cells.map(cellText), mapping: sheet.columnBindings?.map((binding, column) => binding.fieldId ? spreadsheetEditorField(binding.fieldId,
      binding.sourceHeader || cellText(sheet.rows[(sheet.headerRow ?? 1) - 1].cells[column])).label : NOT_MAPPED) ?? [], bindings: sheet.columnBindings })) };
}

export function createSpreadsheetWiringAdapter(client: WorkbookLibraryQueries) {
  let snapshot: Snapshot = { files: [], loading: true, refreshing: false, openError: '', error: '', catalog: [], types: [], typesError: '', catalogLoading: true, catalogRefreshing: false, catalogError: '', pendingLibraries: [], pendingTypes: [] };
  const listeners = new Set<() => void>();
  const drafts = new Map<string, Draft>();
  const aliases = new Map<string, string>();
  const origins = new Map<string, { version: number; status: "Attached" | "Generated" | "Updated" }>();
  let readAuthority: object = client;
  let readReady = true;
  let listing = 0;
  let listed = false;
  let pendingList: Promise<void> | undefined;
  let opening = 0;
  let catalogRequest = 0;
  const libraryIntents = new Map<string, WorkbookLibraryAction>();
  const typeIntents = new Map<string, WorkbookType>();
  const pendingLibraryIds = () => [...libraryIntents.keys()];
  const publish = (patch: Partial<Snapshot> = {}) => { snapshot = { ...snapshot, ...patch }; for (const listener of listeners) listener(); };
  const keyFor = (id: string) => aliases.get(id) ?? id;
  const withOrigin = (row: RegisteredSpreadsheet, libraryId: string) => {
    const origin = origins.get(libraryId);
    return origin && origin.version === row.version ? { ...row, status: origin.status } : row;
  };
  const rowFor = (key: string, draft: Draft) => withOrigin(libraryRow(key, draft.document, draft.opened?.createdAt, draft.opened?.version), draft.opened?.libraryId ?? key);
  const updateRow = (key: string, draft: Draft) => { const row = rowFor(key, draft); publish({ files: snapshot.files.some(file => file.id === key) ? snapshot.files.map(file => file.id === key ? row : file) : [row, ...snapshot.files] }); };
  const adapter = {
    subscribe(this: void, listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    snapshot: () => snapshot,
    key: keyFor,
    setReadAuthority(authority: object) {
      if (readAuthority === authority) return;
      readAuthority = authority; readReady = false; listed = false;
      listing++; opening++; pendingList = undefined;
      catalogRequest++;
      snapshot = { files: [], loading: true, refreshing: false, openError: '', error: '', catalog: [], types: [], typesError: '', catalogLoading: true, catalogRefreshing: false, catalogError: '', pendingLibraries: pendingLibraryIds(), pendingTypes: [...typeIntents.values()] };
    },
    draft(id: string | null) { return id === null ? undefined : drafts.get(keyFor(id)); },
    async refreshCatalog() {
      const request = ++catalogRequest;
      publish({ catalogRefreshing: true, catalogError: '', compatibility: undefined });
      try {
        const [catalogRead, compatibilityRead, typesRead] = await Promise.allSettled([
          readWithDeadline(() => client.workbookCatalog(), 'DASHBOARD_READ_FAILED'),
          readWithDeadline(() => client.workbookCompatibility(), 'DASHBOARD_READ_FAILED'),
          readWithDeadline(() => client.workbookTypes(), 'DASHBOARD_READ_FAILED'),
        ]);
        if (request !== catalogRequest) return;
        if (catalogRead.status === 'rejected') throw catalogRead.reason;
        if (compatibilityRead.status === 'rejected') throw compatibilityRead.reason;
        const catalog = catalogRead.value, compatibility = compatibilityRead.value;
        assertCatalogCompatibility(catalog, compatibility);
        publish({ catalog, compatibility, ...(typesRead.status === 'rejected' ? { typesError: ERROR_CATALOG.DASHBOARD_READ_FAILED.text } : { types: typesRead.value, typesError: '' }),
          catalogLoading: false, catalogRefreshing: false });
      } catch { if (request === catalogRequest) publish({ catalogLoading: false, catalogRefreshing: false, catalogError: ERROR_CATALOG.DASHBOARD_READ_FAILED.text }); }
    },
    async saveType(type: WorkbookType): Promise<LibraryChangeResult> {
      const retained = typeIntents.get(type.id), authority = readAuthority;
      if (retained && canonicalJsonStringify(retained) !== canonicalJsonStringify(type)) return { state: 'refused', message: 'Check the pending type change before editing it again.' };
      if (!retained) {
        typeIntents.set(type.id, structuredClone(type)); publish({ pendingTypes: [...typeIntents.values()] });
        try { await client.workbookPutType(type); }
        catch (error) {
          if (error instanceof DashboardClientError && error.kind === 'http' && error.status !== undefined && error.status >= 400 && error.status < 500 && error.code) {
            typeIntents.delete(type.id); publish({ pendingTypes: [...typeIntents.values()] }); return { state: 'refused', message: message(error) };
          }
        }
      }
      try {
        const types = await readWithDeadline(() => client.workbookTypes(), 'DASHBOARD_READ_FAILED');
        if (authority !== readAuthority || !types.some(current => canonicalJsonStringify(current) === canonicalJsonStringify(type))) return { state: 'uncertain', message: 'The type change is unconfirmed. Check its result before editing it again.' };
        typeIntents.delete(type.id); publish({ types, typesError: '', pendingTypes: [...typeIntents.values()] });
        return { state: 'confirmed' };
      } catch (error) { return { state: 'uncertain', message: `The type change is unconfirmed. ${message(error)}` }; }
    },
    async settleLibrary(libraryId: string, record?: WorkbookLibraryActionResult): Promise<LibraryChangeResult> {
      const action = libraryIntents.get(libraryId);
      if (action === undefined) return { state: 'refused', message: 'There is no retained library change to check.' };
      const authority = readAuthority;
      const request = ++catalogRequest;
      try {
        if (record === undefined) {
          const status = await readWithDeadline(() => client.workbookLibraryActionStatus(libraryId, action.operationId), 'DASHBOARD_READ_FAILED');
          if (status.state === 'absent') return { state: 'uncertain', message: 'The library change is not yet confirmed. Check its result before changing this file again.' };
          if (status.state === 'retired') return { state: 'refused', message: status.message };
          record = status.record;
        }
        if (record.libraryId !== libraryId || canonicalJsonStringify(record.action) !== canonicalJsonStringify(action)) return { state: 'uncertain', message: 'The library result does not match the retained change.' };
        if (action.change.kind === 'create-version' && action.change.from.kind === 'values') {
          const saved = await readWithDeadline(() => client.workbookLibraryVersion(libraryId, action.operationId), 'DASHBOARD_READ_FAILED');
          if (saved.version.id !== action.operationId || saved.libraryId !== libraryId || canonicalJsonStringify(saved.workbook) !== canonicalJsonStringify(action.change.from.workbook)) return { state: 'uncertain', message: 'The values-only version readback does not match the saved draft.' };
        }
        const [catalogRead, compatibilityRead, typesRead] = await Promise.allSettled([readWithDeadline(() => client.workbookCatalog(), 'DASHBOARD_READ_FAILED'), readWithDeadline(() => client.workbookCompatibility(), 'DASHBOARD_READ_FAILED'),
          readWithDeadline(() => client.workbookTypes(), 'DASHBOARD_READ_FAILED')]);
        if (authority !== readAuthority || request !== catalogRequest) return { state: 'uncertain', message: 'Library authority changed. Check the result from the current library.' };
        if (catalogRead.status === 'rejected') throw catalogRead.reason;
        if (compatibilityRead.status === 'rejected') throw compatibilityRead.reason;
        const catalog = catalogRead.value, compatibility = compatibilityRead.value;
        assertCatalogCompatibility(catalog, compatibility);
        const current = catalog.find(entry => entry.libraryId === libraryId);
        const matches = record.result.removed ? current === undefined : current !== undefined && canonicalJsonStringify(current.state) === canonicalJsonStringify(record.result)
          && (action.change.kind !== 'rename' || current.name === action.change.name)
          && (action.change.kind !== 'metadata' || canonicalJsonStringify(current.metadata) === canonicalJsonStringify(action.change.metadata));
        libraryIntents.delete(libraryId);
        publish({ catalog, compatibility, ...(typesRead.status === 'rejected' ? { typesError: ERROR_CATALOG.DASHBOARD_READ_FAILED.text } : { types: typesRead.value, typesError: '' }),
          catalogLoading: false, catalogRefreshing: false, catalogError: '', pendingLibraries: pendingLibraryIds() });
        const draft = drafts.get(keyFor(libraryId));
        if (draft && !draft.dirty) { adapter.close(libraryId); if (!record.result.removed) await adapter.open(libraryId); }
        await adapter.list();
        return matches ? { state: 'confirmed' } : { state: 'recorded', message: 'The change was recorded. The library has changed again; review its current version.' };
      } catch (error) { return { state: 'uncertain', message: `The library change is unconfirmed. ${message(error)}` }; }
    },
    async changeLibrary(entry: WorkbookLibraryEntry, change: WorkbookLibraryAction['change']): Promise<LibraryChangeResult> {
      if (pendingLibraryIds().includes(entry.libraryId)) return { state: 'uncertain', message: 'Check the pending library change before changing this file again.' };
      const current = snapshot.catalog.find(candidate => candidate.libraryId === entry.libraryId);
      if (snapshot.catalogLoading || snapshot.catalogRefreshing || snapshot.catalogError || current?.state.revision !== entry.state.revision || current.version !== entry.version) return { state: 'refused', message: 'The library changed. Refresh it and review the action again.' };
      const draft = drafts.get(keyFor(entry.libraryId));
      const changesData = change.kind === 'link' || change.kind === 'unlink' || change.kind === 'sync' || change.kind === 'use-version' || change.kind === 'remove' || change.kind === 'rename' || change.kind === 'metadata' || change.kind === 'create-version' && change.useNow;
      if (changesData && draft && (draft.dirty || draft.intent || draft.saving)) return { state: 'refused', message: 'Save or close the open draft before changing the version in use.' };
      const action: WorkbookLibraryAction = { operationId: crypto.randomUUID(), expectedRevision: entry.state.revision, expectedVersion: entry.version, change };
      libraryIntents.set(entry.libraryId, action);
      publish({ pendingLibraries: pendingLibraryIds() });
      try { return await adapter.settleLibrary(entry.libraryId, await client.workbookLibraryAction(entry.libraryId, action)); }
      catch (error) {
        if (error instanceof DashboardClientError && error.kind === 'http' && error.status !== undefined && error.status >= 400 && error.status < 500 && error.code) {
          try {
            const status = await readWithDeadline(() => client.workbookLibraryActionStatus(entry.libraryId, action.operationId), 'DASHBOARD_READ_FAILED');
            if (status.state === 'recorded') return adapter.settleLibrary(entry.libraryId, status.record);
            if (status.state === 'retired') return { state: 'refused', message: status.message };
            libraryIntents.delete(entry.libraryId); publish({ pendingLibraries: pendingLibraryIds() });
            await adapter.refreshCatalog();
            return { state: 'refused', message: message(error) };
          } catch { return { state: 'uncertain', message: 'The library change is unconfirmed. Check its result before changing this file again.' }; }
        }
        return adapter.settleLibrary(entry.libraryId);
      }
    },
    async saveValuesVersion(id: string, name: string, document: EditableWorkbook): Promise<LibraryChangeResult> {
      const draft = drafts.get(keyFor(id)), libraryId = draft?.opened?.libraryId;
      if (!libraryId || draft.intent || draft.saving) return { state: 'refused', message: 'Check the current save result before saving a new version.' };
      const pending = libraryIntents.get(libraryId);
      if (pending) return pending.change.kind === 'create-version' && pending.change.from.kind === 'values' && pending.change.name === name
        ? adapter.settleLibrary(libraryId) : { state: 'refused', message: 'Check the pending library change before saving a new version.' };
      const entry = snapshot.catalog.find(entry => entry.libraryId === libraryId);
      if (!entry || entry.version !== draft.opened?.version) return { state: 'refused', message: 'Refresh the library before saving a new version.' };
      return adapter.changeLibrary(entry, { kind: 'create-version', name, from: { kind: 'values', workbook: encodeEditableWorkbook(document) }, useNow: false });
    },
    list(): Promise<void> {
      if (pendingList !== undefined) return pendingList;
      const listingNow = (async () => {
        const request = ++listing; readReady = false; publish({ loading: !listed, refreshing: true, error: '' });
        try {
          const records = await readWithDeadline(() => client.workbookList(), "DASHBOARD_READ_FAILED");
          if (request !== listing) return;
          const files = records.map(record => { const key = keyFor(record.libraryId); const draft = drafts.get(key); return draft ? rowFor(key, draft) : withOrigin(libraryRow(key, record.workbook, record.createdAt, record.version), record.libraryId); });
          for (const [key, draft] of drafts) if (!files.some(file => file.id === key)) files.unshift(rowFor(key, draft));
          listed = true; readReady = true; publish({ files, loading: false, refreshing: false });
        } catch { if (request === listing) publish({ loading: false, refreshing: false, error: ERROR_CATALOG.DASHBOARD_READ_FAILED.text }); }
      })().finally(() => { if (pendingList === listingNow) pendingList = undefined; });
      pendingList = listingNow;
      return listingNow;
    },
    async open(id: string | null) {
      const request = ++opening;
      if (id === null) { publish({ opening: undefined, openError: '' }); return; }
      const key = keyFor(id);
      if (drafts.has(key)) { publish({ opening: undefined, openError: '' }); return; }
      publish({ opening: id, openError: '' });
      try {
        const opened = await readWithDeadline(() => client.workbookOpen(id), "DASHBOARD_READ_FAILED");
        if (request !== opening) return;
        readReady = true;
        if (!drafts.has(key)) { drafts.set(key, { document: opened.workbook, dirty: false, opened }); publish({ openError: '', opening: undefined }); }
      } catch { if (request === opening) publish({ openError: ERROR_CATALOG.DASHBOARD_READ_FAILED.text, opening: undefined }); }
    },
    async history(id: string) {
      const draft = drafts.get(keyFor(id));
      const libraryId = draft?.opened?.libraryId ?? id;
      return readWithDeadline(() => client.workbookHistory(libraryId), "DASHBOARD_READ_FAILED");
    },
    async readVersion(libraryId: string, version: number) {
      return readWithDeadline(() => client.workbookRevision(libraryId, version), "DASHBOARD_READ_FAILED");
    },
    async readNamedVersion(libraryId: string, versionId: string) {
      return readWithDeadline(() => client.workbookLibraryVersion(libraryId, versionId), 'DASHBOARD_READ_FAILED');
    },
    markRegistered(id: string, version: number, status: "Attached" | "Generated" | "Updated") {
      const key = keyFor(id), draft = drafts.get(key);
      if (!draft || draft.opened?.version !== version || draft.dirty) throw new Error("SPREADSHEET_REGISTRATION_UNCONFIRMED");
      origins.set(draft.opened.libraryId, { version, status }); updateRow(key, draft);
    },
    close(id: string) {
      const key = keyFor(id), draft = drafts.get(key);
      if (!draft || draft.intent || draft.saving) return;
      drafts.delete(key);
      const opened = draft.opened;
      if (opened) {
        aliases.delete(opened.libraryId);
        publish({ files: snapshot.files.map(file => file.id === key ? withOrigin(libraryRow(opened.libraryId, opened.workbook, opened.createdAt, opened.version), opened.libraryId) : file) });
      } else publish({ files: snapshot.files.filter(file => file.id !== key) });
    },
    discard() {
      listing++; opening++; pendingList = undefined;
      for (const key of drafts.keys()) adapter.close(key);
      publish({ loading: false, refreshing: false, opening: undefined });
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
      if (pendingLibraryIds().includes(draft.opened?.libraryId ?? id)) return { state: 'refused', reason: 'Check the pending library change before saving this spreadsheet.' };
      if (draft.saving) return draft.saving;
      if (!readReady && !draft.intent) return { state: 'refused', reason: ERROR_CATALOG.DASHBOARD_READ_FAILED.text };
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
          const opened = await readWithDeadline(() => client.workbookOpen(libraryId), "DASHBOARD_READ_FAILED");
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
      try { const result = await draft.saving; if (result.state === 'confirmed' && !snapshot.catalogLoading) await adapter.refreshCatalog(); return result; }
      finally { draft.saving = undefined; publish(); }
    },
  };
  return adapter;
}

const sessions = new WeakMap<WorkbookLibraryQueries, ReturnType<typeof createSpreadsheetWiringAdapter>>();
export function useSpreadsheetWiringAdapter(enabled: boolean, selectedId: string | null, loadCatalog = false) {
  const client = useDashboardClient();
  const adapter = useMemo(() => { let value = sessions.get(client); if (!value) { value = createSpreadsheetWiringAdapter(client); sessions.set(client, value); } return value; }, [client]);
  const binding = useDashboardCommandBinding();
  const authority = binding?.authority.epoch ?? client;
  adapter.setReadAuthority(authority);
  const snapshot = useSyncExternalStore(adapter.subscribe, adapter.snapshot, adapter.snapshot);
  useEffect(() => { if (enabled) void adapter.list(); }, [adapter, enabled, authority]);
  useEffect(() => { if (enabled && loadCatalog) void adapter.refreshCatalog(); }, [adapter, enabled, loadCatalog, authority]);
  useEffect(() => { if (enabled) void adapter.open(selectedId); }, [adapter, enabled, selectedId, authority]);
  return { ...snapshot, adapter, key: selectedId === null ? null : adapter.key(selectedId), draft: adapter.draft(selectedId) };
}
