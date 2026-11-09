import { projectWorkflowStartReadiness } from '../../../src/backend/runs/queries/bootstrap.js';
import { ERROR_CATALOG } from '../../../src/models/failures/error-catalog.js';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, expect, it } from 'vitest';
import { createWorkbookLibraryRepository, WORKBOOK_LIBRARY_MIGRATION, WORKBOOK_MASTER_MIGRATION, WORKBOOK_LIBRARY_CATALOG_MIGRATION, validateWorkbookLibrary } from '../../../src/backend/storage/sqlite/workbook-library-repository.js';
import { createWorkbookLibraryService } from '../../../src/backend/workbooks/workbook-library-service.js';
import { WorkbookLibraryOriginSchema, WorkbookLibraryChangeSchema } from '../../../src/models/dashboard/workbook-library.js';
import { manualClock } from '../../../src/rules/time/clock.js';
import { unexpectedWorkbookSync } from '../../support/helpers/backend/workbook-sync.js';
import type { WorkbookSyncDownload } from '../../../src/backend/workbooks/workbook-library-service.js';
import type { z } from 'zod';
import { encodeEditableWorkbook } from '../../../src/models/dashboard/workbooks.js';
import { spreadsheetValuesOnly } from '../../../src/dashboard/surfaces/spreadsheets/spreadsheet-editor-model.js';

const databases: DatabaseSync[] = [];
afterEach(() => databases.splice(0).forEach(database => database.close()));
function fixture(sync: WorkbookSyncDownload = unexpectedWorkbookSync, options: Pick<Parameters<typeof createWorkbookLibraryService>[0], 'workflows' | 'resultRun'> = {}) {
  const database = new DatabaseSync(':memory:'); databases.push(database);
  for (const sql of [...WORKBOOK_LIBRARY_MIGRATION.statements, ...WORKBOOK_MASTER_MIGRATION.statements, ...WORKBOOK_LIBRARY_CATALOG_MIGRATION.statements]) database.exec(sql);
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


it('imports a declared reference atomically, shares its type default across workflows and exposes only mapped column facts', () => {
  const workflows = [{ id: 'first', label: 'First', requiredWorkbookTypeIds: ['roster'] }, { id: 'second', label: 'Second', requiredWorkbookTypeIds: ['roster'] }];
  const f = fixture(unexpectedWorkbookSync, { workflows });
  expect(f.service.references(workflows).map(slot => slot.current)).toEqual([
    { state: 'unavailable', code: 'WORKBOOK_TYPE_UNAVAILABLE' }, { state: 'unavailable', code: 'WORKBOOK_TYPE_UNAVAILABLE' },
  ]);
  expect(projectWorkflowStartReadiness(workflows[0], f.service.references(workflows))).toEqual({
    scope: 'default-workbook-references', state: 'unavailable', reason: ERROR_CATALOG.WORKBOOK_TYPE_UNAVAILABLE.text,
    fixAction: { kind: 'review-workbook-reference', workflowId: 'first', typeId: 'roster' },
  });
  f.service.putType({ id: 'roster', name: 'Roster', fields: ['eid', 'fullName'], keyFieldId: 'eid', defaultWorkbookId: null });
  expect(projectWorkflowStartReadiness(workflows[1], f.service.references(workflows))).toEqual({
    scope: 'default-workbook-references', state: 'blocked', reason: 'Second needs Roster.',
    fixAction: { kind: 'import-workbook', purpose: { kind: 'workflow-reference', workflowId: 'second', typeId: 'roster' } },
  });
  expect(f.service.references(workflows).every(slot => slot.current.state === 'missing')).toBe(true);
  const multiple = { id: 'first', label: 'First', requiredWorkbookTypeIds: ['roster', 'another-roster'] };
  expect(projectWorkflowStartReadiness(multiple, f.service.references([multiple]))).toMatchObject({
    state: 'blocked', fixAction: { purpose: { workflowId: 'first', typeId: 'roster' } },
  });
  const workbook = { ...f.record.workbook, libraryId: undefined };
  workbook.sheets = [...workbook.sheets, { ...workbook.sheets[0], id: 'unmapped', name: 'No bindings', columnBindings: undefined }];
  const request = { workbook: encodeEditableWorkbook(workbook), purpose: { kind: 'workflow-reference', workflowId: 'first', typeId: 'roster' } };
  const result = f.service.import(request);
  expect(result.purpose).toEqual(request.purpose);
  expect(result.reference).toEqual({ workflowId: 'first', typeId: 'roster', libraryId: result.workbook.libraryId });
  expect(f.service.metadata(result.workbook.libraryId).typeId).toBe('roster');
  expect(f.service.revision(result.workbook.libraryId, 1).version).toBe(1);
  expect(f.service.revision(result.workbook.libraryId, 2).version).toBe(2);
  const slots = f.service.references(workflows);
  expect(projectWorkflowStartReadiness(workflows[0], slots)).toEqual({ scope: 'default-workbook-references', state: 'ready' });
  expect(projectWorkflowStartReadiness(workflows[1], slots)).toEqual({ scope: 'default-workbook-references', state: 'ready' });
  const broken = slots.map(slot => ({ ...slot, current: { state: 'unavailable' as const, code: 'WORKBOOK_BINDING_UNAVAILABLE' as const } }));
  expect(projectWorkflowStartReadiness(workflows[0], broken)).toEqual({
    scope: 'default-workbook-references', state: 'unavailable', reason: ERROR_CATALOG.WORKBOOK_BINDING_UNAVAILABLE.text,
    fixAction: { kind: 'review-workbook-reference', workflowId: 'first', typeId: 'roster' },
  });
  expect(() => projectWorkflowStartReadiness(workflows[0], slots.filter(slot => slot.workflowId !== 'first'))).toThrow('WORKBOOK_REFERENCE_SLOT_UNAVAILABLE');
  for (const slot of slots) {
    expect(slot.type?.defaultWorkbookId).toBe(result.workbook.libraryId);
    expect(slot.current.state).toBe('bound');
    if (slot.current.state !== 'bound') throw new Error('reference not bound');
    expect(slot.current.columns).toEqual([
      { sheetId: 'people', sheetName: 'Sheet 1', eid: [{ column: 0, fieldId: 'eid', basis: 'manual' }], name: [{ column: 1, fieldId: 'fullName', basis: 'manual' }] },
      { sheetId: 'unmapped', sheetName: 'No bindings', eid: [], name: [] },
    ]);
    expect(JSON.stringify(slot.current.columns)).not.toContain('10000001');
  }
  const other = f.service.import({ workbook: request.workbook, purpose: { kind: 'other' } });
  expect(other.reference).toBeNull();
  expect(f.service.metadata(other.workbook.libraryId).typeId).toBe('general');
  expect(f.service.types().find(type => type.id === 'roster')?.defaultWorkbookId).toBe(result.workbook.libraryId);
  expect(validateWorkbookLibrary(f.database)).toBeGreaterThan(0);
});

it('rejects invalid import purposes before effects and rolls back creation, metadata and binding together', () => {
  const f = fixture(unexpectedWorkbookSync, { workflows: [{ id: 'first', label: 'First', requiredWorkbookTypeIds: ['roster', 'absent'] }] });
  f.service.putType({ id: 'roster', name: 'Roster', fields: ['eid'], keyFieldId: 'eid', defaultWorkbookId: null });
  const workbook = encodeEditableWorkbook({ ...f.record.workbook, libraryId: undefined });
  const before = f.service.catalog();
  for (const purpose of [undefined, { kind: 'other', typeId: 'roster' },
    { kind: 'workflow-reference', workflowId: 'unknown', typeId: 'roster' },
    { kind: 'workflow-reference', workflowId: 'first', typeId: 'general' },
    { kind: 'workflow-reference', workflowId: 'first', typeId: 'absent' }]) {
    expect(() => f.service.import({ workbook, purpose })).toThrow(expect.objectContaining({ code: 'WORKBOOK_INVALID' }));
    expect(f.service.catalog()).toEqual(before);
  }
  const counts = () => ['workbook_library', 'workbook_creations', 'workbook_operations', 'workbook_library_state', 'workbook_library_snapshots']
    .map(table => f.database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()?.count);
  const initial = counts();
  f.database.exec("CREATE TRIGGER refuse_binding BEFORE UPDATE ON workbook_types BEGIN SELECT RAISE(ABORT,'synthetic refusal'); END");
  expect(() => f.service.import({ workbook, purpose: { kind: 'workflow-reference', workflowId: 'first', typeId: 'roster' } })).toThrow(expect.objectContaining({ code: 'WORKBOOK_STORAGE_FAILED' }));
  expect(counts()).toEqual(initial);
  expect(f.service.catalog()).toEqual(before);
  expect(f.service.types().find(type => type.id === 'roster')?.defaultWorkbookId).toBeNull();
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
