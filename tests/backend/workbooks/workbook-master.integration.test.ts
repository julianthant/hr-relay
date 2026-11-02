import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { createWorkbookLibraryRepository, WORKBOOK_LIBRARY_MIGRATION, WORKBOOK_MASTER_MIGRATION, validateWorkbookLibrary } from '../../../src/backend/storage/sqlite/workbook-library-repository.js';
import { createWorkbookLibraryService } from '../../../src/backend/workbooks/workbook-library-service.js';
import { encodeSavedWorkbook, type WorkbookOperation } from '../../../src/models/dashboard/workbooks.js';
import { manualClock } from '../../../src/rules/time/clock.js';
const at = '2026-11-02T00:00:00.000Z';
const roots: string[] = [], databases: DatabaseSync[] = [];
afterEach(() => { databases.splice(0).forEach(db => db.close()); roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })); });
function open(path = ':memory:', initialize = true) {
  const database = new DatabaseSync(path); databases.push(database);
  if (initialize) for (const statement of [...WORKBOOK_LIBRARY_MIGRATION.statements, ...WORKBOOK_MASTER_MIGRATION.statements]) database.exec(statement);
  const tx = <T>(work: () => T): T => {
    database.exec('BEGIN IMMEDIATE');
    try { const value = work(); database.exec('COMMIT'); return value; } catch (error) { database.exec('ROLLBACK'); throw error; }
  };
  const repository = createWorkbookLibraryRepository({ database, read: tx, mutate: work => tx(() => work().result) });
  const service = createWorkbookLibraryService({ repository, clock: manualClock(new Date(at)) });
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
  f.repository.putType({ ...f.repository.types()[0], defaultWorkbookId: saved.libraryId });
  const operation = (operationId: string, change: WorkbookOperation['change']): WorkbookOperation => ({ operationId, at, source: { kind: 'run', runId: 'run-1' }, change });
  const patch = (operationId: string, key: string, note: string) => operation(operationId, { kind: 'patch', key, values: { 'roster.notes': note } });
  return { ...f, id: saved.libraryId, patch, operation };
}
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
it('snapshots requested keys only, with immutable wire dates and exact worksheet membership', () => {
  const f = fixture(); const snapshot = f.service.snapshot({ typeId: 'roster', keys: ['001', 'absent'], fields: ['roster.legalName'] });
  expect(snapshot.rows[0]).toMatchObject({ key: '001', state: 'matched', matches: [{ sheetId: 'people', rowId: 'alice', values: { 'roster.legalName': { type: 'date', value: '2000-01-01T00:00:00.000Z' } } }] });
  expect(snapshot.rows[1]).toEqual({ key: 'absent', state: 'missing', matches: [] });
  f.repository.operation(f.id, f.patch('fill', '001', 'new'));
  expect(snapshot.version).toBe(2); expect(Object.isFrozen(snapshot.rows[0].matches[0].values['roster.legalName'])).toBe(true);
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
  await expect(f.service.sync(f.id, 'unavailable', new AbortController().signal)).rejects.toMatchObject({ code: 'WORKBOOK_SYNC_UNAVAILABLE' });
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
  for (const sql of WORKBOOK_MASTER_MIGRATION.statements) db.exec(sql);
  expect(db.prepare('SELECT name,provenance,version FROM workbook_library_history ORDER BY version').all()).toEqual([
    { name: 'Saved revision 1', provenance: 'migration', version: 1 }, { name: 'Saved revision 2', provenance: 'migration', version: 2 }]);
  expect(validateWorkbookLibrary(db)).toBeGreaterThan(0);
});

it('drains acknowledged durable admissions from two processes in FIFO order after an owned writer hold', async () => {
  const { fork } = await import('node:child_process');
  const { once } = await import('node:events');
  const { testProcessImport } = await import('../../support/compiled-process.js');
  const root = mkdtempSync(join(tmpdir(), 'relay-workbook-fifo-')); roots.push(root);
  const path = join(root, 'db.sqlite'), f = fixture(path);
  const peer = (op: WorkbookOperation) => fork(new URL('../../support/processes/workbook-queue-peer.ts', import.meta.url), [path, f.id, JSON.stringify(op)], { execArgv: ['--import', testProcessImport()], stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  const first = peer(f.patch('first-peer', '001', 'first'));
  let second: ReturnType<typeof peer> | undefined;
  try {
    const [admitted1] = await once(first, 'message');
    second = peer(f.patch('second-peer', '001', 'second'));
    const [admitted2] = await once(second, 'message');
    expect(admitted1.state).toBe('admitted'); expect(admitted2.state).toBe('admitted');
    expect(admitted1.sequence).toBeLessThan(admitted2.sequence);
    f.database.exec('BEGIN IMMEDIATE');
    const completed = Promise.all([once(first, 'exit'), once(second, 'exit')]);
    first.send('drain'); second.send('drain');
    // The owned transaction prevents either peer from applying its queued write.
    expect(f.database.prepare("SELECT COUNT(*) AS n FROM workbook_operations WHERE receipt_json IS NULL").get()?.n).toBe(2);
    f.database.exec('COMMIT');
    expect((await completed).map(([code]) => code)).toEqual([0, 0]);
    const receipts = f.repository.journal(f.id).slice(-2);
    expect(receipts.map(receipt => receipt.operationId)).toEqual(['first-peer', 'second-peer']);
    expect(receipts[1].changes[0]).toMatchObject({ oldValue: 'first', newValue: 'second' });
    expect(f.service.read(f.id).workbook.sheets[0].rows[1].cells[2].value).toBe('second');
  } finally {
    if (f.database.isTransaction) f.database.exec('ROLLBACK');
    for (const child of [first, second]) if (child && child.exitCode === null) { child.kill(); await once(child, 'exit'); }
  }
});
