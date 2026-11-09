import { installRetainedMergeFixture } from '../../support/fixtures/storage/retained-workbook-merge.js';
import { SQLITE_MIGRATIONS } from '../../../src/backend/storage/sqlite/migrations.js';
import { projectWorkflowStartReadiness } from '../../../src/backend/runs/queries/bootstrap.js';
import { ERROR_CATALOG } from '../../../src/models/failures/error-catalog.js';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, expect, it, vi } from 'vitest';
import { createWorkbookLibraryRepository, WORKBOOK_LIBRARY_MIGRATION, WORKBOOK_MASTER_MIGRATION, WORKBOOK_LIBRARY_CATALOG_MIGRATION, validateWorkbookLibrary } from '../../../src/backend/storage/sqlite/workbook-library-repository.js';
import { createWorkbookLibraryService, projectWorkbookCompatibilityFromRepository, verifyRetainedNamedWorkbookReference } from '../../../src/backend/workbooks/workbook-library-service.js';
import { WorkbookLibraryOriginSchema, WorkbookLibraryChangeSchema, WorkbookLibraryEntrySchema, WorkbookCompatibilitySchema, projectWorkbookCompatibility } from '../../../src/models/dashboard/workbook-library.js';
import { manualClock } from '../../../src/rules/time/clock.js';
import { unexpectedWorkbookSync } from '../../support/helpers/backend/workbook-sync.js';
import type { WorkbookSyncDownload } from '../../../src/backend/workbooks/workbook-library-service.js';
import type { z } from 'zod';
import { encodeEditableWorkbook, RunWorkbookNamedReferenceSchema } from '../../../src/models/dashboard/workbooks.js';
import { spreadsheetValuesOnly } from '../../../src/dashboard/surfaces/spreadsheets/spreadsheet-editor-model.js';

const databases: DatabaseSync[] = [];
afterEach(() => databases.splice(0).forEach(database => database.close()));
function fixture(sync: WorkbookSyncDownload = unexpectedWorkbookSync, options: Pick<Parameters<typeof createWorkbookLibraryService>[0], 'resultRun'> = {}) {
  const database = new DatabaseSync(':memory:'); databases.push(database);
  for (const sql of [...WORKBOOK_LIBRARY_MIGRATION.statements, ...WORKBOOK_MASTER_MIGRATION.statements, ...WORKBOOK_LIBRARY_CATALOG_MIGRATION.statements]) database.exec(sql);
  const selectionTable = SQLITE_MIGRATIONS.find(migration => migration.version === 24)?.statements
    .find(statement => statement.startsWith('CREATE TABLE workflow_workbook_selections'));
  if (selectionTable === undefined) throw new Error('current workbook selections migration unavailable');
  database.exec(selectionTable);
  database.exec("CREATE TABLE runs (id TEXT PRIMARY KEY,state TEXT NOT NULL,lifecycle_json TEXT NOT NULL); CREATE TABLE run_requests (id TEXT PRIMARY KEY,payload_json TEXT NOT NULL)");
  const transaction = <T>(work: () => T) => {
    database.exec('BEGIN IMMEDIATE');
    try { const result = work(); database.exec('COMMIT'); return result; }
    catch (error) { database.exec('ROLLBACK'); throw error; }
  };
  const repository = createWorkbookLibraryRepository({ database, read: transaction, mutate: work => transaction(() => work().result) });
  const clock = manualClock(new Date('2026-11-02T00:00:00Z'));
  const service = createWorkbookLibraryService({ repository, sync, clock, ...options });
  const record = service.create({ name: 'Roster.xlsx', themes: [], hasFormulas: false, sheets: [{ id: 'people', name: 'Sheet 1', hidden: [], width: 2,
    columnBindings: ['eid', 'fullName'].map((fieldId, index) => ({ id: `column-${index}`, sourceColumn: index, sourceHeader: ['EID', 'Name'][index], fieldId, basis: 'manual' })),
    rows: [{ id: 'header', cells: [{ value: 'EID' }, { value: 'Name' }] }, { id: 'person', cells: [{ value: '10000001' }, { value: 'Example, Person' }] }] }] });
  let sequence = 0;
  const action = (change: z.infer<typeof WorkbookLibraryChangeSchema>) => ({ operationId: `action-${++sequence}`, expectedRevision: repository.libraryState(record.libraryId).revision,
    expectedVersion: service.read(record.libraryId).version, change });
  const apply = (change: z.infer<typeof WorkbookLibraryChangeSchema>) => service.libraryAction(record.libraryId, action(change), new AbortController().signal);
  return { database, repository, service, record, action, apply, clock };
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

it('retains edited values as a named version without altering an unsupported original or weakening ordinary saves', async () => {
  const f = fixture();
  const original = f.service.create({ ...f.record.workbook, libraryId: undefined, unsupportedMetadata: true, hasFormulas: true,
    themes: ['synthetic theme'], sheets: f.record.workbook.sheets.map(sheet => ({ ...sheet, rows: sheet.rows.map(row => ({ ...row,
      cells: row.cells.map(cell => ({ ...cell, numFmt: '@', background: '#ffffff' })) })) })) });
  const id = original.libraryId, draft = spreadsheetValuesOnly({ ...original.workbook, sheets: original.workbook.sheets.map(sheet => ({ ...sheet, rows: sheet.rows.map(row => row.id === 'person' ? { ...row, cells: [row.cells[0], { value: 'Edited synthetic person' }] } : row) })) });
  expect(() => f.service.save(id, 1, draft)).toThrow(expect.objectContaining({ code: 'WORKBOOK_METADATA_UNSUPPORTED' }));
  const action = { operationId: 'values-only', expectedRevision: 1, expectedVersion: 1,
    change: { kind: 'create-version' as const, name: 'Edited values', from: { kind: 'values' as const, workbook: encodeEditableWorkbook(draft) }, useNow: false } };
  const result = await f.service.libraryAction(id, action, new AbortController().signal);
  expect(result.result.selectedVersionId).toBe('original');
  expect(f.service.libraryVersion(id, 'values-only').workbook).toEqual(encodeEditableWorkbook(draft));
  expect(f.service.libraryVersion(id, 'original').workbook).toEqual(encodeEditableWorkbook(original.workbook));
  expect(f.service.read(id)).toEqual(original);
  expect(f.service.revision(id, 1)).toEqual(original);
  expect(await f.service.libraryAction(id, action, new AbortController().signal)).toEqual(result);
  await expect(f.service.libraryAction(id, { ...action, change: { ...action.change, name: 'Other' } }, new AbortController().signal)).rejects.toMatchObject({ code: 'WORKBOOK_OPERATION_CONFLICT' });
  await expect(f.service.libraryAction(id, { ...action, operationId: 'stale' }, new AbortController().signal)).rejects.toMatchObject({ code: 'WORKBOOK_VERSION_CONFLICT' });
  await expect(f.service.libraryAction(id, { ...action, operationId: 'metadata', expectedRevision: 2,
    change: { ...action.change, from: { kind: 'values', workbook: encodeEditableWorkbook(original.workbook) } } }, new AbortController().signal)).rejects.toMatchObject({ code: 'WORKBOOK_INVALID' });
  expect(f.service.libraryVersion(id, 'original').workbook).toEqual(encodeEditableWorkbook(original.workbook));
  expect(validateWorkbookLibrary(f.database)).toBeGreaterThan(0);
});

it('edits type labels, membership and required fields while retaining captured reference definitions', () => {
  const f = fixture();
  const before = f.repository.putType({ id: 'type', name: 'Roster', fields: ['eid'], keyFieldId: 'eid', defaultWorkbookId: null });
  const after = f.repository.putType({ ...before, fields: ['eid', 'roster.customField'], fieldLabels: { eid: 'Employee number', 'roster.customField': 'Custom field' }, requiredFields: ['eid'] });
  expect(after.fields).toEqual(['eid', 'roster.customField']);
  expect(before.fields).toEqual(['eid']);
  expect(f.repository.types()).toContainEqual(after);
  expect(() => f.repository.putType({ ...after, fields: [], keyFieldId: null, fieldLabels: {}, requiredFields: [] })).toThrow();
});

it('keeps reference type schemas stable and protects structural edits needed for journal replay', async () => {
  const f = fixture();
  const type = f.repository.putType({ id: 'roster', name: 'Roster', fields: ['eid', 'fullName'], keyFieldId: 'eid', defaultWorkbookId: null });
  await f.apply({ kind: 'metadata', metadata: { typeId: type.id, sharePoint: null } });
  const captured = f.repository.snapshot({ typeId: type.id, libraryId: f.record.libraryId, keys: ['10000001'], fields: ['fullName'] });
  f.repository.putType({ ...type, fieldLabels: { eid: 'Employee number' }, requiredFields: ['eid'] });
  expect(f.repository.snapshot({ typeId: type.id, libraryId: f.record.libraryId, keys: ['10000001'], fields: ['fullName'] }).type).toEqual(captured.type);
  expect(() => f.repository.putType({ ...type, fields: ['eid'] })).toThrow(expect.objectContaining({ code: 'WORKBOOK_TYPE_IN_USE' }));
  expect(f.service.revision(f.record.libraryId, 2).version).toBe(2);
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

it('rejects retired merge commands before lookup or mutation, including completed operation identities', async () => {
  const f = fixture(), historical = installRetainedMergeFixture(f.database);
  const before = f.database.prepare('SELECT * FROM workbook_library_actions').all();
  const mutation = vi.fn(() => { throw new Error('unexpected mutation'); });
  const rejectingRepository = createWorkbookLibraryRepository({ database: f.database, read: work => work(), mutate: mutation });
  const lookup = vi.fn((libraryId: string, operationId: string) => f.repository.libraryActionRecord(libraryId, operationId));
  const service = createWorkbookLibraryService({ repository: { ...f.repository, libraryActionRecord: lookup }, clock: f.clock, sync: unexpectedWorkbookSync });
  for (const operationId of ['new-merge', historical.action.operationId]) {
    const request = { ...historical.action, operationId };
    expect(WorkbookLibraryChangeSchema.safeParse(request.change).success).toBe(false);
    await expect(service.libraryAction(historical.libraryId, request, new AbortController().signal))
      .rejects.toMatchObject({ code: 'WORKBOOK_INVALID' });
    expect(() => rejectingRepository.libraryAction(historical.libraryId, request, historical.at)).toThrow(expect.objectContaining({ code: 'WORKBOOK_INVALID' }));
  }
  expect(lookup).not.toHaveBeenCalled();
  expect(mutation).not.toHaveBeenCalled();
  await expect(service.libraryAction(historical.libraryId, { ...historical.action, change: { kind: 'remove' } }, new AbortController().signal))
    .rejects.toMatchObject({ code: 'WORKBOOK_OPERATION_CONFLICT' });
  expect(f.database.prepare('SELECT * FROM workbook_library_actions').all()).toEqual(before);
  expect(f.repository.libraryActionRecord(historical.libraryId, historical.action.operationId)).toEqual(historical);
  expect(service.libraryActionStatus(historical.libraryId, historical.action.operationId)).toEqual({
    state: 'retired', code: 'WORKBOOK_ACTION_RETIRED', message: ERROR_CATALOG.WORKBOOK_ACTION_RETIRED.text,
  });
  expect(f.service.revision(historical.libraryId, 2).workbook.name).toBe('Merged.xlsx');
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
  const request = { kind: 'selected-source', mode: 'all', typeId: 'ocr-roster', keyFieldId: 'eid',
    libraryId: id, versionId: 'original', sheetId: 'people', expectedVersion: 3,
    fields: ['eid', 'fullName'], writableFields: [] };
  const captured = f.service.snapshot(request);
  expect(captured).toMatchObject({ version: 3, versionId: 'original', versionName: 'Original version', rows: [{ matches: [{ values: { fullName: 'Example, Person' } }] }] });
  expect(() => f.service.snapshot({ mode: 'all', typeId: 'ocr-roster', libraryId: id,
    versionId: 'original', expectedVersion: 3, fields: ['eid', 'fullName'] }))
    .toThrow(expect.objectContaining({ code: 'WORKBOOK_INVALID' }));
  expect(() => f.service.snapshot({ ...request, versionId: 'missing' })).toThrow(expect.objectContaining({ code: 'WORKBOOK_REVISION_UNAVAILABLE' }));
  expect(() => f.service.snapshot({ ...request, expectedVersion: 2 })).toThrow(expect.objectContaining({ code: 'WORKBOOK_VERSION_CONFLICT' }));
});


it('serves one General Library worksheet to two workflows without type assignment or a default', () => {
  const workflows = [
    { id: 'ocr', label: 'OCR', requiredWorkbookFields: ['eid', 'fullName'],
      workbookReference: { id: 'ocr-roster', keyFieldId: 'eid', mode: 'all' as const, writableFields: [] } },
    { id: 'second', label: 'Second', requiredWorkbookFields: ['eid'],
      workbookReference: { id: 'action-history', keyFieldId: 'eid', mode: 'keys' as const, writableFields: [] } },
  ];
  const f = fixture(), id = f.record.libraryId;
  expect(f.service.metadata(id).typeId).toBe('general');
  const blank = structuredClone(f.record.workbook);
  blank.sheets[0].rows[1].cells[1].value = null;
  f.service.save(id, f.record.version, blank);
  const report = f.service.compatibility(workflows);
  expect(WorkbookCompatibilitySchema.parse(report)).toEqual(report);
  expect(report.workflows.map(workflow => workflow.sources.map(source => source.libraryId))).toEqual([[id], [id]]);
  expect(report.libraries[0].sheets[0].mappings).toEqual([
    { fieldId: 'eid', column: 0, basis: 'manual' }, { fieldId: 'fullName', column: 1, basis: 'manual' },
  ]);
  expect(projectWorkflowStartReadiness(workflows[0], report)).toEqual({ scope: 'workbook-sources', state: 'selection-needed',
    fixAction: { kind: 'choose-workbook-sources', workflowId: 'ocr' } });
  expect(projectWorkflowStartReadiness(workflows[1], report)).toEqual({ scope: 'workbook-sources', state: 'selection-needed',
    fixAction: { kind: 'choose-workbook-sources', workflowId: 'second' } });
  expect(validateWorkbookLibrary(f.database)).toBeGreaterThan(0);
});
it('refuses a named snapshot whose stored row value changed while its current revision still matches', () => {
  const f = fixture(), id = f.record.libraryId;
  const snapshot = f.service.snapshot({ kind: 'selected-source', mode: 'keys', typeId: 'roster', keyFieldId: 'eid',
    libraryId: id, versionId: 'original', sheetId: 'people', expectedVersion: 1,
    keys: ['10000001'], fields: ['eid', 'fullName'], writableFields: [] });
  const named = f.repository.libraryVersion(id, 'original'), workbook = structuredClone(named.workbook);
  workbook.sheets[0].rows[1].cells[1].value = 'Altered';
  const reference = RunWorkbookNamedReferenceSchema.parse({ request: { typeId: 'roster', libraryId: id,
    versionId: 'original', keys: ['10000001'], fields: ['eid', 'fullName'] }, snapshot });
  expect(() => verifyRetainedNamedWorkbookReference({ ...f.repository,
    libraryVersion: () => ({ ...named, workbook }) }, reference))
    .toThrow(expect.objectContaining({ code: 'WORKBOOK_STORAGE_CORRUPT' }));
});
it('serves one concrete fix for an empty Library or incomplete worksheet mappings', () => {
  const workflow = { id: 'needs-email', label: 'Email lookup', requiredWorkbookFields: ['email'],
    workbookReference: { id: 'email-roster', keyFieldId: 'email', mode: 'keys' as const, writableFields: [] } };
  const empty = projectWorkbookCompatibility([workflow], []);
  expect(projectWorkflowStartReadiness(workflow, empty)).toEqual({ scope: 'workbook-sources', state: 'unavailable',
    reasonCode: 'WORKBOOK_LIBRARY_EMPTY', reason: ERROR_CATALOG.WORKBOOK_LIBRARY_EMPTY.text,
    fixAction: { kind: 'import-workbook', workflowId: workflow.id } });
  const f = fixture(), incomplete = f.service.compatibility([workflow]);
  expect(projectWorkflowStartReadiness(workflow, incomplete)).toEqual({ scope: 'workbook-sources', state: 'unavailable',
    reasonCode: 'WORKBOOK_FIELDS_MISSING', reason: ERROR_CATALOG.WORKBOOK_FIELDS_MISSING.text,
    fixAction: { kind: 'review-workbook-fields', workflowId: workflow.id, requiredFields: ['email'] } });
});

it('does not read a Results or unavailable version as a reference candidate', () => {
  const f = fixture();
  const result = WorkbookLibraryEntrySchema.parse({ ...f.service.catalog()[0], state: {
    ...f.service.catalog()[0].state, origin: { kind: 'unavailable', code: 'WORKBOOK_OUTPUT_SOURCE_UNAVAILABLE' },
  } });
  const report = projectWorkbookCompatibilityFromRepository({ catalog: () => [result],
    libraryVersion: () => { throw new Error('Result version must not be read'); }, lastUsed: () => undefined },
  [{ id: 'ocr', label: 'OCR', requiredWorkbookFields: ['eid'],
    workbookReference: { id: 'ocr-roster', keyFieldId: 'eid', mode: 'all', writableFields: [] } }]);
  expect(report.libraries).toEqual([]);
  expect(report.workflows[0].sources).toEqual([]);
});

it('rejects retired import fields before effects and keeps explicit default binding separate', () => {
  const f = fixture();
  f.service.putType({ id: 'roster', name: 'Roster', fields: ['eid'], keyFieldId: 'eid', defaultWorkbookId: null });
  const workbook = encodeEditableWorkbook({ ...f.record.workbook, libraryId: undefined });
  const before = f.service.catalog();
  for (const extra of [{ purpose: { kind: 'other' } }, { purpose: { kind: 'workflow-reference', workflowId: 'first', typeId: 'roster' } }, { reference: null }]) {
    expect(() => f.service.importWorkbook({ workbook, ...extra })).toThrow(expect.objectContaining({ code: 'WORKBOOK_INVALID' }));
    expect(f.service.catalog()).toEqual(before);
  }
  f.database.exec("CREATE TRIGGER refuse_binding BEFORE UPDATE ON workbook_types BEGIN SELECT RAISE(ABORT,'synthetic refusal'); END");
  const imported = f.service.importWorkbook({ workbook });
  expect(imported.workbook.version).toBe(1);
  expect(f.service.metadata(imported.workbook.libraryId).typeId).toBe('general');
  f.service.operatorOperation(imported.workbook.libraryId, 'assign-roster', { kind: 'metadata', expectedVersion: 1,
    metadata: { typeId: 'roster', sharePoint: null } });
  expect(() => f.service.putType({ id: 'roster', name: 'Roster', fields: ['eid'], keyFieldId: 'eid', defaultWorkbookId: imported.workbook.libraryId }))
    .toThrow(expect.objectContaining({ code: 'WORKBOOK_STORAGE_FAILED' }));
  expect(f.service.types().find(type => type.id === 'roster')?.defaultWorkbookId).toBeNull();
  expect(f.service.read(imported.workbook.libraryId).version).toBe(2);
});

it('serves selected content time across saves, metadata, retained versions and version selection', async () => {
  const f = fixture();
  const first = f.service.catalog()[0].updatedAt;
  f.clock.advanceWall(60_000);
  f.service.save(f.record.libraryId, 1, { ...f.record.workbook, name: 'Later.xlsx' });
  const latest = f.service.catalog()[0].updatedAt;
  expect(latest).not.toBe(first);
  f.clock.advanceWall(60_000);
  await f.apply({ kind: 'link', url: 'https://example.sharepoint.com/roster.xlsx' });
  expect(f.service.catalog()[0].updatedAt).toBe(latest);
  await f.apply({ kind: 'create-version', name: 'Original copy', from: { kind: 'version', versionId: 'original' }, useNow: false });
  expect(f.service.catalog()[0].updatedAt).toBe(latest);
  await f.apply({ kind: 'use-version', versionId: 'original' });
  expect(f.service.catalog()[0].updatedAt).toBe(first);
});

it('groups results using run enqueue authority, stable ties and explicit unavailable authority', () => {
  const runIds = ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000004'];
  const f = fixture(unexpectedWorkbookSync, { resultRun: id => id === runIds[3] ? undefined : { workflowId: id === runIds[2] ? 'second' : 'first',
    enqueuedAt: id === runIds[0] ? '2026-10-01T00:00:00Z' : '2026-11-01T00:00:00Z' } });
  const create = (id: string, runId: string, workflowId = 'first') => f.repository.create({ ...f.record, libraryId: id, workbook: { ...f.record.workbook, libraryId: id } },
    WorkbookLibraryOriginSchema.parse({ kind: 'workflow', runId, workflowId, workflowLabel: workflowId, partitionDay: '2026-11-02', rowCount: 1, rowSubject: 'person' }));
  create('a', runIds[0]); create('b', runIds[1]); create('c', runIds[1]); create('d', runIds[2], 'second'); create('e', runIds[3]);
  f.repository.create({ ...f.record, libraryId: 'legacy-output', workbook: { ...f.record.workbook, libraryId: 'legacy-output' } }, { kind: 'unavailable', code: 'WORKBOOK_OUTPUT_SOURCE_UNAVAILABLE' });
  const result = f.service.results();
  expect(result.unavailable.map(entry => entry.libraryId)).toEqual(['legacy-output']);
  expect(result.workflows.map(workflow => workflow.workflowId)).toEqual(['first', 'second']);
  expect(result.workflows[0].runs.map(run => run.runId)).toEqual([runIds[1], runIds[0], runIds[3]]);
  expect(result.workflows[0].runs[0].entries.map(entry => entry.libraryId)).toEqual(['b', 'c']);
  expect(result.workflows[0].runs[2].enqueuedAt).toBeNull();
  create('conflict', runIds[1], 'second');
  expect(() => f.service.results()).toThrow(expect.objectContaining({ code: 'WORKBOOK_STORAGE_CORRUPT' }));
});
