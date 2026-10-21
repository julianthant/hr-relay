import { encodeEditableWorkbook } from '../../../models/dashboard/workbooks.js';
import { canonicalJsonStringify } from '../../../rules/validation/canonical-json.js';
import type { createSpreadsheetWiringAdapter } from '../../state/spreadsheet-wiring-adapter.js';
import { exportSheetInWorker, exportSpreadsheetInWorker } from './spreadsheet-import-client.js';
import { spreadsheetSaveMatches, type EditableWorkbook, type SpreadsheetSaveResult } from './spreadsheet-editor-model.js';

export type SpreadsheetFileReference = Readonly<{ libraryId: string; version: number; name: string; status: 'Attached' | 'Generated' | 'Updated' }>;
export type SpreadsheetRegistrationRequest = Readonly<{
  operationId: string;
  status: SpreadsheetFileReference['status'];
  workbook: EditableWorkbook;
  base?: Readonly<{ libraryId: string; version: number }>;
}>;
export type SpreadsheetRegistrationResult = { state: 'confirmed'; file: SpreadsheetFileReference } | Exclude<SpreadsheetSaveResult, { state: 'confirmed' }>;
type Adapter = ReturnType<typeof createSpreadsheetWiringAdapter>;
export type SpreadsheetChatRegistrationPort = ReturnType<typeof createSpreadsheetChatRegistrationPort>;
const ports = new WeakMap<Adapter, SpreadsheetChatRegistrationPort>();

export function createSpreadsheetChatRegistrationPort(adapter: Adapter) {
  const operations = new Map<string, { fingerprint: string; key?: string; pending?: Promise<SpreadsheetRegistrationResult>; confirmed?: SpreadsheetFileReference }>();
  return {
    register(request: SpreadsheetRegistrationRequest): Promise<SpreadsheetRegistrationResult> {
      if (!request.operationId.trim()) throw new Error('SPREADSHEET_REGISTRATION_ID_REQUIRED');
      const workbook = encodeEditableWorkbook(request.workbook);
      const fingerprint = canonicalJsonStringify(JSON.parse(JSON.stringify({ ...request, workbook })));
      let operation = operations.get(request.operationId);
      if (operation && operation.fingerprint !== fingerprint) return Promise.resolve({ state: 'refused', reason: 'This registration belongs to a different workbook draft. Use a new operation identity.' });
      if (!operation) { operation = { fingerprint }; operations.set(request.operationId, operation); }
      if (operation.confirmed) return Promise.resolve({ state: 'confirmed', file: operation.confirmed });
      if (operation.pending) return operation.pending;
      const held = operation;
      const execute = async (): Promise<SpreadsheetRegistrationResult> => {
        if (held.key === undefined) {
          if (request.status === 'Updated' && !request.base || request.workbook.libraryId !== request.base?.libraryId) return { state: 'refused', reason: 'An updated spreadsheet needs its exact saved workbook identity and version.' };
          await adapter.list();
          if (adapter.snapshot().error) return { state: 'refused', reason: adapter.snapshot().error };
          if (request.base) {
            await adapter.open(request.base.libraryId);
            const draft = adapter.draft(request.base.libraryId);
            if (!draft?.opened || draft.opened.version !== request.base.version || draft.dirty || draft.intent) return { state: 'conflict', reason: 'The workbook changed or has an unsaved draft. Review it in Spreadsheets before registering this file.' };
            if (request.status === 'Attached') {
              if (!spreadsheetSaveMatches(request.workbook, { state: 'confirmed', version: draft.opened.version, readback: draft.opened.workbook })) return { state: 'refused', reason: 'The attachment does not match that saved workbook version.' };
              const file = { ...request.base, name: draft.opened.workbook.name, status: request.status };
              adapter.markRegistered(request.base.libraryId, file.version, file.status); held.confirmed = file;
              return { state: 'confirmed', file };
            }
            held.key = request.base.libraryId;
            adapter.change(held.key, request.workbook, true);
          } else held.key = adapter.create(request.workbook);
        }
        const draft = adapter.draft(held.key);
        if (!draft) return { state: 'refused', reason: 'The registration draft is no longer available. Review the library before continuing.' };
        const version = (request.base?.version ?? 0) + 1;
        if (!draft.intent && !spreadsheetSaveMatches(request.workbook, { state: 'confirmed', version, readback: draft.document })) return { state: 'conflict', reason: 'The registration draft changed. Review it in Spreadsheets before continuing.' };
        if (!draft.intent && draft.opened && draft.opened.version > version) return { state: 'conflict', reason: 'A newer workbook version is already open. Review it before continuing.' };
        const result: SpreadsheetSaveResult = !draft.intent && draft.opened?.version === version
          ? { state: 'confirmed', version, readback: draft.opened.workbook }
          : await adapter.save(held.key, draft.document);
        if (result.state !== 'confirmed') return result;
        if (!spreadsheetSaveMatches(request.workbook, result)) return { state: 'uncertain', reason: 'The registration readback differs from this file.' };
        const libraryId = result.readback.libraryId;
        if (!libraryId) throw new Error('SPREADSHEET_REGISTRATION_ID_UNAVAILABLE');
        adapter.change(held.key, result.readback, false);
        adapter.markRegistered(held.key, result.version, request.status);
        const file = { libraryId, version: result.version, name: result.readback.name, status: request.status };
        held.confirmed = file;
        return { state: 'confirmed', file };
      };
      held.pending = execute().finally(() => { held.pending = undefined; });
      return held.pending;
    },
    async open(file: SpreadsheetFileReference) { return (await adapter.readVersion(file.libraryId, file.version)).workbook; },
    async download(file: SpreadsheetFileReference) {
      const document = await this.open(file);
      const csv = /\.csv$/iu.test(document.name);
      if (csv && document.sheets.length !== 1) throw new Error('SPREADSHEET_CSV_REQUIRES_ONE_SHEET');
      const data = csv ? await exportSheetInWorker(document.sheets[0]) : await exportSpreadsheetInWorker(document);
      return { name: document.name, blob: new Blob([data], { type: csv ? 'text/csv;charset=utf-8' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }) };
    },
  };
}

export function spreadsheetChatRegistrationPort(adapter: Adapter): SpreadsheetChatRegistrationPort {
  let port = ports.get(adapter);
  if (!port) { port = createSpreadsheetChatRegistrationPort(adapter); ports.set(adapter, port); }
  return port;
}

export function saveSpreadsheetDownload(file: { name: string; blob: Blob }): void {
  const url = URL.createObjectURL(file.blob), link = document.createElement('a');
  link.href = url; link.download = file.name;
  document.body.append(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
