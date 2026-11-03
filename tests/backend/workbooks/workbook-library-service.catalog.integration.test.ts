import { DatabaseSync } from 'node:sqlite';
import { afterEach, expect, it } from 'vitest';
import { createWorkbookLibraryRepository, WORKBOOK_LIBRARY_MIGRATION, WORKBOOK_MASTER_MIGRATION, WORKBOOK_LIBRARY_CATALOG_MIGRATION, validateWorkbookLibrary } from '../../../src/backend/storage/sqlite/workbook-library-repository.js';
import { createWorkbookLibraryService } from '../../../src/backend/workbooks/workbook-library-service.js';
import { WorkbookLibraryChangeSchema } from '../../../src/models/dashboard/workbook-library.js';
import { manualClock } from '../../../src/rules/time/clock.js';
import { unexpectedWorkbookSync } from '../../support/helpers/backend/workbook-sync.js';
import type { WorkbookSyncDownload } from '../../../src/backend/workbooks/workbook-library-service.js';
import type { z } from 'zod';

const databases: DatabaseSync[] = [];
afterEach(() => databases.splice(0).forEach(database => database.close()));
function fixture(sync: WorkbookSyncDownload = unexpectedWorkbookSync) {
  const database = new DatabaseSync(':memory:'); databases.push(database);
  for (const sql of [...WORKBOOK_LIBRARY_MIGRATION.statements, ...WORKBOOK_MASTER_MIGRATION.statements, ...WORKBOOK_LIBRARY_CATALOG_MIGRATION.statements]) database.exec(sql);
  database.exec("CREATE TABLE runs (id TEXT PRIMARY KEY,state TEXT NOT NULL,lifecycle_json TEXT NOT NULL); CREATE TABLE run_requests (id TEXT PRIMARY KEY,payload_json TEXT NOT NULL)");
  const transaction = <T>(work: () => T) => {
    database.exec('BEGIN IMMEDIATE');
    try { const result = work(); database.exec('COMMIT'); return result; }
    catch (error) { database.exec('ROLLBACK'); throw error; }
  };
  const repository = createWorkbookLibraryRepository({ database, read: transaction, mutate: work => transaction(() => work().result) });
  const service = createWorkbookLibraryService({ repository, sync, clock: manualClock(new Date('2026-11-02T00:00:00Z')) });
  const record = service.create({ name: 'Roster.xlsx', themes: [], hasFormulas: false, sheets: [{ id: 'people', name: 'Sheet 1', hidden: [], width: 2,
    columnBindings: ['eid', 'fullName'].map((fieldId, index) => ({ id: `column-${index}`, sourceColumn: index, sourceHeader: ['EID', 'Name'][index], fieldId, basis: 'manual' })),
    rows: [{ id: 'header', cells: [{ value: 'EID' }, { value: 'Name' }] }, { id: 'person', cells: [{ value: '10000001' }, { value: 'Example, Person' }] }] }] });
  let sequence = 0;
  const action = (change: z.infer<typeof WorkbookLibraryChangeSchema>) => ({ operationId: `action-${++sequence}`, expectedRevision: repository.libraryState(record.libraryId).revision,
    expectedVersion: service.read(record.libraryId).version, change });
  const apply = (change: z.infer<typeof WorkbookLibraryChangeSchema>) => service.libraryAction(record.libraryId, action(change), new AbortController().signal);
  return { database, repository, service, record, action, apply };
}

it('creates from any saved version, renames and uses it, with exact action replay and retained revisions', async () => {
  const f = fixture(), id = f.record.libraryId;
  const edited = structuredClone(f.record.workbook);
  edited.sheets[0].rows[1].cells[1].value = 'Changed, Person';
  const changed = f.service.save(id, 1, { ...edited, name: 'Later.xlsx' });
  const request = f.action({ kind: 'create-version', name: 'Original roster', from: { kind: 'version', versionId: 'original' }, useNow: false });
  const created = await f.service.libraryAction(id, request, new AbortController().signal);
  expect(created.result.selectedVersionId).toBe('revision:2');
  expect(created.result.versions.find(version => version.id === request.operationId)).toMatchObject({ name: 'Original roster', version: 1 });
  await f.apply({ kind: 'rename-version', versionId: request.operationId, name: 'Fall hires' });
  await f.apply({ kind: 'use-version', versionId: request.operationId });
  expect(f.service.catalog()[0].state.selectedVersionId).toBe(request.operationId);
  expect(f.service.read(id).version).toBe(changed.version + 1);
  expect(f.service.read(id).workbook.sheets).toEqual(f.record.workbook.sheets);
  expect(f.service.revision(id, 1)).toEqual(f.record);
  expect(await f.service.libraryAction(id, request, new AbortController().signal)).toEqual(created);
  await expect(f.service.libraryAction(id, { ...request, change: { ...request.change, name: 'Different' } }, new AbortController().signal))
    .rejects.toMatchObject({ code: 'WORKBOOK_OPERATION_CONFLICT' });
  expect(f.service.read(id).version).toBe(changed.version + 1);
  expect(validateWorkbookLibrary(f.database)).toBeGreaterThan(0);
});

it('refuses stale catalogue authority and keeps selected versions and active-run references undeletable', async () => {
  const f = fixture(), id = f.record.libraryId;
  const stale = f.action({ kind: 'create-version', name: 'Stale', from: { kind: 'version', versionId: 'original' }, useNow: false });
  const created = await f.apply({ kind: 'create-version', name: 'In use', from: { kind: 'version', versionId: 'original' }, useNow: true });
  await expect(f.service.libraryAction(id, stale, new AbortController().signal)).rejects.toMatchObject({ code: 'WORKBOOK_VERSION_CONFLICT' });
  await expect(f.apply({ kind: 'delete-version', versionId: created.action.operationId })).rejects.toMatchObject({ code: 'WORKBOOK_VERSION_IN_USE' });
  f.database.prepare('INSERT INTO runs VALUES(?,?,?)').run('run', 'parked-gate', JSON.stringify({ input: { workbookReferences: [{ value: { snapshot: { libraryId: id, version: 1 } } }] } }));
  await expect(f.apply({ kind: 'delete-version', versionId: 'original' })).rejects.toMatchObject({ code: 'WORKBOOK_VERSION_IN_USE' });
  await expect(f.apply({ kind: 'remove' })).rejects.toMatchObject({ code: 'WORKBOOK_LIBRARY_IN_USE' });
  f.database.prepare("UPDATE runs SET state='terminal'").run();
  await f.apply({ kind: 'delete-version', versionId: 'original' });
  expect(f.service.revision(id, 1)).toEqual(f.record);
  expect(f.repository.libraryState(id).versions.some(version => version.id === 'original')).toBe(false);
});

it('protects unconsumed plans and removes a library entry without deleting retained run evidence', async () => {
  const f = fixture(), id = f.record.libraryId;
  f.database.prepare('INSERT INTO run_requests VALUES(?,?)').run('plan', JSON.stringify({ expiresAt: '2026-11-03T00:00:00Z', planned: [{ workbookReferences: [{ value: { snapshot: { libraryId: id, version: 1 } } }] }] }));
  await expect(f.apply({ kind: 'remove' })).rejects.toMatchObject({ code: 'WORKBOOK_LIBRARY_IN_USE' });
  f.database.prepare('UPDATE run_requests SET payload_json=?').run(JSON.stringify({ consumedBy: { commandId: 'start' } }));
  const request = f.action({ kind: 'remove' });
  const result = await f.service.libraryAction(id, request, new AbortController().signal);
  expect(result.result.removed).toBe(true);
  expect(f.service.catalog()).toEqual([]);
  expect(f.service.list()).toEqual([]);
  expect(() => f.service.read(id)).toThrow(expect.objectContaining({ code: 'WORKBOOK_NOT_FOUND' }));
  expect(f.service.revision(id, 1)).toEqual(f.record);
  expect(await f.service.libraryAction(id, request, new AbortController().signal)).toEqual(result);
  expect(validateWorkbookLibrary(f.database)).toBeGreaterThan(0);
});

it('names a SharePoint version atomically and keeps the prior version in use when requested', async () => {
  let downloads = 0;
  const f = fixture({ async withDownload(command, use) {
    downloads++;
    return use({ name: 'Fresh.csv', bytes: new TextEncoder().encode('EID,Name\r\n10000001,Fresh Person\r\n').buffer }, {
      signal: command.signal, assertCurrent: () => command.signal.throwIfAborted(),
    });
  } });
  f.repository.putType({ id: 'roster', name: 'Roster', keyFieldId: 'eid', fields: ['eid', 'fullName'], defaultWorkbookId: null });
  f.service.operatorOperation(f.record.libraryId, 'link', { kind: 'metadata', expectedVersion: 1,
    metadata: { typeId: 'roster', sharePoint: { url: 'https://example.sharepoint.com/sites/hr/Roster.xlsx', verifiedAt: '2026-11-02T00:00:00Z' } } });
  const before = f.service.read(f.record.libraryId);
  const request = f.action({ kind: 'create-version', name: 'Fresh roster', from: { kind: 'sharepoint' }, useNow: false });
  const result = await f.service.libraryAction(f.record.libraryId, request, new AbortController().signal);
  const version = result.result.versions.find(version => version.id === request.operationId);
  expect(version).toMatchObject({ name: 'Fresh roster', source: 'sharepoint' });
  expect(result.result.selectedVersionId).toBe('original');
  expect(f.service.read(f.record.libraryId)).toEqual(before);
  expect(f.service.libraryVersion(f.record.libraryId, version!.id).workbook.sheets[0].rows[1].cells[1].value).toBe('Fresh Person');
  expect(await f.service.libraryAction(f.record.libraryId, request, new AbortController().signal)).toEqual(result);
  expect(downloads).toBe(1);
  expect(validateWorkbookLibrary(f.database)).toBeGreaterThan(0);
});

it('merges atomically, retains both originals as named versions, archives sources and refuses stale source authority', async () => {
  const f = fixture(), id = f.record.libraryId;
  f.service.putType({ id: 'roster', name: 'Roster', keyFieldId: 'eid', fields: ['eid', 'fullName'], defaultWorkbookId: null });
  await f.apply({ kind: 'metadata', metadata: { typeId: 'roster', sharePoint: null } });
  const other = f.service.create({ ...f.record.workbook, libraryId: undefined, name: 'Other.xlsx' });
  await f.service.libraryAction(other.libraryId, { operationId: 'type', expectedRevision: 1, expectedVersion: 1,
    change: { kind: 'metadata', metadata: { typeId: 'roster', sharePoint: null } } }, new AbortController().signal);
  const source = { libraryId: other.libraryId, expectedRevision: f.repository.libraryState(other.libraryId).revision, expectedVersion: f.service.read(other.libraryId).version };
  const stale = f.action({ kind: 'merge', name: 'Merged.xlsx', duplicates: 'keep-both', sources: [{ ...source, expectedRevision: source.expectedRevision - 1 }] });
  await expect(f.service.libraryAction(id, stale, new AbortController().signal)).rejects.toMatchObject({ code: 'WORKBOOK_VERSION_CONFLICT' });
  expect(f.service.catalog()).toHaveLength(2);
  const action = f.action({ kind: 'merge', name: 'Merged.xlsx', duplicates: 'keep-both', sources: [source] });
  const result = await f.service.libraryAction(id, action, new AbortController().signal);
  expect(f.service.catalog()).toHaveLength(1);
  expect(f.service.catalog()[0]).toMatchObject({ name: 'Merged.xlsx', rowCount: 2, metadata: { typeId: 'roster', sharePoint: null } });
  expect(result.result.versions.some(version => version.name === 'From Other.xlsx')).toBe(true);
  expect(f.service.revision(other.libraryId, 1)).toEqual(other);
  expect(f.repository.libraryVersion(id, 'original').workbook.sheets[0].rows).toHaveLength(2);
  expect(await f.service.libraryAction(id, action, new AbortController().signal)).toEqual(result);
  expect(validateWorkbookLibrary(f.database)).toBeGreaterThan(0);
});

it('links and unlinks without treating link time as a successful sync', async () => {
  const f = fixture();
  await f.apply({ kind: 'link', url: 'https://example.sharepoint.com/roster.xlsx' });
  expect(f.service.catalog()[0].metadata.sharePoint?.url).toBe('https://example.sharepoint.com/roster.xlsx');
  expect(f.service.catalog()[0].state.versions.map(version => version.source)).toEqual(['import']);
  await f.apply({ kind: 'unlink' });
  expect(f.service.catalog()[0].metadata.sharePoint).toBeNull();
});

it('captures exact named all-row bytes separately from live CAS and refuses missing named versions', () => {
  const f = fixture(), id = f.record.libraryId;
  f.repository.putType({ id: 'ocr-roster', name: 'OCR roster', keyFieldId: 'eid', fields: ['eid', 'fullName'], defaultWorkbookId: null });
  f.service.operatorOperation(id, 'type', { kind: 'metadata', expectedVersion: 1, metadata: { typeId: 'ocr-roster', sharePoint: null } });
  const edited = structuredClone(f.service.read(id).workbook);
  edited.sheets[0].rows[1].cells[1].value = 'Changed, Person';
  f.service.save(id, 2, edited);
  const request = { mode: 'all', typeId: 'ocr-roster', libraryId: id, versionId: 'original', expectedVersion: 3, fields: ['eid', 'fullName'] };
  const captured = f.service.snapshot(request);
  expect(captured).toMatchObject({ version: 3, versionId: 'original', versionName: 'Original version', rows: [{ matches: [{ values: { fullName: 'Example, Person' } }] }] });
  expect(() => f.service.snapshot({ ...request, versionId: 'missing' })).toThrow(expect.objectContaining({ code: 'WORKBOOK_REVISION_UNAVAILABLE' }));
  expect(() => f.service.snapshot({ ...request, expectedVersion: 2 })).toThrow(expect.objectContaining({ code: 'WORKBOOK_VERSION_CONFLICT' }));
});
