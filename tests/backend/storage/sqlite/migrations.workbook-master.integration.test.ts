import { DatabaseSync } from 'node:sqlite';
import { afterEach, expect, it } from 'vitest';
import { applyAuthorityMigrationsAfter } from '../../../../src/backend/storage/sqlite/authority-database.js';
import { SQLITE_MIGRATIONS } from '../../../../src/backend/storage/sqlite/migrations.js';
import { createWorkbookLibraryRepository, WORKBOOK_MASTER_MIGRATION } from '../../../../src/backend/storage/sqlite/workbook-library-repository.js';

const at = '2026-11-02T00:00:00.000Z';
const databases: DatabaseSync[] = [];
afterEach(() => databases.splice(0).forEach(database => database.close()));

const revision = (version: number, name: string) => ({ libraryId: 'library', version, createdAt: at, savedAt: at,
  workbook: { libraryId: 'library', name, themes: [], hasFormulas: false,
    sheets: [{ id: 'people', name: 'People', width: 1, hidden: [], rows: [{ id: 'row', cells: [{ value: name }] }] }] } });

/** A schema-12 store holding live revision 2 and the given history rows, as builds before the workbook master wrote them. */
function schema12(history: readonly ReturnType<typeof revision>[]) {
  const database = new DatabaseSync(':memory:'); databases.push(database);
  for (const migration of SQLITE_MIGRATIONS.filter(migration => migration.version < WORKBOOK_MASTER_MIGRATION.version)) {
    for (const sql of migration.statements) database.exec(sql);
  }
  const live = revision(2, 'Saved.xlsx');
  database.prepare('INSERT INTO workbook_library(id,version,created_at,saved_at,payload_json) VALUES(?,?,?,?,?)').run(live.libraryId, live.version, at, at, JSON.stringify(live));
  for (const record of history) {
    database.prepare('INSERT INTO workbook_library_history(workbook_id,version,created_at,saved_at,payload_json) VALUES(?,?,?,?,?)').run(record.libraryId, record.version, at, at, JSON.stringify(record));
  }
  return database;
}
const tables = (database: DatabaseSync) => database.prepare("SELECT name,sql FROM sqlite_schema ORDER BY name").all();
const rows = (database: DatabaseSync) => ['workbook_library', 'workbook_library_history'].map(table => database.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());
function upgrade(database: DatabaseSync) {
  database.exec('BEGIN');
  try {
    applyAuthorityMigrationsAfter(database, 12, { now: at, captureFile: () => { throw new Error('no capture expected'); } });
    database.exec('COMMIT');
  } catch (error) { database.exec('ROLLBACK'); throw error; }
}

it('upgrades a contiguous schema-12 history whose latest record is the live revision', () => {
  const database = schema12([revision(1, 'Before.xlsx'), revision(2, 'Saved.xlsx')]);
  upgrade(database);
  const repository = createWorkbookLibraryRepository({ database, read: work => work(), mutate: () => { throw new Error('read-only proof'); } });
  expect(repository.read('library')).toEqual(revision(2, 'Saved.xlsx'));
  expect(repository.creation('library')).toEqual(revision(1, 'Before.xlsx'));
  expect(repository.revision('library', 1)).toEqual(revision(1, 'Before.xlsx'));
});

it.each([
  ['a history gap', [revision(2, 'Saved.xlsx')]],
  ['a missing intermediate revision', [revision(1, 'Before.xlsx'), revision(3, 'Saved.xlsx')]],
  ['a latest history record that differs from the live revision', [revision(1, 'Before.xlsx'), revision(2, 'Other.xlsx')]],
] as const)('refuses %s before migration 13 reshapes the history, changing nothing', (_case, history) => {
  const database = schema12(history);
  const schema = tables(database), stored = rows(database);
  expect(() => upgrade(database)).toThrow(expect.objectContaining({ code: 'WORKBOOK_STORAGE_CORRUPT' }));
  expect(tables(database)).toEqual(schema);
  expect(rows(database)).toEqual(stored);
});
