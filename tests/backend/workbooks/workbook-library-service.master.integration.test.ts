import { unexpectedWorkbookSync } from "../../support/helpers/backend/workbook-sync.js";
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { z } from 'zod';
import { Workbook, writeXlsx } from '@shbernal/ts-xlsx';
import { configureWritableConnection } from '../../../src/backend/storage/sqlite/authority-database.js';
import { createWorkbookLibraryRepository, WORKBOOK_LIBRARY_MIGRATION, WORKBOOK_MASTER_MIGRATION, WORKBOOK_LIBRARY_CATALOG_MIGRATION, WORKBOOK_LIBRARY_PIN_TAGS_MIGRATION, validateWorkbookLibrary } from '../../../src/backend/storage/sqlite/workbook-library-repository.js';
import { createWorkbookLibraryService } from '../../../src/backend/workbooks/workbook-library-service.js';
import { encodeSavedWorkbook, type WorkbookOperation } from '../../../src/models/dashboard/workbooks.js';
import { manualClock } from '../../../src/rules/time/clock.js';
import { IsoInstantSchema } from '../../../src/rules/identity/ids.js';
import { importWorkbook } from '../../../src/rules/spreadsheets/workbook-io.js';
const at = IsoInstantSchema.parse('2026-11-02T00:00:00.000Z');
const roots: string[] = [], databases: DatabaseSync[] = [];
afterEach(() => { databases.splice(0).forEach(db => db.close()); roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })); });
function open(path = ':memory:', initialize = true) {
  const database = new DatabaseSync(path); databases.push(database); configureWritableConnection(database, 5000);
  if (initialize) for (const statement of [...WORKBOOK_LIBRARY_MIGRATION.statements, ...WORKBOOK_MASTER_MIGRATION.statements, ...WORKBOOK_LIBRARY_CATALOG_MIGRATION.statements]) database.exec(statement);
  const tx = <T>(work: () => T): T => {
    database.exec('BEGIN IMMEDIATE');
    try { const value = work(); database.exec('COMMIT'); return value; } catch (error) { database.exec('ROLLBACK'); throw error; }
  };
  const repository = createWorkbookLibraryRepository({ database, read: tx, mutate: work => tx(() => work().result) });
  const service = createWorkbookLibraryService({ sync: unexpectedWorkbookSync, repository, clock: manualClock(new Date(at)) });
  return { database, repository, service };
}
function fixture(path?: string) {
  const f = open(path);
  const saved = f.service.create({ name: 'Roster.xlsx', themes: [], hasFormulas: false, sheets: [{ id: 'people', name: 'People', width: 3, hidden: [], headerRow: 1,
    columnBindings: ['eid', 'roster.legalName', 'roster.notes'].map((fieldId, i) => ({ id: `col${i}`, sourceColumn: i, sourceHeader: fieldId, fieldId, basis: 'manual' })),
    rows: [{ id: 'header', cells: ['EID', 'Legal name', 'Notes'].map(value => ({ value })) },
      { id: 'alice', cells: [{ value: '001' }, { value: new Date('2000-01-01T00:00:00.000Z') }, { value: null }] },
      { id: 'bob', cells: [{ value: '002' }, { value: 'Bob' }, { value: '' }] }] }] });
  f.repository.putType({ id: 'roster', name: 'Roster', keyFieldId: 'eid', fields: ['eid', 'roster.legalName', 'roster.notes'], defaultWorkbookId: null });
  f.service.operatorOperation(saved.libraryId, 'type', { kind: 'metadata', expectedVersion: 1, metadata: { typeId: 'roster', sharePoint: null } });
  const rosterType = f.repository.types().find(type => type.id === 'roster');
  if (!rosterType) throw new Error('roster type missing from fixture');
  f.repository.putType({ ...rosterType, defaultWorkbookId: saved.libraryId });
  const operation = (operationId: string, change: WorkbookOperation['change']): WorkbookOperation => ({ operationId, at, source: { kind: 'run', runId: '10000000-0000-4000-8000-000000000001' }, change });
  const patch = (operationId: string, key: string, note: string) => operation(operationId, { kind: 'patch', key, values: { 'roster.notes': note } });
  return { ...f, id: saved.libraryId, patch, operation };
}
function generalFixture() {
  const f = open();
  const saved = f.service.create({ name: 'General.xlsx', themes: [], hasFormulas: false,
    sheets: [{ id: 'people', name: 'People', width: 3, hidden: [], headerRow: 1,
      columnBindings: ['email', 'roster.result', 'roster.notes'].map((fieldId, index) => ({ id: `field-${index}`,
        sourceColumn: index, sourceHeader: fieldId, fieldId, basis: 'manual' })),
      rows: [{ id: 'header', cells: ['email', 'roster.result', 'roster.notes'].map(value => ({ value })) },
        { id: 'alice', cells: [{ value: 'alice@example.test' }, { value: null }, { value: null }] },
        { id: 'bob', cells: [{ value: 'bob@example.test' }, { value: null }, { value: null }] }] }] });
  const captured = (operationId: string) => ({ operationId, at,
    source: { kind: 'run-reference' as const, runId: '10000000-0000-4000-8000-000000000001', referenceDigest: 'a'.repeat(64),
      authority: { versionId: 'original', sheetId: 'people', keyFieldId: 'email',
        requiredFields: ['email', 'roster.result', 'roster.notes'], writableFields: ['roster.result'] } },
    change: { kind: 'patch' as const, key: 'alice@example.test', values: { 'roster.result': 'complete' },
      expectedVersion: 1, selection: { sheetId: 'people', rowId: 'alice', expectedVersion: 1 } } });
  return { ...f, id: saved.libraryId, captured };
}
it('syncs General mapped rows only with captured key proof and retains operator cells across reordered IDs and headers', () => {
  const f = generalFixture();
  expect(f.repository.operation(f.id, f.captured('captured-fill'))).toMatchObject({ state: 'applied' });
  const filled = f.service.read(f.id), edited = structuredClone(filled.workbook);
  edited.sheets[0].rows[1].cells[2].value = 'operator';
  const saved = f.service.save(f.id, filled.version, edited), incoming = encodeSavedWorkbook(saved).workbook;
  const sheet = incoming.sheets[0];
  sheet.rows = [sheet.rows[0], sheet.rows[2], sheet.rows[1]].map((row, index) => ({ ...row, id: `remote-${index}` }));
  sheet.rows.forEach(row => { row.cells = [row.cells[2], row.cells[0], row.cells[1]]; });
  delete sheet.columnBindings;
  sheet.rows[2].cells[0].value = 'remote-note'; sheet.rows[2].cells[2].value = 'remote-result';
  const operation = { operationId: 'general-sync', source: { kind: 'sync' as const, syncId: 'general-sync' }, at,
    change: { kind: 'sync' as const, expectedVersion: saved.version, workbook: incoming } };
  expect(f.repository.operation(f.id, operation)).toMatchObject({ state: 'applied' });
  const synced = f.service.read(f.id);
  expect(synced.workbook.sheets[0].rows[2].cells.map(cell => cell.value)).toEqual(['operator', 'alice@example.test', 'complete']);
  expect(f.service.revision(f.id, saved.version)).toEqual(saved);
  expect(f.repository.operation(f.id, operation)).toMatchObject({ state: 'applied' });
  expect(f.service.read(f.id)).toEqual(synced);
});
it('refuses General owned sync when a captured key is removed or duplicated without changing the workbook', () => {
  const f = generalFixture(); f.repository.operation(f.id, f.captured('captured-fill'));
  const before = f.service.read(f.id);
  for (const [id, mutate] of [
    ['removed', (workbook: ReturnType<typeof encodeSavedWorkbook>['workbook']) => { workbook.sheets[0].rows[1].cells[0].value = 'other@example.test'; }],
    ['duplicate', (workbook: ReturnType<typeof encodeSavedWorkbook>['workbook']) => { workbook.sheets[0].rows[2].cells[0].value = 'alice@example.test'; }],
  ] as const) {
    const incoming = encodeSavedWorkbook(before).workbook; delete incoming.sheets[0].columnBindings; mutate(incoming);
    expect(f.repository.operation(f.id, { operationId: `general-${id}`, source: { kind: 'sync', syncId: id }, at,
      change: { kind: 'sync', expectedVersion: before.version, workbook: incoming } })).toMatchObject({ state: 'resolve-required', reason: 'sync-ambiguous' });
    expect(f.service.read(f.id)).toEqual(before);
  }
});
it('restores a verified missing output header and keeps unrelated new sheets unmapped in General Sync', () => {
  const f = generalFixture(); f.repository.operation(f.id, f.captured('captured-fill'));
  const before = f.service.read(f.id), incoming = encodeSavedWorkbook(before).workbook;
  const sheet = incoming.sheets[0]; delete sheet.columnBindings;
  sheet.rows.forEach(row => { row.cells.splice(1, 1); }); sheet.width = 2;
  incoming.sheets.push({ id: 'remote-extra', name: 'Remote extra', width: 1, hidden: [],
    rows: [{ id: 'extra-header', cells: [{ value: 'Unmapped' }] }, { id: 'extra-row', cells: [{ value: 'remote' }] }] });
  const result = f.repository.operation(f.id, { operationId: 'missing-output-sync', source: { kind: 'sync', syncId: 'missing-output-sync' }, at,
    change: { kind: 'sync', expectedVersion: before.version, workbook: incoming } });
  expect(result.state).toBe('applied');
  const after = f.service.read(f.id).workbook;
  expect(after.sheets[0].columnBindings?.find(binding => binding.fieldId === 'roster.result')?.sourceHeader).toBe('roster.result');
  expect(after.sheets[0].rows[1].cells.at(-1)?.value).toBe('complete');
  expect(after.sheets[1].columnBindings).toBeUndefined();
});
it('carries a historical keyed owner through legacy Sync before a captured patch enables scoped Sync', () => {
  const f = fixture();
  expect(f.repository.operation(f.id, f.patch('legacy-bob', '002', 'legacy'))).toMatchObject({ state: 'applied' });
  const first = f.service.read(f.id), legacyIncoming = encodeSavedWorkbook(first).workbook;
  legacyIncoming.sheets[0].rows[2].id = 'remote-bob';
  expect(f.repository.operation(f.id, { operationId: 'legacy-sync', source: { kind: 'sync', syncId: 'legacy-sync' }, at,
    change: { kind: 'sync', expectedVersion: first.version, workbook: legacyIncoming } })).toMatchObject({ state: 'applied' });
  const afterLegacy = f.service.read(f.id);
  const captured = { operationId: 'captured-alice', at, source: { kind: 'run-reference' as const, runId: '10000000-0000-4000-8000-000000000001',
    referenceDigest: 'a'.repeat(64), authority: { versionId: 'original', sheetId: 'people', keyFieldId: 'eid',
      requiredFields: ['eid', 'roster.notes'], writableFields: ['roster.notes'] } },
    change: { kind: 'patch' as const, key: '001', values: { 'roster.notes': 'captured' },
      expectedVersion: afterLegacy.version, selection: { sheetId: 'people', rowId: 'alice', expectedVersion: afterLegacy.version } } };
  expect(f.repository.operation(f.id, captured)).toMatchObject({ state: 'applied' });
  const before = f.service.read(f.id), incoming = encodeSavedWorkbook(before).workbook;
  incoming.sheets[0].rows[1].id = 'new-alice'; incoming.sheets[0].rows[2].id = 'new-bob';
  incoming.sheets[0].rows[0].cells = ['eid', 'roster.legalName', 'roster.notes'].map(value => ({ value }));
  delete incoming.sheets[0].columnBindings;
  expect(f.repository.operation(f.id, { operationId: 'scoped-sync', source: { kind: 'sync', syncId: 'scoped-sync' }, at,
    change: { kind: 'sync', expectedVersion: before.version, workbook: incoming } })).toMatchObject({ state: 'applied' });
  const after = f.service.read(f.id);
  expect(after.workbook.sheets[0].rows[1].cells[2].value).toBe('captured');
  expect(after.workbook.sheets[0].rows[2].cells[2].value).toBe('legacy');
  expect(f.service.revision(f.id, before.version)).toEqual(before);
});
it('refuses scoped Sync when two differently keyed old rows would merge into one incoming row', () => {
  const f = open();
  const saved = f.service.create({ name: 'Dual keys.xlsx', themes: [], hasFormulas: false,
    sheets: [{ id: 'people', name: 'People', width: 4, hidden: [], headerRow: 1,
      columnBindings: ['email', 'eid', 'roster.result', 'roster.notes'].map((fieldId, index) => ({ id: `field-${index}`,
        sourceColumn: index, sourceHeader: fieldId, fieldId, basis: 'manual' })),
      rows: [{ id: 'header', cells: ['email', 'eid', 'roster.result', 'roster.notes'].map(value => ({ value })) },
        { id: 'alice', cells: [{ value: 'alice@example.test' }, { value: '001' }, { value: null }, { value: null }] },
        { id: 'bob', cells: [{ value: 'bob@example.test' }, { value: '002' }, { value: null }, { value: null }] }] }] });
  const fill = (operationId: string, rowId: string, keyFieldId: string, key: string, field: string, expectedVersion: number) => ({
    operationId, at, source: { kind: 'run-reference' as const, runId: '10000000-0000-4000-8000-000000000001', referenceDigest: 'a'.repeat(64),
      authority: { versionId: 'original', sheetId: 'people', keyFieldId,
        requiredFields: ['email', 'eid', 'roster.result', 'roster.notes'], writableFields: [field] } },
    change: { kind: 'patch' as const, key, values: { [field]: operationId }, expectedVersion,
      selection: { sheetId: 'people', rowId, expectedVersion } } });
  expect(f.repository.operation(saved.libraryId, fill('alice-result', 'alice', 'email', 'alice@example.test', 'roster.result', 1))).toMatchObject({ state: 'applied' });
  expect(f.repository.operation(saved.libraryId, fill('bob-notes', 'bob', 'eid', '002', 'roster.notes', 2))).toMatchObject({ state: 'applied' });
  const before = f.service.read(saved.libraryId), incoming = encodeSavedWorkbook(before).workbook;
  delete incoming.sheets[0].columnBindings;
  incoming.sheets[0].rows[1].cells[1].value = '002';
  incoming.sheets[0].rows[2].cells[1].value = '001';
  expect(f.repository.operation(saved.libraryId, { operationId: 'collision-sync', source: { kind: 'sync', syncId: 'collision-sync' }, at,
    change: { kind: 'sync', expectedVersion: before.version, workbook: incoming } })).toMatchObject({ state: 'resolve-required', reason: 'sync-ambiguous' });
  expect(f.service.read(saved.libraryId)).toEqual(before);
});
it('keeps one master, manual named snapshots and independent immutable creation after reopen', () => {
  const root = mkdtempSync(join(tmpdir(), 'relay-master-')); roots.push(root); const path = join(root, 'db.sqlite');
  const f = fixture(path), initial = f.repository.creation(f.id);
  const write = f.patch('fill', '001', 'first'), receipt = f.repository.operation(f.id, write);
  expect(receipt.state).toBe('applied'); expect(f.repository.versions(f.id)).toEqual([]);
  f.service.operatorOperation(f.id, 'version', { kind: 'version', expectedVersion: 3, name: 'Reviewed' });
  f.repository.operation(f.id, f.patch('second', '001', 'second'));
  const reopened = open(path, false);
  expect(reopened.repository.creation(f.id)).toEqual(initial);
  expect(reopened.repository.operation(f.id, write)).toEqual(receipt);
  expect(reopened.repository.versions(f.id)[0]).toMatchObject({ name: 'Reviewed', provenance: 'operator', snapshot: { version: 3 } });
  expect(reopened.repository.versions(f.id)[0].snapshot.workbook.sheets[0].rows[1].cells[2].value).toBe('first');
  expect(reopened.repository.read(f.id)?.workbook.sheets[0].rows[1].cells[2].value).toBe('second');
  expect(() => reopened.repository.operation(f.id, f.patch('fill', '001', 'changed'))).toThrow(expect.objectContaining({ code: 'WORKBOOK_OPERATION_CONFLICT' }));
  expect(validateWorkbookLibrary(reopened.database)).toBeGreaterThan(0);
});
it.each(['hasFormulas', 'unsupportedMetadata'] as const)('refuses master edits when imported %s cannot be preserved', field => {
  const f = fixture();
  const source = f.service.read(f.id).workbook;
  const saved = f.service.create({ ...source, libraryId: undefined, [field]: true });
  expect(() => f.service.save(saved.libraryId, saved.version, { ...saved.workbook, name: 'Edited.xlsx', [field]: false }))
    .toThrow(expect.objectContaining({ code: 'WORKBOOK_METADATA_UNSUPPORTED' }));
  const result = f.repository.operation(saved.libraryId, f.patch(`blocked-${field}`, '001', 'unsafe'));
  expect(result).toMatchObject({ state: 'refused', reason: 'metadata-unsupported' });
  expect(f.service.read(saved.libraryId)).toEqual(saved);
});
it('imports the default font and document timestamps and saves an edited master', async () => {
  const source = new Workbook();
  source.properties.created = new Date('2026-11-01T00:00:00.000Z');
  source.properties.modified = new Date(at);
  source.addWorksheet('People').getCell('A1').value = 'Original';
  const bytes = writeXlsx(source);
  const data = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(data).set(bytes);
  const imported = await importWorkbook('Default.xlsx', data);
  expect(imported.unsupportedMetadata).not.toBe(true);
  expect(imported.hasFormulas).toBe(false);
  const f = open(), saved = f.service.create(imported), edited = structuredClone(saved.workbook);
  edited.sheets[0].rows[0].cells[0].value = 'Edited';
  const updated = f.service.save(saved.libraryId, saved.version, edited);
  expect(updated.version).toBe(saved.version + 1);
  expect(f.service.read(saved.libraryId).workbook.sheets[0].rows[0].cells[0].value).toBe('Edited');
});
it('settles missing and duplicate keys without effects and continues FIFO after resolve-required', () => {
  const f = fixture();
  const before = f.repository.read(f.id);
  const missing = f.repository.enqueue(f.id, f.patch('missing', 'absent', 'bad'));
  const next = f.repository.enqueue(f.id, f.patch('next', '001', 'good'));
  expect(missing).toBeLessThan(next); f.repository.drain(f.id);
  expect(f.repository.journal(f.id).slice(-2).map(receipt => receipt.state)).toEqual(['resolve-required', 'applied']);
  expect(f.repository.journal(f.id).at(-2)?.version).toBe(before?.version);
  const live = f.service.read(f.id), workbook = structuredClone(live.workbook);
  workbook.sheets[0].rows.push({ ...structuredClone(workbook.sheets[0].rows[1]), id: 'duplicate' });
  f.service.save(f.id, live.version, workbook);
  expect(f.repository.operation(f.id, f.patch('duplicate', '001', 'bad'))).toMatchObject({ state: 'resolve-required', reason: 'duplicate-key' });
});
it('settles an oversized add without changing content or ownership and drains the following patch', () => {
  const f = fixture();
  const saved = f.service.create({ name: 'At limit.xlsx', themes: [], hasFormulas: false, sheets: [{ id: 'wide', name: 'People', width: 1000, hidden: [], headerRow: 1,
    columnBindings: Array.from({ length: 1000 }, (_, i) => ({ id: `column-${i}`, sourceColumn: i, sourceHeader: i === 0 ? 'EID' : i === 1 ? 'Notes' : '',
      fieldId: i === 0 ? 'eid' : i === 1 ? 'roster.notes' : null, basis: i < 2 ? 'manual' : 'unmapped' })),
    rows: Array.from({ length: 250 }, (_, row) => ({ id: `row-${row}`, cells: Array.from({ length: 1000 }, (_, column) => ({ value: column === 0 ? row === 0 ? 'EID' : `person-${row}` : row === 1 && column === 1 ? null : 'retained' })) })),
  }] });
  f.service.operatorOperation(saved.libraryId, 'wide-type', { kind: 'metadata', expectedVersion: 1, metadata: { typeId: 'roster', sharePoint: null } });
  const before = f.service.read(saved.libraryId), owners = () => f.database.prepare('SELECT ownership_json FROM workbook_library WHERE id=?').get(saved.libraryId);
  const beforeOwners = owners();
  const oversized = f.repository.enqueue(saved.libraryId, f.operation('too-large', { kind: 'add', sheetId: 'wide', rowId: 'extra', key: 'new-person', values: { 'roster.notes': 'unsafe' } }));
  f.repository.drain(saved.libraryId);
  expect(f.repository.journal(saved.libraryId).at(-1)).toMatchObject({ sequence: oversized, state: 'refused', reason: 'invalid', version: before.version, changes: [] });
  expect(f.service.read(saved.libraryId)).toEqual(before); expect(owners()).toEqual(beforeOwners);
  const following = f.repository.enqueue(saved.libraryId, f.patch('after-oversized', 'person-1', 'good'));
  f.repository.drain(saved.libraryId);
  expect(following).toBeGreaterThan(oversized);
  expect(f.repository.journal(saved.libraryId).at(-1)).toMatchObject({ sequence: following, state: 'applied', version: before.version + 1 });
  expect(f.service.read(saved.libraryId).workbook.sheets[0].rows[1].cells[1].value).toBe('good');
  expect(f.database.prepare('SELECT COUNT(*) AS n FROM workbook_operations WHERE workbook_id=? AND receipt_json IS NULL').get(saved.libraryId)?.n).toBe(0);
});
it.each([
  ['standalone', '', false],
  ['cached formula', '<f>NA()</f>', true],
] as const)('imports a %s OOXML error cell as display text and refuses master edits', async (_kind, formula, hasFormulas) => {
  const { default: JSZip } = await import('jszip');
  const { writeWorkbookXlsx } = await import('../../../src/rules/spreadsheets/workbook-io.js');
  const f = fixture(), source = f.service.read(f.id).workbook;
  const archive = await JSZip.loadAsync(await writeWorkbookXlsx(source));
  const sheet = archive.file('xl/worksheets/sheet1.xml')!;
  archive.file(sheet.name, (await sheet.async('string')).replace(/<c\b[^>]*\br="A1"[^>]*>[\s\S]*?<\/c>/u, `<c r="A1" t="e">${formula}<v>#N/A</v></c>`));
  const imported = await importWorkbook('Error.xlsx', await archive.generateAsync({ type: 'arraybuffer' }));
  expect(imported.sheets[0].rows[0].cells[0].value).toBe('#N/A');
  expect(imported.hasFormulas).toBe(hasFormulas); expect(imported.unsupportedMetadata).toBe(true);
  const saved = f.service.create(imported);
  expect(saved.workbook.sheets[0].rows[0].cells[0].value).toBe('#N/A');
  expect(() => f.service.save(saved.libraryId, saved.version, { ...saved.workbook, hasFormulas: false, unsupportedMetadata: false }))
    .toThrow(expect.objectContaining({ code: 'WORKBOOK_METADATA_UNSUPPORTED' }));
  expect(f.service.read(saved.libraryId)).toEqual(saved);
});
it('retains operator clears as tombstones and rechecks live row selection and field identity', () => {
  const f = fixture(); f.repository.operation(f.id, f.patch('fill', '001', 'filled'));
  const current = f.service.read(f.id), workbook = structuredClone(current.workbook);
  workbook.sheets[0].rows = [current.workbook.sheets[0].rows[0], current.workbook.sheets[0].rows[2], current.workbook.sheets[0].rows[1]].map(row => structuredClone(row));
  workbook.sheets[0].headerRow = 1; workbook.sheets[0].rows[2].cells[2].value = '';
  const edited = f.service.save(f.id, current.version, workbook);
  expect(f.repository.operation(f.id, f.patch('refill', '001', 'bad'))).toMatchObject({ state: 'resolve-required', reason: 'operator-edited' });
  expect(f.repository.operation(f.id, f.operation('select', { kind: 'patch', key: '001', values: { 'roster.notes': 'bad' }, selection: { sheetId: 'people', rowId: 'alice', expectedVersion: current.version } }))).toMatchObject({ reason: 'stale-selection' });
  expect(f.service.read(f.id)).toEqual(edited);
});
it('rolls back content, ownership and receipt together while retaining pending admission for recovery', () => {
  const f = fixture(), before = f.service.read(f.id);
  const owners = f.database.prepare('SELECT ownership_json FROM workbook_library').get();
  f.database.exec("CREATE TRIGGER injected BEFORE UPDATE OF receipt_json ON workbook_operations BEGIN SELECT RAISE(ABORT,'injected'); END");
  expect(() => f.repository.operation(f.id, f.patch('fill', '001', 'value'))).toThrow();
  expect(f.service.read(f.id)).toEqual(before);
  expect(f.database.prepare('SELECT ownership_json FROM workbook_library').get()).toEqual(owners);
  expect(f.repository.journal(f.id)).toHaveLength(1);
  f.database.exec('DROP TRIGGER injected'); f.repository.drain(f.id);
  expect(f.repository.journal(f.id).at(-1)?.state).toBe('applied');
});
it('retains typed-reader snapshots of requested keys with immutable wire dates and exact worksheet membership', () => {
  const f = fixture(); const snapshot = f.repository.snapshot({ typeId: 'roster', libraryId: f.id, keys: ['001', 'absent'], fields: ['roster.legalName'] });
  expect(snapshot.rows[0]).toMatchObject({ key: '001', state: 'matched', matches: [{ sheetId: 'people', rowId: 'alice', values: { 'roster.legalName': { type: 'date', value: '2000-01-01T00:00:00.000Z' } } }] });
  expect(snapshot.rows[1]).toEqual({ key: 'absent', state: 'missing', matches: [] });
  f.repository.operation(f.id, f.patch('fill', '001', 'new'));
  expect(snapshot.version).toBe(2); expect(Object.isFrozen(snapshot.rows[0].matches[0].values['roster.legalName'])).toBe(true);
});
it('reconstructs exact revisions across type assignment, run ownership, refusals, operator saves and Sync', () => {
  const f = fixture(), records = [f.repository.creation(f.id)!, f.service.read(f.id)];
  expect(f.repository.operation(f.id, f.patch('relay-first', '001', 'relay'))).toMatchObject({ state: 'applied' });
  records.push(f.service.read(f.id));
  f.service.operatorOperation(f.id, 'named', { kind: 'version', expectedVersion: 3, name: 'Reviewed' });
  expect(f.repository.operation(f.id, f.patch('missing', 'absent', 'never'))).toMatchObject({ state: 'resolve-required' });
  const edited = structuredClone(records[2].workbook); edited.sheets[0].rows[1].cells[2].value = '';
  records.push(f.service.save(f.id, 3, edited));
  expect(f.repository.operation(f.id, f.patch('operator-clear', '001', 'never'))).toMatchObject({ state: 'resolve-required', reason: 'operator-edited' });
  const incoming = encodeSavedWorkbook(records[3]).workbook;
  incoming.sheets[0].rows[1].cells[2].value = 'remote'; incoming.sheets[0].rows[2].cells[1].value = 'Bobby';
  expect(f.repository.operation(f.id, { operationId: 'sync-replay', source: { kind: 'sync', syncId: 'sync-replay' }, at,
    change: { kind: 'sync', expectedVersion: 4, workbook: incoming } })).toMatchObject({ state: 'applied' });
  records.push(f.service.read(f.id));
  const last = structuredClone(records[4].workbook); last.name = 'Later.xlsx'; f.service.save(f.id, 5, last);
  const before = f.service.read(f.id), journal = f.repository.journal(f.id);
  for (const record of records) expect(f.service.revision(f.id, record.version)).toEqual(record);
  expect(f.service.revision(f.id, before.version)).toEqual(before);
  expect(f.service.history(f.id).map(record => record.version)).toEqual([3]);
  expect(f.repository.journal(f.id)).toEqual(journal); expect(f.service.read(f.id)).toEqual(before);
  expect(() => f.service.revision(f.id, before.version + 1)).toThrow(expect.objectContaining({ code: 'WORKBOOK_REVISION_UNAVAILABLE' }));
});
it.each(['digest', 'identity', 'receipt'] as const)('refuses unprovable old revisions with a corrupt journal %s', corruption => {
  const f = fixture(); f.repository.operation(f.id, f.patch('first', '001', 'first')); f.repository.operation(f.id, f.patch('second', '001', 'second'));
  f.database.exec('DROP TRIGGER workbook_operations_immutable');
  if (corruption === 'digest') f.database.prepare("UPDATE workbook_operations SET digest='wrong' WHERE workbook_id=? AND operation_id='first'").run(f.id);
  else if (corruption === 'identity') f.database.prepare("UPDATE workbook_operations SET operation_id='foreign' WHERE workbook_id=? AND operation_id='first'").run(f.id);
  else f.database.prepare("UPDATE workbook_operations SET receipt_json=json_set(receipt_json,'$.version',99) WHERE workbook_id=? AND operation_id='first'").run(f.id);
  expect(() => f.service.revision(f.id, 3)).toThrow(expect.objectContaining({ code: 'WORKBOOK_STORAGE_CORRUPT' }));
});
it('reconciles manual Sync under the same writer and preserves managed cell metadata and operator intent', async () => {
  const f = fixture(); f.repository.operation(f.id, f.patch('fill', '001', 'relay'));
  const live = f.service.read(f.id), changed = structuredClone(live.workbook);
  changed.sheets[0].rows[1].cells[2] = { value: 'operator', numFmt: '@', fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF123456' } } };
  const edited = f.service.save(f.id, live.version, changed);
  const incoming = encodeSavedWorkbook(edited).workbook; incoming.sheets[0].rows[1].cells[2] = { value: 'remote' };
  const result = f.repository.operation(f.id, { operationId: 'sync', source: { kind: 'sync', syncId: 'sync' }, at, change: { kind: 'sync', expectedVersion: edited.version, workbook: incoming } });
  expect(result.state).toBe('applied'); expect(f.service.read(f.id).workbook.sheets[0].rows[1].cells[2]).toEqual(changed.sheets[0].rows[1].cells[2]);
  expect(f.repository.versions(f.id)).toEqual([]);
  await expect(f.service.sync(f.id, 'unlinked', new AbortController().signal)).rejects.toMatchObject({ code: 'WORKBOOK_SYNC_LINK_REQUIRED' });
});
it('journals operator additions and keyed Sync changes after rows receive new import IDs', () => {
  const f = fixture();
  const current = f.service.read(f.id), expanded = structuredClone(current.workbook);
  expanded.sheets[0].rows.push({ id: 'carol', cells: [{ value: '003' }, { value: 'Carol' }, { value: '' }] });
  const saved = f.service.save(f.id, current.version, expanded);
  const saveChanges = f.repository.journal(f.id).at(-1)?.changes ?? [];
  expect(saveChanges).toContainEqual(expect.objectContaining({ key: '003', fieldId: 'roster.legalName', oldValue: null, newValue: 'Carol' }));
  const incoming = encodeSavedWorkbook(saved).workbook;
  incoming.sheets[0].rows[1].id = 'import-bob';
  incoming.sheets[0].rows[1].cells = [{ value: '002' }, { value: 'Bobby' }, { value: '' }];
  incoming.sheets[0].rows[2].id = 'import-alice';
  incoming.sheets[0].rows[2].cells = [{ value: '001' }, { value: { type: 'date', value: IsoInstantSchema.parse('2000-01-01T00:00:00.000Z') } }, { value: '' }];
  incoming.sheets[0].rows.splice(3, 1);
  const receipt = f.repository.operation(f.id, { operationId: 'sync-reordered', source: { kind: 'sync', syncId: 'sync-reordered' }, at,
    change: { kind: 'sync', expectedVersion: saved.version, workbook: incoming } });
  expect(receipt.state).toBe('applied');
  expect(receipt.changes).toContainEqual(expect.objectContaining({ key: '002', fieldId: 'roster.legalName', oldValue: 'Bob', newValue: 'Bobby' }));
  expect(receipt.changes).toContainEqual(expect.objectContaining({ key: '003', fieldId: 'roster.legalName', oldValue: 'Carol', newValue: null }));
  expect(receipt.changes).not.toContainEqual(expect.objectContaining({ key: '001', fieldId: 'roster.legalName', oldValue: null }));
});
it('adds the row key once whether or not the run repeats it in values', () => {
  const f = fixture();
  const add = (operationId: string, values: Record<string, string>) => f.operation(operationId,
    { kind: 'add', sheetId: 'people', rowId: operationId, key: '003', values });
  const first = f.repository.operation(f.id, add('new-row', { eid: '003', 'roster.notes': 'ready' }));
  expect(first.state).toBe('applied');
  expect(first.changes.filter(change => change.fieldId === 'eid')).toEqual([
    expect.objectContaining({ key: '003', oldValue: null, newValue: '003' }),
  ]);
  expect(f.repository.operation(f.id, add('second-row', { 'roster.notes': 'duplicate' }))).toMatchObject({ state: 'resolve-required', reason: 'duplicate-key' });
  expect(f.repository.operation(f.id, f.operation('bad-key', { kind: 'add', sheetId: 'people', rowId: 'bad-key', key: '004', values: { eid: 'wrong' } }))).toMatchObject({ state: 'refused', reason: 'invalid' });
  expect(f.service.read(f.id).workbook.sheets[0].rows).toHaveLength(4);
});
it('migrates every retained revision with explicit migration provenance without changing masters', () => {
  const db = new DatabaseSync(':memory:'); databases.push(db);
  for (const sql of WORKBOOK_LIBRARY_MIGRATION.statements) db.exec(sql);
  const f = fixture(), first = f.repository.creation(f.id)!;
  db.prepare('INSERT INTO workbook_library(id,version,created_at,saved_at,payload_json) VALUES(?,?,?,?,?)').run(first.libraryId, 2, first.createdAt, first.savedAt, JSON.stringify(encodeSavedWorkbook({ ...first, version: 2 })));
  for (const record of [first, { ...first, version: 2 }]) {
    const json = JSON.stringify(encodeSavedWorkbook(record));
    db.prepare('INSERT INTO workbook_library_history(workbook_id,version,created_at,saved_at,payload_json) VALUES(?,?,?,?,?)').run(record.libraryId, record.version, record.createdAt, record.savedAt, json);
  }
  for (const sql of [...WORKBOOK_MASTER_MIGRATION.statements, ...WORKBOOK_LIBRARY_CATALOG_MIGRATION.statements, ...WORKBOOK_LIBRARY_PIN_TAGS_MIGRATION.statements]) db.exec(sql);
  expect(db.prepare('SELECT name,provenance,version FROM workbook_library_history ORDER BY version').all()).toEqual([
    { name: 'Saved revision 1', provenance: 'migration', version: 1 }, { name: 'Saved revision 2', provenance: 'migration', version: 2 }]);
  expect(validateWorkbookLibrary(db)).toBeGreaterThan(0);
  const repository = createWorkbookLibraryRepository({ database: db, read: work => work(), mutate: work => work().result });
  const service = createWorkbookLibraryService({ sync: unexpectedWorkbookSync, repository, clock: manualClock(new Date(at)) });
  const baseline = service.read(first.libraryId), edited = structuredClone(baseline.workbook); edited.name = 'Post migration.xlsx';
  service.save(first.libraryId, baseline.version, edited);
  expect(service.revision(first.libraryId, 1)).toEqual(first);
  expect(service.revision(first.libraryId, 2)).toEqual({ ...first, version: 2 });
  const latest = service.read(first.libraryId), later = structuredClone(latest.workbook); later.name = 'Later.xlsx'; service.save(first.libraryId, latest.version, later);
  expect(service.revision(first.libraryId, 3)).toEqual(latest);
  expect(service.versions(first.libraryId).map(entry => entry.provenance)).toEqual(['migration', 'migration']);
});

it('drains acknowledged durable admissions from two processes in FIFO order after an owned writer hold', async () => {
  const { fork } = await import('node:child_process');
  const { once } = await import('node:events');
  const { testProcessImport } = await import('../../support/compiled-process.js');
  const root = mkdtempSync(join(tmpdir(), 'relay-workbook-fifo-')); roots.push(root);
  const path = join(root, 'db.sqlite'), f = fixture(path);
  const peer = (op: WorkbookOperation) => fork(new URL('../../support/processes/workbook-queue-peer.ts', import.meta.url), [path, f.id, JSON.stringify(op)], { execArgv: ['--import', testProcessImport()], stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  const first = peer(f.patch('first-peer', '001', 'first'));
  const admission = z.object({ state: z.literal('admitted'), sequence: z.number().int().positive() }).strict();
  const admitted = async (child: ReturnType<typeof peer>) => {
    const message: unknown = (await once(child, 'message'))[0];
    return admission.parse(message);
  };
  const exited = async (child: ReturnType<typeof peer>) => {
    const code: unknown = (await once(child, 'exit'))[0];
    return z.number().int().nullable().parse(code);
  };
  let second: ReturnType<typeof peer> | undefined;
  try {
    const admitted1 = await admitted(first);
    second = peer(f.patch('second-peer', '001', 'second'));
    const admitted2 = await admitted(second);
    expect(admitted1.state).toBe('admitted'); expect(admitted2.state).toBe('admitted');
    expect(admitted1.sequence).toBeLessThan(admitted2.sequence);
    f.database.exec('BEGIN IMMEDIATE');
    const completed = Promise.all([exited(first), exited(second)]);
    first.send('drain'); second.send('drain');
    // The owned transaction prevents either peer from applying its queued write.
    expect(f.database.prepare("SELECT COUNT(*) AS n FROM workbook_operations WHERE receipt_json IS NULL").get()?.n).toBe(2);
    f.database.exec('COMMIT');
    expect(await completed).toEqual([0, 0]);
    const receipts = f.repository.journal(f.id).slice(-2);
    expect(receipts.map(receipt => receipt.operationId)).toEqual(['first-peer', 'second-peer']);
    expect(receipts[1].changes[0]).toMatchObject({ oldValue: 'first', newValue: 'second' });
    expect(f.service.read(f.id).workbook.sheets[0].rows[1].cells[2].value).toBe('second');
  } finally {
    if (f.database.isTransaction) f.database.exec('ROLLBACK');
    for (const child of [first, second]) if (child && child.exitCode === null) { child.kill(); await once(child, 'exit'); }
  }
});

async function numericKeys() {
  const source = new Workbook();
  source.addWorksheet('People').addRows([['EID', 'Legal name', 'Notes'], [10800000, 'Alice', null], [10800001, 'Bob', null], ['00108', 'Padded', null]]);
  const bytes = writeXlsx(source), data = new ArrayBuffer(bytes.byteLength); new Uint8Array(data).set(bytes);
  const imported = await importWorkbook('Numeric.xlsx', data);
  const f = fixture();
  const saved = f.service.create({ ...imported, sheets: imported.sheets.map(sheet => ({ ...sheet, headerRow: 1,
    columnBindings: ['eid', 'roster.legalName', 'roster.notes'].map((fieldId, column) => ({ id: `binding-${column}`, sourceColumn: column, sourceHeader: ['EID', 'Legal name', 'Notes'][column], fieldId, basis: 'manual' })) })) });
  f.service.operatorOperation(saved.libraryId, 'numeric-type', { kind: 'metadata', expectedVersion: 1, metadata: { typeId: 'roster', sharePoint: null } });
  return { ...f, id: saved.libraryId };
}
it('patches imported numeric keys, prevents adding an existing numeric key and journals its stable key', async () => {
  const f = await numericKeys(), before = f.service.read(f.id), sheet = before.workbook.sheets[0];
  expect(sheet.rows[1].cells[0].value).toBe(10800000);
  const result = f.repository.operation(f.id, f.patch('numeric-patch', '10800000', 'filled'));
  expect(result).toMatchObject({ state: 'applied', key: '10800000', changes: [{ key: '10800000', fieldId: 'roster.notes', oldValue: null, newValue: 'filled' }] });
  expect(f.service.read(f.id).workbook.sheets[0].rows[1].cells[2].value).toBe('filled');
  const current = f.service.read(f.id);
  expect(f.service.revision(f.id, before.version)).toEqual(before);
  expect(f.service.revision(f.id, current.version)).toEqual(current);
  expect(f.repository.operation(f.id, f.patch('numeric-patch', '10800000', 'filled'))).toEqual(result);
  expect(f.repository.operation(f.id, f.operation('numeric-add', { kind: 'add', sheetId: sheet.id, rowId: 'duplicate', key: '10800000', values: { 'roster.notes': 'new' } })))
    .toMatchObject({ state: 'resolve-required', reason: 'duplicate-key' });
  expect(f.service.read(f.id)).toEqual(current);
  const snapshot = f.repository.snapshot({ libraryId: f.id, typeId: 'roster', keys: ['10800000', '00108', '108'], fields: ['eid', 'roster.legalName'] });
  expect(snapshot.rows).toEqual([
    { key: '10800000', state: 'matched', matches: [{ sheetId: sheet.id, rowId: sheet.rows[1].id, values: { eid: 10800000, 'roster.legalName': 'Alice' } }] },
    { key: '00108', state: 'matched', matches: [{ sheetId: sheet.id, rowId: sheet.rows[3].id, values: { eid: '00108', 'roster.legalName': 'Padded' } }] },
    { key: '108', state: 'missing', matches: [] },
  ]);
});
it('reconciles numeric keys across Sync reordering and retains Relay and operator ownership with keyed journal entries', async () => {
  const f = await numericKeys();
  expect(f.repository.operation(f.id, f.patch('numeric-fill', '10800000', 'relay'))).toMatchObject({ state: 'applied' });
  const current = f.service.read(f.id), edited = structuredClone(current.workbook);
  edited.sheets[0].rows[2].cells[2].value = 'operator';
  const saved = f.service.save(f.id, current.version, edited), incoming = encodeSavedWorkbook(saved).workbook;
  const sheet = incoming.sheets[0];
  sheet.rows = [sheet.rows[0], sheet.rows[2], sheet.rows[1], sheet.rows[3]].map((row, index) => ({ ...row, id: index === 0 ? row.id : `remote-${index}` }));
  sheet.rows[1].cells[2].value = 'remote-bob'; sheet.rows[2].cells[2].value = 'remote-alice';
  sheet.rows[2].cells[1].value = 'Alice remote';
  const result = f.repository.operation(f.id, { operationId: 'numeric-sync', source: { kind: 'sync', syncId: 'numeric-sync' }, at,
    change: { kind: 'sync', expectedVersion: saved.version, workbook: incoming } });
  expect(result).toMatchObject({ state: 'applied', changes: [{ key: '10800000', fieldId: 'roster.legalName', oldValue: 'Alice', newValue: 'Alice remote' }] });
  const syncedRecord = f.service.read(f.id), synced = syncedRecord.workbook.sheets[0];
  expect(synced.rows[1].cells[2].value).toBe('operator'); expect(synced.rows[2].cells[2].value).toBe('relay');
  expect(f.repository.operation(f.id, f.patch('numeric-after-sync', '10800000', 'relay-next'))).toMatchObject({ state: 'applied' });
  expect(f.repository.operation(f.id, f.patch('numeric-operator-after-sync', '10800001', 'unsafe'))).toMatchObject({ state: 'resolve-required', reason: 'operator-edited' });
  const latest = f.service.read(f.id);
  for (const record of [current, saved, syncedRecord, latest]) expect(f.service.revision(f.id, record.version)).toEqual(record);
  expect(f.repository.operation(f.id, { operationId: 'numeric-sync', source: { kind: 'sync', syncId: 'numeric-sync' }, at,
    change: { kind: 'sync', expectedVersion: saved.version, workbook: incoming } })).toEqual(result);
  expect(f.service.read(f.id)).toEqual(latest);
});
it('refuses numeric/string key collisions across patch, add, snapshot and owned Sync', async () => {
  const f = await numericKeys();
  expect(f.repository.operation(f.id, f.patch('before-collision', '10800000', 'owned'))).toMatchObject({ state: 'applied' });
  const current = f.service.read(f.id), duplicate = structuredClone(current.workbook), sheet = duplicate.sheets[0];
  sheet.rows.push({ id: 'collision', cells: [{ value: '10800000' }, { value: 'Other' }, { value: null }] });
  const incoming = encodeSavedWorkbook({ ...current, workbook: duplicate }).workbook;
  expect(f.repository.operation(f.id, { operationId: 'collision-sync', source: { kind: 'sync', syncId: 'collision-sync' }, at,
    change: { kind: 'sync', expectedVersion: current.version, workbook: incoming } })).toMatchObject({ state: 'resolve-required', reason: 'sync-ambiguous' });
  expect(f.service.read(f.id)).toEqual(current);
  const saved = f.service.save(f.id, current.version, duplicate);
  expect(f.repository.operation(f.id, f.patch('collision-patch', '10800000', 'unsafe'))).toMatchObject({ state: 'resolve-required', reason: 'duplicate-key' });
  expect(f.repository.operation(f.id, f.operation('collision-add', { kind: 'add', sheetId: sheet.id, rowId: 'another', key: '10800000', values: { 'roster.notes': 'unsafe' } })))
    .toMatchObject({ state: 'resolve-required', reason: 'duplicate-key' });
  const snapshot = f.repository.snapshot({ libraryId: f.id, typeId: 'roster', keys: ['10800000'], fields: ['eid'] });
  expect(snapshot.rows[0]).toMatchObject({ state: 'ambiguous', matches: [{ values: { eid: 10800000 } }, { values: { eid: '10800000' } }] });
  expect(f.service.read(f.id)).toEqual(saved);
});
it('validates proposed numeric key cells through the same stable identity without rewriting raw values', async () => {
  const f = await numericKeys(), sheet = f.service.read(f.id).workbook.sheets[0];
  expect(f.repository.operation(f.id, f.operation('numeric-new', { kind: 'add', sheetId: sheet.id, rowId: 'new', key: '10800002', values: { eid: 10800002, 'roster.notes': 'new' } })))
    .toMatchObject({ state: 'applied' });
  expect(f.service.read(f.id).workbook.sheets[0].rows.at(-1)?.cells[0].value).toBe(10800002);
  expect(f.repository.operation(f.id, f.operation('numeric-wrong', { kind: 'add', sheetId: sheet.id, rowId: 'wrong', key: '10800003', values: { eid: 999, 'roster.notes': 'unsafe' } })))
    .toMatchObject({ state: 'refused', reason: 'invalid' });
});

it('does not treat booleans, dates, blanks or null as canonical string keys', async () => {
  const f = await numericKeys(), current = f.service.read(f.id), edited = structuredClone(current.workbook);
  edited.sheets[0].rows[1].cells[0].value = true;
  edited.sheets[0].rows[2].cells[0].value = new Date('2026-01-01T00:00:00.000Z');
  edited.sheets[0].rows[3].cells[0].value = null;
  edited.sheets[0].rows.push({ id: 'blank-key', cells: [{ value: '' }, { value: 'Blank' }, { value: null }] });
  f.service.save(f.id, current.version, edited);
  const snapshot = f.repository.snapshot({ libraryId: f.id, typeId: 'roster', keys: ['true', '2026-01-01T00:00:00.000Z', 'null'], fields: ['eid'] });
  expect(snapshot.rows).toEqual(['true', '2026-01-01T00:00:00.000Z', 'null'].map(key => ({ key, state: 'missing', matches: [] })));
});
