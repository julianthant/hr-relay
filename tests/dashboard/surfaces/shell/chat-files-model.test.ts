import assert from 'node:assert/strict';
import { it, vi } from 'vitest';
import { createChatFilesPort } from '../../../../src/dashboard/surfaces/shell/chat-files-model.js';
import { createSpreadsheetChatRegistrationPort } from '../../../../src/dashboard/surfaces/spreadsheets/spreadsheet-chat-registration-model.js';
import { createSpreadsheetWiringAdapter } from '../../../../src/dashboard/state/spreadsheet-wiring-adapter.js';
import { newEditableWorkbook } from '../../../../src/dashboard/surfaces/spreadsheets/spreadsheet-editor-model.js';
import { SavedWorkbookSchema, type SavedWorkbook } from '../../../../src/models/dashboard/workbooks.js';
function world() {
  let saved: SavedWorkbook | undefined;
  const client = {
    workbookList: vi.fn(async () => saved ? [saved] : []),
    workbookOpen: vi.fn(async () => { if (!saved) throw new Error('unavailable'); return saved; }),
    workbookCreate: vi.fn(async (workbook: unknown) => { saved = SavedWorkbookSchema.parse({ libraryId: 'book', version: 1, createdAt: '2026-10-01T00:00:00Z', savedAt: '2026-10-01T00:00:00Z', workbook: { ...workbook as object, libraryId: 'book' } }); return saved; }),
    workbookSave: vi.fn(), workbookHistory: vi.fn(),
  };
  const registration = createSpreadsheetChatRegistrationPort(createSpreadsheetWiringAdapter(client));
  return { port: createChatFilesPort(registration), other: createChatFilesPort(registration), client };
}
it('keeps mock documents isolated by conversation and routes spreadsheets through the real library', async () => {
  const { port, other, client } = world(); const listener = vi.fn(); const unsubscribe = port.subscribe(listener);
  const mock = port.attachMockFile(new File(['draft'], 'Notes.txt', { type: 'text/plain' }));
  assert.equal(mock.kind, 'mock'); assert.equal(listener.mock.calls.length, 1); assert.equal(other.snapshot().length, 0);
  assert.equal((await port.download(mock)).name, 'Notes.txt'); assert.equal((await port.open(mock)).kind, 'mock');
  for (const name of ['Roster.xlsx', 'Roster.xls', 'Roster.csv', 'Roster.tsv']) assert.throws(() => port.attachMockFile(new File(['fixture'], name)), /LIBRARY_REGISTRATION/);
  const result = await port.registerSpreadsheet({ operationId: 'attach', status: 'Attached', workbook: newEditableWorkbook() });
  assert.equal(result.state, 'confirmed'); assert.equal(port.snapshot().length, 2); assert.equal(other.snapshot().length, 0);
  const book = port.snapshot()[1]; assert.equal(book.kind, 'workbook'); assert.equal((await port.open(book)).kind, 'workbook');
  assert.equal(client.workbookCreate.mock.calls.length, 1); unsubscribe();
});
it('does not add a file or claim a generated result when registration is UNKNOWN', async () => {
  const { port, client } = world(); client.workbookCreate.mockRejectedValue(new Error('response lost'));
  const request = { operationId: 'generated', status: 'Generated' as const, workbook: newEditableWorkbook() };
  assert.equal((await port.registerSpreadsheet(request)).state, 'uncertain'); assert.equal((await port.registerSpreadsheet(request)).state, 'uncertain');
  assert.equal(port.snapshot().length, 0); assert.equal(client.workbookCreate.mock.calls.length, 1);
});
