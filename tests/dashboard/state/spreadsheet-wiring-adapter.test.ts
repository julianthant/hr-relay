import { WorkbookLibraryEntrySchema, WorkbookCompatibilitySchema, projectWorkbookCompatibility } from '../../../src/models/dashboard/workbook-library.js';
import { ERROR_CATALOG } from "../../../src/models/failures/error-catalog.js";
import assert from 'node:assert/strict';
import { describe, it, vi } from 'vitest';
import { createSpreadsheetWiringAdapter } from '../../../src/dashboard/state/spreadsheet-wiring-adapter.js';
import { newEditableWorkbook, spreadsheetValuesOnly } from '../../../src/dashboard/surfaces/spreadsheets/spreadsheet-editor-model.js';
import { closeDraft, editMapping, importWorkbook } from '../../../src/dashboard/surfaces/spreadsheets/design/sheets-v2-writes.js';
import { datasetOf } from '../../../src/dashboard/surfaces/spreadsheets/design/sheets-v2-model.js';
import { DashboardClientError } from '../../../src/dashboard/client/errors.js';
import type { WorkbookLibraryQueries } from '../../../src/dashboard/client/queries/workbook-library-queries.js';
import { SavedWorkbookSchema, encodeEditableWorkbook, type SavedWorkbook } from '../../../src/models/dashboard/workbooks.js';
const book = () => ({ ...newEditableWorkbook(), libraryId: 'saved' });
const saved = (version = 3, workbook = book()): SavedWorkbook => SavedWorkbookSchema.parse({ libraryId: workbook.libraryId, version, createdAt: '2026-10-01T00:00:00Z', savedAt: '2026-10-15T00:00:00Z', workbook });
function setup() {
  const client = {
    workbookResults: vi.fn<WorkbookLibraryQueries['workbookResults']>(async () => { throw new Error('Unexpected workbookResults call'); }),
    workbookImport: vi.fn<WorkbookLibraryQueries['workbookImport']>(async () => { throw new Error('Unexpected workbookImport call'); }),
    workbookCompatibility: vi.fn<WorkbookLibraryQueries['workbookCompatibility']>(async () => WorkbookCompatibilitySchema.parse({ workflows: [], libraries: [
      { libraryId: 'saved', versionId: 'original', sheets: [{ sheetId: 'sheet', sheetName: 'People', mappings: [], workflows: [] }] },
    ] })),
    workbookList: vi.fn(async () => [saved()]), workbookOpen: vi.fn(async () => saved()), workbookCreate: vi.fn(async (workbook: unknown) => saved(1, { ...workbook as ReturnType<typeof book>, libraryId: 'generated' })), workbookSave: vi.fn(async (_id: string, version: number, workbook: unknown) => saved(version + 1, workbook as ReturnType<typeof book>)), workbookRevision: vi.fn(), workbookHistory: vi.fn(), workbookIntake: vi.fn(), workbookCatalog: vi.fn<WorkbookLibraryQueries['workbookCatalog']>(), workbookTypes: vi.fn<WorkbookLibraryQueries['workbookTypes']>(), workbookPutType: vi.fn<WorkbookLibraryQueries['workbookPutType']>(), workbookLibraryVersion: vi.fn<WorkbookLibraryQueries['workbookLibraryVersion']>(), workbookLibraryAction: vi.fn<WorkbookLibraryQueries['workbookLibraryAction']>(), workbookLibraryActionStatus: vi.fn<WorkbookLibraryQueries['workbookLibraryActionStatus']>() } satisfies WorkbookLibraryQueries;
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
    const result = await adapter.save(id, draft); assert.equal(result.state, 'confirmed'); assert.equal(adapter.draft(id)?.dirty, false);
    const adopted = { ...draft, libraryId: 'generated' }; adapter.change(id, adopted, false); assert.equal(adapter.draft(id)?.dirty, false);
    const edited = { ...adopted, name: 'Edited.xlsx' }; adapter.change(id, edited, false); assert.equal(adapter.draft(id)?.dirty, true); assert.equal(adapter.draft('generated'), adapter.draft(id));
  });
  it('retains stale list authority on read failure and ignores superseded lists', async () => {
    const { client, adapter } = setup(); await adapter.list(); client.workbookList.mockRejectedValueOnce(new Error('offline')); await adapter.list(); assert.equal(adapter.snapshot().files.length, 1); assert.equal(adapter.snapshot().error, ERROR_CATALOG.DASHBOARD_READ_FAILED.text);
    let resolve!: (records: SavedWorkbook[]) => void; client.workbookList.mockImplementationOnce(() => new Promise(done => { resolve = done; })); const earlier = adapter.list(); const shared = adapter.list(); assert.equal(earlier, shared); adapter.discard(); await adapter.list(); resolve([]); await earlier; assert.equal(adapter.snapshot().files.length, 1);
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
  assert.equal(adapter.draft('saved'), undefined); assert.equal(adapter.snapshot().openError, ERROR_CATALOG.DASHBOARD_READ_FAILED.text);
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

it('retains the exact loaded library during a shared pending revisit and ends rejection in catalog failure', async () => {
  const { client, adapter } = setup(); await adapter.list();
  const files = adapter.snapshot().files;
  const pending = Promise.withResolvers<SavedWorkbook[]>(); client.workbookList.mockImplementationOnce(() => pending.promise);
  const first = adapter.list(), second = adapter.list(); assert.equal(first, second);
  assert.equal(client.workbookList.mock.calls.length, 2); assert.equal(adapter.snapshot().files, files); assert.equal(adapter.snapshot().loading, false);
  pending.reject(new Error('synthetic offline')); await first;
  assert.equal(adapter.snapshot().files, files); assert.equal(adapter.snapshot().error, ERROR_CATALOG.DASHBOARD_READ_FAILED.text);
});

for (const operation of ['save', 'create'] as const) it(`keeps the exact UNKNOWN ${operation} reservation across read-authority replacement and refresh without redispatch`, async () => {
  const { client, adapter } = setup();
  const document = operation === 'save' ? book() : newEditableWorkbook();
  let key: string;
  if (operation === 'save') { await adapter.open('saved'); key = 'saved'; client.workbookSave.mockRejectedValue(new Error('lost save reply')); }
  else { key = adapter.create(document); client.workbookCreate.mockRejectedValue(new Error('lost create reply')); }
  assert.equal((await adapter.save(key, document)).state, 'uncertain');
  const draft = adapter.draft(key), intent = draft?.intent; assert.ok(draft); assert.ok(intent);
  const writes = client.workbookSave.mock.calls.length + client.workbookCreate.mock.calls.length;
  adapter.setReadAuthority({}); assert.equal(adapter.snapshot().files.length, 0); assert.equal(adapter.draft(key), draft); assert.equal(adapter.draft(key)?.intent, intent);
  await adapter.list(); assert.equal(adapter.draft(key), draft); assert.equal(adapter.draft(key)?.intent, intent);
  assert.equal((await adapter.save(key, document)).state, 'uncertain');
  assert.equal(client.workbookSave.mock.calls.length + client.workbookCreate.mock.calls.length, writes);
  assert.equal(adapter.draft(key)?.intent, intent);
});
it('blocks a new save after read-authority replacement until current library data is read', async () => {
  const { client, adapter } = setup(); await adapter.open('saved');
  adapter.setReadAuthority({}); assert.equal((await adapter.save('saved', book())).state, 'refused'); assert.equal(client.workbookSave.mock.calls.length, 0);
  await adapter.list(); client.workbookOpen.mockResolvedValueOnce(saved(4)); assert.equal((await adapter.save('saved', book())).state, 'confirmed'); assert.equal(client.workbookSave.mock.calls.length, 1);
});

describe('named library actions', () => {
  it('refreshes compatibility with catalog and disables stale eligibility after a failed read', async () => {
    const { client, adapter } = setup(), file = entry();
    client.workbookCatalog.mockResolvedValue([file]); client.workbookTypes.mockResolvedValue([file.type]);
    await adapter.refreshCatalog();
    assert.equal(client.workbookCompatibility.mock.calls.length, 1);
    assert.equal(adapter.snapshot().compatibility?.workflows.length, 0);
    client.workbookCompatibility.mockRejectedValueOnce(new Error('offline'));
    await adapter.refreshCatalog();
    assert.equal(adapter.snapshot().compatibility, undefined);
    assert.equal(adapter.snapshot().catalogError, ERROR_CATALOG.DASHBOARD_READ_FAILED.text);
  });
  it('replaces Run eligibility after a workbook mapping change without replacing the adapter', async () => {
    const { client, adapter } = setup(), file = entry();
    const workflow = { id: 'onboarding', label: 'Onboarding', requiredWorkbookFields: ['eid'],
      workbookReference: { id: 'roster', keyFieldId: 'eid', mode: 'keys' as const, writableFields: [] } };
    const projection = (fieldId: string | undefined) => projectWorkbookCompatibility([workflow], [{ libraryId: file.libraryId,
      versionId: file.state.selectedVersionId, origin: { kind: 'local' }, removed: false,
      sheets: [{ id: 'sheet', name: 'People', mappings: fieldId === undefined ? [] : [{ fieldId, column: 0, basis: 'manual' as const }] }] }]);
    client.workbookCatalog.mockResolvedValue([file]);
    client.workbookCompatibility.mockResolvedValueOnce(projection(undefined)).mockResolvedValueOnce(projection('eid')).mockResolvedValueOnce(projection(undefined));
    await adapter.refreshCatalog(); assert.deepEqual(adapter.snapshot().compatibility?.workflows[0].sources, []);
    await adapter.refreshCatalog(); assert.equal(adapter.snapshot().compatibility?.workflows[0].sources[0].sheetId, 'sheet');
    await adapter.refreshCatalog(); assert.deepEqual(adapter.snapshot().compatibility?.workflows[0].sources, []);
  });
  it('keeps verified Run compatibility when the independent type editor read fails', async () => {
    const { client, adapter } = setup(), file = entry();
    client.workbookCatalog.mockResolvedValue([file]); client.workbookTypes.mockRejectedValue(new Error('types offline'));
    await adapter.refreshCatalog();
    assert.equal(adapter.snapshot().compatibility?.libraries[0].libraryId, 'saved');
    assert.equal(adapter.snapshot().catalogError, '');
    assert.equal(adapter.snapshot().typesError, ERROR_CATALOG.DASHBOARD_READ_FAILED.text);
    client.workbookTypes.mockResolvedValue([file.type]);
    assert.equal((await adapter.saveType(file.type)).state, 'confirmed');
    assert.equal(adapter.snapshot().typesError, '');
  });
  const entry = () => WorkbookLibraryEntrySchema.parse({ libraryId: 'saved', version: 3, name: 'Roster.xlsx', updatedAt: '2026-11-01T00:00:00Z', rowCount: 0,
    worksheets: [{ id: 'sheet', name: 'People' }], metadata: { typeId: 'roster', sharePoint: null },
    type: { id: 'roster', name: 'Roster', fields: ['eid'], keyFieldId: 'eid', defaultWorkbookId: null },
    state: { libraryId: 'saved', revision: 1, selectedVersionId: 'original', removed: false, pinned: false, tags: [], origin: { kind: 'local' },
      versions: [{ id: 'original', name: 'Original', snapshotId: 'original', version: 3, savedAt: '2026-11-01T00:00:00Z', source: 'import' }] } });
  it('saves a dirty values-only draft once and confirms only its exact named snapshot after response loss', async () => {
    const { client, adapter } = setup(), file = entry(), document = spreadsheetValuesOnly(book());
    client.workbookCatalog.mockResolvedValue([file]); client.workbookTypes.mockResolvedValue([file.type]);
    await adapter.list(); await adapter.refreshCatalog(); await adapter.open('saved'); adapter.change('saved', document, true);
    client.workbookLibraryAction.mockRejectedValue(new Error('lost response')); client.workbookLibraryActionStatus.mockResolvedValue({ state: 'absent' });
    assert.equal((await adapter.saveValuesVersion('saved', 'Edited values', document)).state, 'uncertain');
    assert.equal((await adapter.saveValuesVersion('saved', 'Other name', document)).state, 'refused');
    assert.equal((await adapter.saveValuesVersion('saved', 'Edited values', document)).state, 'uncertain');
    const action = client.workbookLibraryAction.mock.calls[0][1];
    assert.deepEqual(action.change, { kind: 'create-version', name: 'Edited values', from: { kind: 'values', workbook: encodeEditableWorkbook(document) }, useNow: false });
    const version = { ...file.state.versions[0], id: action.operationId, snapshotId: action.operationId, name: 'Edited values' };
    const result = { ...file.state, revision: 2, versions: [...file.state.versions, version] };
    client.workbookCatalog.mockResolvedValue([{ ...file, state: result }]);
    client.workbookLibraryActionStatus.mockResolvedValue({ state: 'recorded', record: { libraryId: 'saved', action, at: version.savedAt, result } });
    client.workbookLibraryVersion.mockResolvedValue({ libraryId: 'saved', version, workbook: encodeEditableWorkbook({ ...document, name: 'Wrong.xlsx' }) });
    assert.equal((await adapter.saveValuesVersion('saved', 'Edited values', document)).state, 'uncertain');
    client.workbookLibraryVersion.mockResolvedValue({ libraryId: 'saved', version, workbook: encodeEditableWorkbook(document) });
    assert.equal((await adapter.saveValuesVersion('saved', 'Edited values', document)).state, 'confirmed');
    assert.equal(client.workbookLibraryAction.mock.calls.length, 1); assert.equal(client.workbookSave.mock.calls.length, 0);
    assert.equal(adapter.draft('saved')?.document, document); assert(adapter.draft('saved')?.dirty);
    assert.equal(adapter.snapshot().catalog[0].state.selectedVersionId, 'original');
  });
  it('keeps a retired action unavailable without posting it again', async () => {
    const { client, adapter } = setup(), file = entry();
    client.workbookCatalog.mockResolvedValue([file]); client.workbookTypes.mockResolvedValue([file.type]);
    client.workbookLibraryAction.mockRejectedValue(new Error('lost response'));
    client.workbookLibraryActionStatus.mockResolvedValue({ state: 'retired', code: 'WORKBOOK_ACTION_RETIRED', message: 'This library action has been retired. Its retained evidence is unavailable here.' });
    await adapter.refreshCatalog();
    const result = await adapter.changeLibrary(file, { kind: 'remove' });
    assert.equal(result.state, 'refused');
    assert.equal((await adapter.settleLibrary(file.libraryId)).state, 'refused');
    assert.equal(client.workbookLibraryAction.mock.calls.length, 1);
    assert.deepEqual(adapter.snapshot().pendingLibraries, [file.libraryId]);
  });
  it('ignores superseded catalogue reads and refuses changes based on stale authority', async () => {
    const { client, adapter } = setup(), file = entry();
    client.workbookTypes.mockResolvedValue([file.type]);
    let finish!: (files: readonly ReturnType<typeof entry>[]) => void;
    client.workbookCatalog.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const earlier = adapter.refreshCatalog();
    client.workbookCatalog.mockResolvedValue([{ ...file, state: { ...file.state, revision: 2 } }]);
    await adapter.refreshCatalog(); finish([file]); await earlier;
    assert.equal(adapter.snapshot().catalog[0].state.revision, 2);
    assert.equal((await adapter.changeLibrary(file, { kind: 'remove' })).state, 'refused');
    assert.equal(client.workbookLibraryAction.mock.calls.length, 0);
    client.workbookCatalog.mockRejectedValue(new Error('offline')); await adapter.refreshCatalog();
    assert.equal(adapter.snapshot().catalog.length, 1); assert(adapter.snapshot().catalogError);
  });
  it('rechecks an uncertain type save without posting or accepting a different type', async () => {
    const { client, adapter } = setup(), type = entry().type;
    client.workbookPutType.mockRejectedValue(new Error('lost response')); client.workbookTypes.mockResolvedValue([]);
    assert.equal((await adapter.saveType(type)).state, 'uncertain');
    assert.equal((await adapter.saveType({ ...type, name: 'Edited' })).state, 'refused');
    client.workbookTypes.mockResolvedValue([type]); assert.equal((await adapter.saveType(type)).state, 'confirmed');
    assert.equal(client.workbookPutType.mock.calls.length, 1);
  });
});

describe('spreadsheet page writes', () => {
  it('resumes an uncertain import instead of creating a second workbook, even for an edited document', async () => {
    const { client, adapter } = setup(); const first = newEditableWorkbook(), edited = { ...first, name: 'Renamed.xlsx' };
    client.workbookOpen.mockRejectedValueOnce(new Error('lost'));
    assert.equal((await importWorkbook(adapter, first)).state, 'pending');
    client.workbookOpen.mockResolvedValueOnce(saved(1, { ...first, libraryId: 'generated' }));
    assert.equal((await importWorkbook(adapter, edited)).state, 'added');
    assert.equal(client.workbookCreate.mock.calls.length, 1);
  });
  it('joins an import that is still saving instead of creating again', async () => {
    const { client, adapter } = setup(); const document = newEditableWorkbook();
    let release!: (record: SavedWorkbook) => void; client.workbookCreate.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const first = importWorkbook(adapter, document), second = importWorkbook(adapter, { ...document, name: 'Again.xlsx' });
    client.workbookOpen.mockResolvedValue(saved(1, { ...document, libraryId: 'generated' })); release(saved(1, { ...document, libraryId: 'generated' }));
    assert.deepEqual((await Promise.all([first, second])).map(outcome => outcome.state), ['added', 'added']);
    assert.equal(client.workbookCreate.mock.calls.length, 1);
  });
  it('sends an edit made while an earlier save is still in flight', async () => {
    const { client, adapter } = setup(); await adapter.list(); await adapter.open('saved');
    const sheet = adapter.draft('saved')!.document.sheets[0], headers = datasetOf(sheet).headers;
    let store = saved(3), release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    client.workbookSave.mockImplementationOnce(async (_id: string, version: number, workbook: unknown) => { await gate; return (store = saved(version + 1, workbook as ReturnType<typeof book>)); });
    client.workbookSave.mockImplementation(async (_id: string, version: number, workbook: unknown) => (store = saved(version + 1, workbook as ReturnType<typeof book>)));
    client.workbookOpen.mockImplementation(async () => store);
    const a = editMapping(adapter, 'saved', sheet.id, { eid: headers[0] });
    await vi.waitFor(() => assert.equal(client.workbookSave.mock.calls.length, 1));
    const b = editMapping(adapter, 'saved', sheet.id, { fullName: headers[1] });
    release(); await Promise.all([a, b]);
    assert.equal(client.workbookSave.mock.calls.length, 2);
    const bound = store.workbook.sheets[0].columnBindings?.map(binding => binding.fieldId); assert(bound?.includes('eid') && bound.includes('fullName'));
    assert.equal(adapter.draft('saved')?.dirty, false);
  });
  it('saves both of two quick mapping edits and never closes a draft with unsaved edits', async () => {
    const { client, adapter } = setup(); await adapter.list(); await adapter.open('saved');
    const sheet = adapter.draft('saved')!.document.sheets[0], headers = datasetOf(sheet).headers;
    let store = saved(3), failNext = true;
    client.workbookSave.mockImplementation(async (_id: string, version: number, workbook: unknown) => (store = saved(version + 1, workbook as ReturnType<typeof book>)));
    client.workbookOpen.mockImplementation(async () => { if (failNext) { failNext = false; throw new Error('lost'); } return store; });
    const a = editMapping(adapter, 'saved', sheet.id, { eid: headers[0] }), b = editMapping(adapter, 'saved', sheet.id, { fullName: headers[1] });
    await Promise.all([a, b]);
    assert(client.workbookSave.mock.calls.length >= 1);
    assert.equal(adapter.draft('saved')?.dirty, false);
    const bound = store.workbook.sheets[0].columnBindings?.map(binding => binding.fieldId); assert(bound?.includes('eid') && bound.includes('fullName'));
    assert.equal(await closeDraft(adapter, 'saved', false), true);
  });
  it('keeps a draft whose save was refused until the operator discards it', async () => {
    const { client, adapter } = setup(); await adapter.list(); await adapter.open('saved');
    const sheet = adapter.draft('saved')!.document.sheets[0], headers = datasetOf(sheet).headers;
    client.workbookSave.mockRejectedValue(new DashboardClientError({ kind: 'http', status: 409, code: 'WORKBOOK_VERSION_CONFLICT', message: 'Conflict' }));
    const { result } = await editMapping(adapter, 'saved', sheet.id, { eid: headers[0] });
    assert.notEqual(result?.state, 'confirmed'); assert.equal(client.workbookSave.mock.calls.length, 1);
    assert.equal(await closeDraft(adapter, 'saved', false), false);
    assert.equal(await closeDraft(adapter, 'saved', true), true);
    assert.equal(adapter.draft('saved'), undefined);
  });
});
