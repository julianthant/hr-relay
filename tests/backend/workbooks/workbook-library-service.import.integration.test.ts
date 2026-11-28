import { DatabaseSync } from 'node:sqlite';
import { afterEach, expect, it } from 'vitest';
import { createWorkbookLibraryRepository, WORKBOOK_LIBRARY_MIGRATION, WORKBOOK_MASTER_MIGRATION, WORKBOOK_LIBRARY_CATALOG_MIGRATION, WORKBOOK_PAYLOAD_TABLE, WORKBOOK_LIBRARY_SYNC_STATUS_MIGRATION } from '../../../src/backend/storage/sqlite/workbook-library-repository.js';
import { createWorkbookLibraryService, type WorkbookLibraryRepository, type WorkbookSyncDownload } from '../../../src/backend/workbooks/workbook-library-service.js';
import { encodeEditableWorkbook } from '../../../src/models/dashboard/workbooks.js';
import { WorkbookLibraryError } from '../../../src/backend/workbooks/workbook-library-error.js';
import { manualClock } from '../../../src/rules/time/clock.js';
import { unexpectedWorkbookSync } from '../../support/helpers/backend/workbook-sync.js';

const databases: DatabaseSync[] = [];
afterEach(() => databases.splice(0).forEach(database => database.close()));
const at = '2026-11-02T00:00:00.000Z';
const url = 'https://example.sharepoint.com/sites/hr/Roster.csv';
const signal = () => new AbortController().signal;
const workbook = () => ({ name: 'Roster.xlsx', themes: ['original theme'], hasFormulas: false,
  sheets: [{ id: 'people', name: 'People', hidden: [1], width: 2, headerRow: 1,
    rows: [{ id: 'header', cells: [{ value: 'Label' }, { value: 'Date' }] },
      { id: 'row', cells: [{ value: 'Original', numFmt: '@' }, { value: new Date(at) }] }] }] });

function fixture(sync: WorkbookSyncDownload = unexpectedWorkbookSync, wrap = (repository: WorkbookLibraryRepository) => repository) {
  const database = new DatabaseSync(':memory:'); databases.push(database);
  for (const sql of [...WORKBOOK_LIBRARY_MIGRATION.statements, ...WORKBOOK_MASTER_MIGRATION.statements, ...WORKBOOK_LIBRARY_CATALOG_MIGRATION.statements, ...WORKBOOK_LIBRARY_SYNC_STATUS_MIGRATION.statements, ...WORKBOOK_PAYLOAD_TABLE.statements]) database.exec(sql);
  database.exec("CREATE TABLE runs (id TEXT PRIMARY KEY,state TEXT NOT NULL,lifecycle_json TEXT NOT NULL); CREATE TABLE run_requests (id TEXT PRIMARY KEY,payload_json TEXT NOT NULL)");
  let depth = 0;
  // Nested work runs in a savepoint, as authority writes do.
  const transaction = <T>(work: () => T) => {
    const savepoint = `nested_${String(depth)}`, outer = depth === 0;
    database.exec(outer ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${savepoint}`);
    depth++;
    try { const result = work(); database.exec(outer ? 'COMMIT' : `RELEASE ${savepoint}`); return result; }
    catch (error) { database.exec(outer ? 'ROLLBACK' : `ROLLBACK TO ${savepoint}; RELEASE ${savepoint}`); throw error; }
    finally { depth--; }
  };
  const repository = wrap(createWorkbookLibraryRepository({ database, read: transaction, mutate: work => transaction(() => work().result) }));
  return createWorkbookLibraryService({ repository, sync, clock: manualClock(new Date(at)) });
}

it('clones the selected current version exactly under a new name without copying its link or pin', async () => {
  const service = fixture(), original = service.create(workbook()), id = original.libraryId;
  const apply = (change: unknown, operationId: string) => service.libraryAction(id, { operationId,
    expectedVersion: service.read(id).version, expectedRevision: service.catalog()[0].state.revision, change }, signal());
  await apply({ kind: 'pin' }, 'pin');
  await apply({ kind: 'link', url }, 'link');
  const edited = structuredClone(service.read(id).workbook);
  edited.sheets[0].rows[1].cells[0].value = 'Current';
  service.save(id, service.read(id).version, edited);
  const source = service.read(id), before = service.catalog();
  const clone = service.cloneWorkbook(id, { name: 'Copy.xlsx', tags: ['Fall'] });
  expect(clone.workbook.libraryId).not.toBe(id);
  expect(clone.workbook.version).toBe(1);
  expect(clone.workbook.workbook).toEqual({ ...encodeEditableWorkbook(source.workbook), libraryId: clone.workbook.libraryId, name: 'Copy.xlsx' });
  expect(service.catalog()).toHaveLength(2);
  expect(service.catalog().find(entry => entry.libraryId === clone.workbook.libraryId)).toMatchObject({
    name: 'Copy.xlsx', metadata: { sharePoint: null }, state: { pinned: false, tags: ['Fall'], origin: { kind: 'local' } },
  });
  expect(service.read(id)).toEqual(source);
  expect(service.catalog().find(entry => entry.libraryId === id)).toEqual(before[0]);
  expect(service.libraryVersion(clone.workbook.libraryId).workbook).toEqual(clone.workbook.workbook);
});

it('refuses an existing clone name with a plain sentence and leaves both source and library unchanged', () => {
  const service = fixture(), original = service.create(workbook()), before = service.catalog();
  expect(() => service.cloneWorkbook(original.libraryId, { name: ' roster.XLSX ' })).toThrow(
    'A spreadsheet with this name already exists. Choose a different name.');
  expect(service.catalog()).toEqual(before);
  expect(service.read(original.libraryId)).toEqual(original);
});

it('reports a missing clone source without creating a spreadsheet', () => {
  const service = fixture();
  expect(() => service.cloneWorkbook('missing', { name: 'Copy.xlsx' })).toThrow(expect.objectContaining({ code: 'WORKBOOK_NOT_FOUND' }));
  expect(service.catalog()).toEqual([]);
});

it('imports SharePoint once as one linked spreadsheet with a synced version and given tags', async () => {
  let downloads = 0;
  const service = fixture({ async withDownload(command, use) {
    downloads++;
    expect(service.catalog()).toEqual([]);
    expect(command.link).toEqual({ url, verifiedAt: at });
    return use({ name: 'Roster.csv', bytes: new TextEncoder().encode('Label,Notes\nRemote,Ready\n').buffer },
      { signal: command.signal, assertCurrent: () => command.signal.throwIfAborted() });
  } });
  const imported = await service.importSharePoint({ source: 'sharepoint', url, name: 'Fall roster', tags: ['Fall', 'Payroll'] }, signal());
  expect(downloads).toBe(1);
  expect(service.catalog()).toHaveLength(1);
  const entry = service.catalog()[0];
  expect(entry).toMatchObject({ libraryId: imported.workbook.libraryId, name: 'Fall roster',
    metadata: { sharePoint: { url, verifiedAt: at } }, state: { pinned: false, tags: ['Fall', 'Payroll'], origin: { kind: 'local' } } });
  expect(entry.state.versions.filter(version => version.source === 'sharepoint')).toHaveLength(1);
  expect(service.libraryVersion(entry.libraryId).version.source).toBe('sharepoint');
  expect(service.read(entry.libraryId).workbook.sheets[0].rows[1].cells.map(cell => cell.value)).toEqual(['Remote', 'Ready']);
  expect(service.read(entry.libraryId).version).toBe(imported.workbook.version);
});

it.each(['download', 'parse', 'abort', 'revoked'] as const)('creates nothing when a SharePoint import fails during %s', async failure => {
  const controller = new AbortController();
  const service = fixture({ async withDownload(command, use) {
    if (failure === 'download') throw new WorkbookLibraryError('WORKBOOK_SYNC_CONTEXT_CHANGED');
    if (failure === 'abort') controller.abort();
    return use({ name: failure === 'parse' ? 'Unreadable.xlsx' : 'Roster.csv',
      bytes: failure === 'parse' ? new ArrayBuffer(1) : new TextEncoder().encode('Label\nRemote\n').buffer },
    { signal: command.signal, assertCurrent() {
      command.signal.throwIfAborted();
      if (failure === 'revoked') throw new WorkbookLibraryError('WORKBOOK_SYNC_CONTEXT_CHANGED');
    } });
  } });
  const original = service.create(workbook()), before = service.catalog();
  const imported = service.importSharePoint({ source: 'sharepoint', url, name: 'Remote' }, controller.signal);
  if (failure === 'parse') await expect(imported).rejects.toMatchObject({ code: 'WORKBOOK_SYNC_IMPORT_FAILED',
    message: 'The downloaded file is not a supported workbook.' });
  else await expect(imported).rejects.toThrow();
  expect(service.catalog()).toEqual(before);
  expect(service.list()).toEqual([original]);
});

it('leaves no spreadsheet when a write after the workbook row fails, so the same name imports on retry', async () => {
  let failSync = true;
  const download: WorkbookSyncDownload = { async withDownload(command, use) {
    return use({ name: 'Roster.csv', bytes: new TextEncoder().encode('Label\nRemote\n').buffer },
      { signal: command.signal, assertCurrent: () => command.signal.throwIfAborted() });
  } };
  const service = fixture(download, repository => ({ ...repository, recordSync(libraryId, record) {
    if (failSync) { failSync = false; throw new WorkbookLibraryError('WORKBOOK_STORAGE_FAILED'); }
    repository.recordSync(libraryId, record);
  } }));
  await expect(service.importSharePoint({ source: 'sharepoint', url, name: 'Remote', tags: ['Fall'] }, signal()))
    .rejects.toMatchObject({ code: 'WORKBOOK_STORAGE_FAILED' });
  expect(service.catalog()).toEqual([]);
  expect(service.list()).toEqual([]);
  const imported = await service.importSharePoint({ source: 'sharepoint', url, name: 'Remote', tags: ['Fall'] }, signal());
  expect(service.catalog()).toHaveLength(1);
  expect(service.catalog()[0]).toMatchObject({ libraryId: imported.workbook.libraryId, name: 'Remote',
    metadata: { sharePoint: { url } }, state: { tags: ['Fall'] }, sync: { lastResult: 'ok' } });
});

it('commits nothing when the provider rejects after the import callback returns, so the same name imports on retry', async () => {
  let failAfterUse = true;
  const service = fixture({ async withDownload(command, use) {
    const value = await use({ name: 'Roster.csv', bytes: new TextEncoder().encode('Label\nRemote\n').buffer },
      { signal: command.signal, assertCurrent: () => command.signal.throwIfAborted() });
    if (failAfterUse) { failAfterUse = false; throw new WorkbookLibraryError('WORKBOOK_SYNC_CONTEXT_CHANGED'); }
    return value;
  } });
  await expect(service.importSharePoint({ source: 'sharepoint', url, name: 'Remote' }, signal()))
    .rejects.toMatchObject({ code: 'WORKBOOK_SYNC_CONTEXT_CHANGED' });
  expect(service.catalog()).toEqual([]);
  expect(service.list()).toEqual([]);
  await service.importSharePoint({ source: 'sharepoint', url, name: 'Remote' }, signal());
  expect(service.catalog().map(entry => entry.name)).toEqual(['Remote']);
});

it('refuses the import write when the provider context changes after the download settles', async () => {
  let current = true;
  const service = fixture({ async withDownload(command, use) {
    const value = await use({ name: 'Roster.csv', bytes: new TextEncoder().encode('Label\nRemote\n').buffer },
      { signal: command.signal, assertCurrent() { if (!current) throw new WorkbookLibraryError('WORKBOOK_SYNC_CONTEXT_CHANGED'); } });
    current = false;
    return value;
  } });
  await expect(service.importSharePoint({ source: 'sharepoint', url, name: 'Remote' }, signal()))
    .rejects.toMatchObject({ code: 'WORKBOOK_SYNC_CONTEXT_CHANGED' });
  expect(service.catalog()).toEqual([]);
});

it('rechecks the import name after downloading so a concurrent create cannot duplicate it', async () => {
  const service = fixture({ async withDownload(command, use) {
    service.create({ ...workbook(), name: 'Remote' });
    return use({ name: 'Roster.csv', bytes: new TextEncoder().encode('Label\nRemote\n').buffer },
      { signal: command.signal, assertCurrent: () => command.signal.throwIfAborted() });
  } });
  await expect(service.importSharePoint({ source: 'sharepoint', url, name: 'Remote' }, signal()))
    .rejects.toMatchObject({ code: 'WORKBOOK_NAME_EXISTS' });
  expect(service.catalog()).toHaveLength(1);
  expect(service.catalog()[0].metadata.sharePoint).toBeNull();
});

it('refuses invalid SharePoint input and an existing name before downloading', async () => {
  const service = fixture(), original = service.create(workbook());
  for (const change of [{ url: 'https://example.com/Roster.csv' }, { name: ' ' }, { tags: ['Repeat', 'repeat'] }]) {
    await expect(service.importSharePoint({ source: 'sharepoint', url, name: 'Remote', ...change }, signal()))
      .rejects.toMatchObject({ code: 'WORKBOOK_INVALID' });
  }
  await expect(service.importSharePoint({ source: 'sharepoint', url, name: 'Roster.xlsx' }, signal()))
    .rejects.toMatchObject({ code: 'WORKBOOK_NAME_EXISTS' });
  expect(service.list()).toEqual([original]);
});

it('keeps the existing local import and its exact data while accepting optional tags', () => {
  const service = fixture(), wire = encodeEditableWorkbook(workbook());
  const local = service.importWorkbook({ workbook: wire });
  const tagged = service.importWorkbook({ workbook: wire, tags: ['Fall'] });
  expect(service.catalog()).toHaveLength(2);
  for (const result of [local, tagged]) {
    expect(result.workbook.version).toBe(1);
    expect(result.workbook.workbook).toEqual({ ...wire, libraryId: result.workbook.libraryId });
    expect(service.metadata(result.workbook.libraryId).sharePoint).toBeNull();
  }
  expect(service.catalog().find(entry => entry.libraryId === local.workbook.libraryId)?.state.tags).toEqual([]);
  expect(service.catalog().find(entry => entry.libraryId === tagged.workbook.libraryId)?.state.tags).toEqual(['Fall']);
});
