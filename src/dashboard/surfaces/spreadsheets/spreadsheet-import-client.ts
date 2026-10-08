import type { EditableSheet, EditableWorkbook } from './spreadsheet-editor-model.js';

/** Disposable workers keep parsing and export compression off the input thread. */
function spreadsheetWorker<T>(request: unknown, transfer: Transferable[] = []): Promise<T> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./spreadsheet-import-worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<{ state: 'ready'; value: T } | { state: 'failed'; message: string }>) => {
      worker.terminate();
      if (event.data.state === 'ready') resolve(event.data.value);
      else reject(new Error(event.data.message));
    };
    worker.onerror = () => { worker.terminate(); reject(new Error('SPREADSHEET_WORKER_FAILED')); };
    worker.onmessageerror = () => { worker.terminate(); reject(new Error('SPREADSHEET_RESPONSE_INVALID')); };
    try { worker.postMessage(request, transfer); }
    catch (error) { worker.terminate(); reject(error instanceof Error ? error : new Error('SPREADSHEET_WORKER_REQUEST_FAILED', { cause: error })); }
  });
}
export function importSpreadsheetInWorker(name: string, data: ArrayBuffer): Promise<EditableWorkbook> {
  return spreadsheetWorker({ kind: 'import', name, data }, [data]);
}
export function exportSpreadsheetInWorker(document: EditableWorkbook): Promise<ArrayBuffer> {
  return spreadsheetWorker({ kind: 'xlsx', document });
}
export function exportSheetInWorker(sheet: EditableSheet): Promise<string> {
  return spreadsheetWorker({ kind: 'csv', sheet });
}
