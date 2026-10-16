import assert from 'node:assert/strict';
import { describe, it, vi } from 'vitest';
import { createSpreadsheetWiringAdapter } from '../../../src/dashboard/state/spreadsheet-wiring-adapter.js';
import { newEditableWorkbook } from '../../../src/dashboard/surfaces/spreadsheets/spreadsheet-editor-model.js';
import { DashboardClientError } from '../../../src/dashboard/client/errors.js';
import type { WorkbookLibraryQueries } from '../../../src/dashboard/client/queries/workbook-library-queries.js';
import { SavedWorkbookSchema, type SavedWorkbook } from '../../../src/models/dashboard/workbooks.js';
const book = () => ({ ...newEditableWorkbook(), libraryId: 'saved' });
const saved = (version = 3, workbook = book()): SavedWorkbook => SavedWorkbookSchema.parse({ libraryId: workbook.libraryId, version, createdAt: '2026-10-01T00:00:00Z', savedAt: '2026-10-15T00:00:00Z', workbook });
function setup() {
  const client = { workbookList: vi.fn(async () => [saved()]), workbookOpen: vi.fn(async () => saved()), workbookCreate: vi.fn(async (workbook: unknown) => saved(1, { ...workbook as ReturnType<typeof book>, libraryId: 'generated' })), workbookSave: vi.fn(async (_id: string, version: number, workbook: unknown) => saved(version + 1, workbook as ReturnType<typeof book>)), workbookHistory: vi.fn(), workbookIntake: vi.fn() } satisfies WorkbookLibraryQueries;
  return { client, adapter: createSpreadsheetWiringAdapter(client) };
}
describe('served workbook authority', () => {
  it('lists actual records, opens by identity, and creates local drafts without a POST', async () => {
    const { client, adapter } = setup(); await adapter.list(); assert.equal(adapter.snapshot().files[0].id, 'saved');
    await adapter.open('saved'); assert.equal(adapter.draft('saved')?.opened?.version, 3); assert.deepEqual(client.workbookOpen.mock.calls, [['saved']]);
    const id = adapter.create(newEditableWorkbook()); assert.equal(adapter.draft(id)?.document.libraryId, undefined); assert(adapter.draft(id)?.dirty); assert.equal(client.workbookCreate.mock.calls.length, 0);
  });
  it('saves with the opened version and confirms only exact open readback', async () => {
    const { client, adapter } = setup(); await adapter.open('saved'); const draft = book(); adapter.change('saved', draft, true);
    client.workbookOpen.mockResolvedValueOnce(saved(4, draft)); const result = await adapter.save('saved', draft);
    assert.equal(result.state, 'confirmed'); assert.deepEqual(client.workbookSave.mock.calls, [['saved', 3, draft]]); assert.equal(client.workbookOpen.mock.calls.length, 2); assert.equal(adapter.draft('saved')?.opened?.version, 4);
  });
  it('retains the opened version and exact draft after a typed conflict', async () => {
    const { client, adapter } = setup(); await adapter.open('saved'); const draft = book(); adapter.change('saved', draft, true);
    client.workbookSave.mockRejectedValue(new DashboardClientError({ kind: 'http', status: 409, code: 'WORKBOOK_VERSION_CONFLICT', message: 'Conflict' }));
    assert.equal((await adapter.save('saved', draft)).state, 'conflict'); assert.equal(adapter.draft('saved')?.document, draft); assert.equal(adapter.draft('saved')?.opened?.version, 3);
  });
  it('keeps one original intent across edited drafts and reads only until matching recovery', async () => {
    const { client, adapter } = setup(); await adapter.open('saved'); const draft = book(); adapter.change('saved', draft, true);
    client.workbookSave.mockRejectedValue(new Error('lost response'));
    assert.equal((await adapter.save('saved', draft)).state, 'uncertain');
    const edited = { ...draft, name: 'Edited.xlsx' }; adapter.change('saved', edited, true);
    assert.equal((await adapter.save('saved', edited)).state, 'uncertain'); assert.equal(client.workbookSave.mock.calls.length, 1);
    client.workbookOpen.mockResolvedValueOnce(saved(4, draft));
    assert.equal((await adapter.save('saved', edited)).state, 'uncertain'); assert.equal(client.workbookSave.mock.calls.length, 1); assert.equal(adapter.draft('saved')?.opened?.version, 4); assert.equal(adapter.draft('saved')?.document, edited);
  });
  it('never adopts a create by matching content after losing its generated identity', async () => {
    const { client, adapter } = setup(); const draft = newEditableWorkbook(); const id = adapter.create(draft);
    client.workbookCreate.mockRejectedValue(new Error('lost response')); client.workbookList.mockResolvedValue([saved(1, { ...draft, libraryId: 'generated' })]);
    assert.equal((await adapter.save(id, draft)).state, 'uncertain'); assert.equal((await adapter.save(id, draft)).state, 'uncertain');
    assert.equal(client.workbookCreate.mock.calls.length, 1); assert.equal(client.workbookList.mock.calls.length, 2); assert.equal(adapter.draft(id)?.document.libraryId, undefined);
  });
  it('adopts only a confirmed generated ID and keeps export from clearing durable dirtiness', async () => {
    const { client, adapter } = setup(); const draft = newEditableWorkbook(); const id = adapter.create(draft);
    client.workbookOpen.mockResolvedValueOnce(saved(1, { ...draft, libraryId: 'generated' }));
    const result = await adapter.save(id, draft); assert.equal(result.state, 'confirmed');
    const adopted = { ...draft, libraryId: 'generated' }; adapter.change(id, adopted, false); assert.equal(adapter.draft(id)?.dirty, false);
    const edited = { ...adopted, name: 'Edited.xlsx' }; adapter.change(id, edited, false); assert.equal(adapter.draft(id)?.dirty, true); assert.equal(adapter.draft('generated'), adapter.draft(id));
  });
  it('retains stale list authority on read failure and ignores superseded lists', async () => {
    const { client, adapter } = setup(); await adapter.list(); client.workbookList.mockRejectedValueOnce(new Error('offline')); await adapter.list(); assert.equal(adapter.snapshot().files.length, 1); assert.equal(adapter.snapshot().error, 'offline');
    let resolve!: (records: SavedWorkbook[]) => void; client.workbookList.mockImplementationOnce(() => new Promise(done => { resolve = done; })); const earlier = adapter.list(); await adapter.list(); resolve([]); await earlier; assert.equal(adapter.snapshot().files.length, 1);
  });
});

it('discards ordinary edits, rereads the current version, and keeps UNKNOWN reservations on close', async () => {
  const { client, adapter } = setup(); await adapter.list(); await adapter.open('saved');
  adapter.change('saved', { ...book(), name: 'Discard.xlsx' }, true); adapter.close('saved'); assert.equal(adapter.draft('saved'), undefined);
  client.workbookOpen.mockResolvedValueOnce(saved(8)); await adapter.open('saved'); assert.equal(adapter.draft('saved')?.opened?.version, 8);
  client.workbookSave.mockRejectedValue(new Error('lost')); await adapter.save('saved', book()); adapter.close('saved'); assert(adapter.draft('saved')?.intent);
  await adapter.open('saved'); await adapter.save('saved', book()); assert.equal(client.workbookSave.mock.calls.length, 1);
});
it('attaches a late generated ID to newer edits without replacing their values', async () => {
  const { client, adapter } = setup(); const original = newEditableWorkbook(), id = adapter.create(original);
  let settle!: (record: SavedWorkbook) => void; client.workbookCreate.mockImplementationOnce(() => new Promise(resolve => { settle = resolve; }));
  const save = adapter.save(id, original); const newer = { ...original, name: 'Newer.xlsx' }; adapter.change(id, newer, true);
  client.workbookOpen.mockResolvedValueOnce(saved(1, { ...original, libraryId: 'generated' })); settle(saved(1, { ...original, libraryId: 'generated' }));
  assert.equal((await save).state, 'uncertain'); assert.equal(adapter.draft(id)?.document.name, 'Newer.xlsx'); assert.equal(adapter.draft(id)?.document.libraryId, 'generated'); assert(adapter.draft(id)?.dirty);
  const next = adapter.draft(id)!.document; client.workbookOpen.mockResolvedValueOnce(saved(2, next as ReturnType<typeof book>)); await adapter.save(id, next); assert.equal(client.workbookSave.mock.calls[0][0], 'generated'); assert.equal(client.workbookSave.mock.calls[0][1], 1);
});
it('keys late open failures to their selection and keeps successful drafts separate', async () => {
  const { client, adapter } = setup(); let reject!: (error: Error) => void;
  client.workbookOpen.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
  const earlier = adapter.open('earlier'); await adapter.open('saved'); reject(new Error('old failure')); await earlier;
  assert.equal(adapter.snapshot().error, ''); assert.equal(adapter.draft('saved')?.document.libraryId, 'saved'); assert.equal(adapter.draft('earlier'), undefined);
});

it('ignores an older same-ID open that settles before the newly selected request', async () => {
  const { client, adapter } = setup();
  let settleOlder!: (record: SavedWorkbook) => void, settleCurrent!: (record: SavedWorkbook) => void;
  client.workbookOpen.mockImplementationOnce(() => new Promise(resolve => { settleOlder = resolve; }))
    .mockResolvedValueOnce(saved(4, { ...book(), libraryId: 'other' }))
    .mockImplementationOnce(() => new Promise(resolve => { settleCurrent = resolve; }));
  const older = adapter.open('saved'); await adapter.open('other'); const current = adapter.open('saved');
  settleOlder(saved(1, { ...book(), name: 'Stale.xlsx' })); await older;
  assert.equal(adapter.draft('saved'), undefined); assert.equal(adapter.snapshot().opening, 'saved');
  settleCurrent(saved(7, { ...book(), name: 'Current.xlsx' })); await current;
  assert.equal(adapter.draft('saved')?.opened?.version, 7); assert.equal(adapter.draft('saved')?.document.name, 'Current.xlsx'); assert.equal(adapter.snapshot().openError, '');
});
it('does not let a superseded success overwrite the current open failure', async () => {
  const { client, adapter } = setup(); let settleOlder!: (record: SavedWorkbook) => void;
  client.workbookOpen.mockImplementationOnce(() => new Promise(resolve => { settleOlder = resolve; }))
    .mockRejectedValueOnce(new Error('current open failed'));
  const older = adapter.open('saved'); await adapter.open('saved'); settleOlder(saved(1)); await older;
  assert.equal(adapter.draft('saved'), undefined); assert.equal(adapter.snapshot().openError, 'current open failed');
});
it('preserves the original UNKNOWN intent and actual readback error without resending', async () => {
  const { client, adapter } = setup(); await adapter.open('saved'); const draft = book(); adapter.change('saved', draft, true);
  client.workbookSave.mockRejectedValue(new Error('response lost')); const readbackError = new Error('readback offline'); client.workbookOpen.mockRejectedValue(readbackError);
  const first = await adapter.save('saved', draft); assert.equal(first.state, 'uncertain'); assert.match(first.reason, /readback offline/);
  const intent = adapter.draft('saved')?.intent; assert(intent); assert.equal(intent.expectedVersion, 3); assert.deepEqual(intent.draft, draft);
  assert.equal((await adapter.save('saved', draft)).state, 'uncertain'); assert.equal(adapter.draft('saved')?.intent, intent); assert.equal(client.workbookSave.mock.calls.length, 1);
});
it('clears a typed refusal as a known result while preserving the local draft and opened version', async () => {
  const { client, adapter } = setup(); await adapter.open('saved'); const draft = book(); adapter.change('saved', draft, true);
  client.workbookSave.mockRejectedValue(new DashboardClientError({ kind: 'http', status: 422, code: 'WORKBOOK_INVALID', message: 'Workbook refused.' }));
  const result = await adapter.save('saved', draft); assert.deepEqual(result, { state: 'refused', reason: 'Workbook refused.' }); assert.equal(adapter.draft('saved')?.intent, undefined); assert.equal(adapter.draft('saved')?.document, draft); assert.equal(adapter.draft('saved')?.opened?.version, 3);
});

it('discards every ordinary draft and prevents late list and open responses from restoring discarded state', async () => {
  const { client, adapter } = setup(); await adapter.list(); await adapter.open('saved');
  adapter.change('saved', { ...book(), name: 'Discard.xlsx' }, true);
  const local = adapter.create(newEditableWorkbook());
  const lateList = Promise.withResolvers<SavedWorkbook[]>(), lateOpen = Promise.withResolvers<SavedWorkbook>();
  client.workbookList.mockImplementationOnce(() => lateList.promise);
  client.workbookOpen.mockImplementationOnce(() => lateOpen.promise);
  const listing = adapter.list(), opening = adapter.open('other');
  adapter.discard();
  assert.equal(adapter.draft('saved'), undefined); assert.equal(adapter.draft(local), undefined);
  assert.deepEqual(adapter.snapshot().files.map(file => file.name), [book().name]);
  assert.equal(adapter.snapshot().loading, false); assert.equal(adapter.snapshot().opening, undefined);
  lateList.resolve([saved(1, { ...book(), name: 'Stale.xlsx' })]);
  lateOpen.resolve(saved(1, { ...book(), libraryId: 'other', name: 'Stale.xlsx' }));
  await Promise.all([listing, opening]);
  assert.equal(adapter.draft('other'), undefined); assert.equal(adapter.draft('saved'), undefined);
  assert.deepEqual(adapter.snapshot().files.map(file => file.name), [book().name]);
  client.workbookOpen.mockResolvedValueOnce(saved(8)); await adapter.open('saved');
  assert.equal(adapter.draft('saved')?.opened?.version, 8);
  assert.equal(client.workbookSave.mock.calls.length, 0); assert.equal(client.workbookCreate.mock.calls.length, 0);
});
it('keeps a pending create and its UNKNOWN intent when discarding other ordinary drafts', async () => {
  const { client, adapter } = setup(); const original = newEditableWorkbook(), id = adapter.create(original);
  const unsent = adapter.create(newEditableWorkbook());
  const response = Promise.withResolvers<SavedWorkbook>();
  client.workbookCreate.mockImplementationOnce(() => response.promise);
  const saving = adapter.save(id, original), intent = adapter.draft(id)?.intent;
  assert(intent); adapter.discard();
  assert.equal(adapter.draft(id)?.intent, intent); assert.equal(adapter.draft(unsent), undefined);
  response.reject(new Error('response lost')); assert.equal((await saving).state, 'uncertain');
  adapter.discard(); assert.equal(adapter.draft(id)?.intent, intent);
  assert.equal((await adapter.save(id, original)).state, 'uncertain');
  assert.equal(adapter.draft(id)?.intent, intent); assert.equal(client.workbookCreate.mock.calls.length, 1);
});
