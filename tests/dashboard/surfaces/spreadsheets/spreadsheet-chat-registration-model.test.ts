import assert from 'node:assert/strict';
import { beforeEach, describe, it, vi } from 'vitest';
import { SavedWorkbookSchema, type SavedWorkbook } from '../../../../src/models/dashboard/workbooks.js';
import { createSpreadsheetWiringAdapter } from '../../../../src/dashboard/state/spreadsheet-wiring-adapter.js';
import { createSpreadsheetChatRegistrationPort } from '../../../../src/dashboard/surfaces/spreadsheets/spreadsheet-chat-registration-model.js';
import { newEditableWorkbook, type EditableWorkbook } from '../../../../src/dashboard/surfaces/spreadsheets/spreadsheet-editor-model.js';
import { exportSheetInWorker } from '../../../../src/dashboard/surfaces/spreadsheets/spreadsheet-import-client.js';
import type { WorkbookLibraryQueries } from '../../../../src/dashboard/client/queries/workbook-library-queries.js';
vi.mock('../../../../src/dashboard/surfaces/spreadsheets/spreadsheet-import-client.js', () => ({ exportSheetInWorker: vi.fn(async () => 'Name,ID\r\nAlex,10000001'), exportSpreadsheetInWorker: vi.fn(async () => new ArrayBuffer(4)) }));
beforeEach(() => vi.clearAllMocks());
function world() {
  const versions: SavedWorkbook[] = [];
  const record = (workbook: unknown, version: number) => SavedWorkbookSchema.parse({ libraryId: 'library-id', version, createdAt: '2026-10-01T00:00:00Z', savedAt: '2026-10-01T00:00:00Z', workbook: { ...workbook as EditableWorkbook, libraryId: 'library-id' } });
  const client = {
    workbookList: vi.fn(async () => versions.length ? [versions.at(-1)!] : []),
    workbookOpen: vi.fn(async () => { const saved = versions.at(-1); if (!saved) throw new Error('not found'); return saved; }),
    workbookCreate: vi.fn(async (workbook: unknown) => { const saved = record(workbook, 1); versions.push(saved); return saved; }),
    workbookSave: vi.fn(async (_id: string, expected: number, workbook: unknown) => { assert.equal(expected, versions.at(-1)?.version); const saved = record(workbook, expected + 1); versions.push(saved); return saved; }),
    workbookHistory: vi.fn(async () => [...versions]), workbookIntake: vi.fn(),
  } satisfies WorkbookLibraryQueries;
  const adapter = createSpreadsheetWiringAdapter(client), port = createSpreadsheetChatRegistrationPort(adapter);
  return { versions, client, adapter, port };
}
describe('chat spreadsheet registration', () => {
  it('registers an attachment once, publishes real version metadata and downloads an exact updated version', async () => {
    const { port, client, adapter, versions } = world();
    const document = { ...newEditableWorkbook(), name: 'Autumn.csv' };
    const request = { operationId: 'attach-1', status: 'Attached' as const, workbook: document };
    const [first, duplicate] = await Promise.all([port.register(request), port.register(request)]);
    assert.deepEqual(first, duplicate); assert.equal(first.state, 'confirmed'); assert.equal(client.workbookCreate.mock.calls.length, 1);
    if (first.state !== 'confirmed') throw new Error('expected confirmation');
    assert.equal(adapter.snapshot().files[0].status, 'Attached'); assert.equal(adapter.draft(first.file.libraryId)?.dirty, false);
    const updated = { ...versions[0].workbook, name: 'Autumn-updated.csv', sheets: versions[0].workbook.sheets.map(sheet => ({ ...sheet, rows: sheet.rows.map((row, index) => index === 1 ? { ...row, cells: row.cells.map((cell, column) => column === 0 ? { ...cell, value: 'Alex' } : cell) } : row) })) };
    const result = await port.register({ operationId: 'update-1', status: 'Updated', workbook: updated, base: { libraryId: first.file.libraryId, version: 1 } });
    assert.equal(result.state, 'confirmed'); assert.equal(client.workbookSave.mock.calls[0][1], 1);
    if (result.state !== 'confirmed') throw new Error('expected update');
    const download = await port.download(result.file); assert.equal(download.name, 'Autumn-updated.csv'); assert.match(await download.blob.text(), /Alex/);
    await port.open(first.file); assert.equal(client.workbookHistory.mock.calls.length, 1);
    assert.equal(vi.mocked(exportSheetInWorker).mock.calls[0][0].rows[1].cells[0].value, 'Alex');
    assert.equal(adapter.snapshot().files[0].version, 2); assert.equal(adapter.snapshot().files[0].status, 'Updated');
  });
  it('never resends an UNKNOWN create and never matches identity by filename/content', async () => {
    const { port, client, versions } = world(); client.workbookCreate.mockRejectedValue(new Error('response lost'));
    const request = { operationId: 'generated-1', status: 'Generated' as const, workbook: newEditableWorkbook() };
    assert.equal((await port.register(request)).state, 'uncertain');
    assert.equal((await port.register(request)).state, 'uncertain'); assert.equal(client.workbookCreate.mock.calls.length, 1); assert.equal(versions.length, 0);
    assert.equal((await port.register({ ...request, workbook: { ...request.workbook, name: 'changed.xlsx' } })).state, 'refused');
    assert.equal(client.workbookCreate.mock.calls.length, 1);
  });
  it('recovers an UNKNOWN update by reading its original version without another save', async () => {
    const { port, client, versions } = world();
    const first = await port.register({ operationId: 'attach', status: 'Attached', workbook: newEditableWorkbook() }); assert.equal(first.state, 'confirmed');
    const request = { operationId: 'update', status: 'Updated' as const, workbook: { ...versions[0].workbook, name: 'Updated.xlsx' }, base: { libraryId: 'library-id', version: 1 } };
    client.workbookOpen.mockRejectedValueOnce(new Error('readback offline'));
    assert.equal((await port.register(request)).state, 'uncertain'); assert.equal((await port.register(request)).state, 'confirmed'); assert.equal(client.workbookSave.mock.calls.length, 1);
  });
  it('never saves intervening edits or repeats a confirmed version when a registration is retried', async () => {
    const { port, client, adapter, versions } = world();
    await port.register({ operationId: 'create', status: 'Attached', workbook: newEditableWorkbook() });
    const workbook = { ...versions[0].workbook, name: 'Updated.xlsx' };
    const request = { operationId: 'update', status: 'Updated' as const, workbook, base: { libraryId: 'library-id', version: 1 } };
    let release!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const save = client.workbookSave.getMockImplementation(); assert(save);
    client.workbookSave.mockImplementationOnce(async (...args) => { await blocked; return save(...args); });
    const saving = port.register(request);
    await vi.waitFor(() => assert.equal(client.workbookSave.mock.calls.length, 1));
    adapter.change('library-id', { ...workbook, name: 'Intervening edit.xlsx' }, true);
    release(); assert.equal((await saving).state, 'uncertain');
    assert.equal((await port.register(request)).state, 'conflict');
    assert.equal(adapter.draft('library-id')?.document.name, 'Intervening edit.xlsx');
    adapter.change('library-id', workbook, false);
    const recovered = await port.register(request); assert.equal(recovered.state, 'confirmed');
    if (recovered.state !== 'confirmed') throw new Error('missing original confirmation');
    assert.equal(recovered.file.version, 2); assert.equal(client.workbookSave.mock.calls.length, 1); assert.equal(versions.length, 2);
  });
  it('refuses missing/stale identities, unsaved drafts and invalid attachment content without a write', async () => {
    const { port, client, adapter, versions } = world();
    assert.equal((await port.register({ operationId: 'missing', status: 'Updated', workbook: newEditableWorkbook() })).state, 'refused');
    await port.register({ operationId: 'create', status: 'Generated', workbook: newEditableWorkbook() });
    const base = { libraryId: 'library-id', version: 1 }, workbook = versions[0].workbook;
    const mismatch = { operationId: 'bad-attach', status: 'Attached' as const, base, workbook: { ...workbook, name: 'Different.xlsx' } };
    assert.equal((await port.register(mismatch)).state, 'refused'); assert.equal((await port.register(mismatch)).state, 'refused');
    adapter.change('library-id', { ...workbook, name: 'Unsent.xlsx' }, true);
    assert.equal((await port.register({ operationId: 'draft', status: 'Updated', base, workbook })).state, 'conflict');
    assert.equal(client.workbookSave.mock.calls.length, 0);
  });
  it('refuses a stale base and an unavailable download version', async () => {
    const { port, versions, client } = world();
    await port.register({ operationId: 'create', status: 'Attached', workbook: newEditableWorkbook() });
    assert.equal((await port.register({ operationId: 'stale', status: 'Updated', base: { libraryId: 'library-id', version: 9 }, workbook: versions[0].workbook })).state, 'conflict');
    await assert.rejects(port.open({ libraryId: 'library-id', version: 9, name: 'Untitled.xlsx', status: 'Updated' }), /VERSION_UNAVAILABLE/);
    assert.equal(client.workbookSave.mock.calls.length, 0);
  });
});
