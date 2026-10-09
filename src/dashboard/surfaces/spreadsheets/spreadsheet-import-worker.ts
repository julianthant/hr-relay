import { importSpreadsheet, spreadsheetCsv, spreadsheetXlsx, type EditableWorkbook, type EditableSheet } from './spreadsheet-editor-model.js';
type Request = { kind: 'import'; name: string; data: ArrayBuffer } | { kind: 'xlsx'; document: EditableWorkbook } | { kind: 'csv'; sheet: EditableSheet };
self.onmessage = async (event: MessageEvent<Request>) => {
  try {
    const request = event.data;
    const value = request.kind === 'import' ? await importSpreadsheet(request.name, request.data)
      : request.kind === 'xlsx' ? await spreadsheetXlsx(request.document) : spreadsheetCsv(request.sheet);
    self.postMessage({ state: 'ready', value }, { transfer: value instanceof ArrayBuffer ? [value] : [] });
  } catch (error) { self.postMessage({ state: 'failed', message: error instanceof Error ? error.message : 'SPREADSHEET_WORKER_FAILED' }); }
};
