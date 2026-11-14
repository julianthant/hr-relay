import { DatabaseSync } from 'node:sqlite';
import { afterEach, expect, it } from 'vitest';
import { applyAuthorityMigrationsAfter } from '../../../src/backend/storage/sqlite/authority-database.js';
import { CURRENT_AUTHORITY_SCHEMA_VERSION, SQLITE_MIGRATIONS } from '../../../src/backend/storage/sqlite/migrations.js';
import { IsoInstantSchema } from '../../../src/rules/identity/ids.js';
import { createWorkbookLibraryRepository, validateWorkbookLibrary, WORKBOOK_LIBRARY_PIN_TAGS_MIGRATION } from '../../../src/backend/storage/sqlite/workbook-library-repository.js';

const databases: DatabaseSync[] = [];
afterEach(() => databases.splice(0).forEach(database => database.close()));

/** A schema-29 store holding one spreadsheet with one recorded library action, in the shape schema 29 wrote. */
function schema29Store() {
  const database = new DatabaseSync(':memory:'); databases.push(database);
  for (const migration of SQLITE_MIGRATIONS.filter(value => value.version <= 29)) for (const statement of migration.statements) database.exec(statement);
  const repository = createWorkbookLibraryRepository({ database, read: work => work(), mutate: work => work().result });
  const at = IsoInstantSchema.parse('2026-11-02T00:00:00.000Z');
  repository.create({ libraryId: 'roster', version: 1, createdAt: at, savedAt: at, workbook: { libraryId: 'roster', name: 'Roster.xlsx', themes: [], hasFormulas: false,
    sheets: [{ id: 'people', name: 'Sheet 1', hidden: [], width: 1, rows: [{ id: 'header', cells: [{ value: 'EID' }] }, { id: 'person', cells: [{ value: '10000001' }] }] }] } });
  repository.libraryAction('roster', { operationId: 'rename-original', expectedRevision: 1, expectedVersion: 1,
    change: { kind: 'rename-version', versionId: 'original', name: 'Reviewed original' } }, at);
  database.exec(`DROP TRIGGER workbook_library_actions_update;
    UPDATE workbook_library_state SET payload_json=json_remove(payload_json,'$.pinned','$.tags');
    UPDATE workbook_library_actions SET payload_json=json_remove(payload_json,'$.result.pinned','$.result.tags');
    CREATE TRIGGER workbook_library_actions_update BEFORE UPDATE ON workbook_library_actions BEGIN SELECT RAISE(ABORT,'workbook-library-action-immutable'); END`);
  return database;
}

it('is schema version 30, under the change log\'s current 31', () => {
  expect(WORKBOOK_LIBRARY_PIN_TAGS_MIGRATION.version).toBe(30);
  expect(CURRENT_AUTHORITY_SCHEMA_VERSION).toBe(31);
});

it('validates a schema-29 library as a predecessor and refuses it as current', () => {
  const database = schema29Store();
  expect(validateWorkbookLibrary(database, true, true, false)).toBeGreaterThan(0);
  expect(() => validateWorkbookLibrary(database)).toThrow();
});

it('upgrades every stored state and recorded action to unpinned with no manual tags, keeping actions immutable', () => {
  const database = schema29Store();
  applyAuthorityMigrationsAfter(database, 29, { now: '2026-11-03T00:00:00.000Z', captureFile: () => { throw new Error('no capture expected'); } });
  expect(validateWorkbookLibrary(database)).toBeGreaterThan(0);
  const repository = createWorkbookLibraryRepository({ database, read: work => work(), mutate: work => work().result });
  expect(repository.catalog()[0].state).toMatchObject({ pinned: false, tags: [], revision: 2 });
  expect(repository.libraryActionRecord('roster', 'rename-original')?.result).toMatchObject({ pinned: false, tags: [] });
  expect(() => database.exec("UPDATE workbook_library_actions SET digest='changed'")).toThrow(/workbook-library-action-immutable/u);
});

const SYNTHETIC_PIN_TAGS = `json('true'),'$TAGS',json('["Retained synthetic tag"]')`;
const payloads = (database: DatabaseSync, table: string) => database.prepare(`SELECT payload_json FROM ${table} ORDER BY id`).all();

it('refuses a schema-29 state that already carries a pin or tags, changing nothing', () => {
  const database = schema29Store();
  database.exec(`UPDATE workbook_library_state SET payload_json=json_set(payload_json,'$.pinned',${SYNTHETIC_PIN_TAGS.replace('$TAGS', '$.tags')})`);
  const before = payloads(database, 'workbook_library_state');
  expect(() => validateWorkbookLibrary(database, true, true, false)).toThrow();
  expect(payloads(database, 'workbook_library_state')).toEqual(before);
});

it('refuses a schema-29 recorded action whose result already carries a pin or tags, changing nothing', () => {
  const database = schema29Store();
  database.exec(`DROP TRIGGER workbook_library_actions_update;
    UPDATE workbook_library_actions SET payload_json=json_set(payload_json,'$.result.pinned',${SYNTHETIC_PIN_TAGS.replace('$TAGS', '$.result.tags')});
    CREATE TRIGGER workbook_library_actions_update BEFORE UPDATE ON workbook_library_actions BEGIN SELECT RAISE(ABORT,'workbook-library-action-immutable'); END`);
  const before = payloads(database, 'workbook_library_actions');
  expect(() => validateWorkbookLibrary(database, true, true, false)).toThrow();
  expect(payloads(database, 'workbook_library_actions')).toEqual(before);
});
