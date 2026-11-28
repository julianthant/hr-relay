import { DatabaseSync } from 'node:sqlite';
import { afterEach, expect, it } from 'vitest';
import { applyAuthorityMigrationsAfter } from '../../../../src/backend/storage/sqlite/authority-upgrades.js';
import { CURRENT_AUTHORITY_SCHEMA_VERSION, SQLITE_MIGRATIONS, migrationTableNames } from '../../../../src/backend/storage/sqlite/migrations.js';
import { createWorkbookLibraryRepository, validateWorkbookLibrary, WORKBOOK_LIBRARY_SYNC_STATUS_MIGRATION } from '../../../../src/backend/storage/sqlite/workbook-library-repository.js';
import { IsoInstantSchema } from '../../../../src/rules/identity/ids.js';
import { removeSchema36WorkbookSyncStatus, withCurrentWorkbookLayout } from '../../../support/fixtures/storage/historical-run-schema.js';

const databases: DatabaseSync[] = [];
afterEach(() => databases.splice(0).forEach(database => database.close()));
const at = IsoInstantSchema.parse('2026-11-17T00:00:00.000Z');
const url = 'https://example.sharepoint.com/sites/hr/Roster.csv';

/** A schema-35 store holding one SharePoint-linked spreadsheet that has synced once, in the shape schema 35 wrote. */
function schema35Store() {
  const database = new DatabaseSync(':memory:'); databases.push(database);
  for (const migration of SQLITE_MIGRATIONS.filter(value => value.version <= 35)) for (const statement of migration.statements) database.exec(statement);
  database.exec("UPDATE database_states SET schema_version=35; PRAGMA user_version=35");
  withCurrentWorkbookLayout(database, () => {
    const repository = createWorkbookLibraryRepository({ database, read: work => work(), mutate: work => work().result });
    repository.create({ libraryId: 'roster', version: 1, createdAt: at, savedAt: at, workbook: { libraryId: 'roster', name: 'Roster.csv', themes: [], hasFormulas: false,
      sheets: [{ id: 'people', name: 'Sheet 1', hidden: [], width: 1, rows: [{ id: 'header', cells: [{ value: 'EID' }] }, { id: 'person', cells: [{ value: '10000001' }] }] }] } });
    repository.libraryAction('roster', { operationId: 'link', expectedRevision: 1, expectedVersion: 1, change: { kind: 'link', url } }, at);
  });
  return database;
}
const rows = (database: DatabaseSync) => database.prepare('SELECT * FROM workbook_library_state ORDER BY id').all().map(row => ({ ...row }));
const upgrade = (database: DatabaseSync) => applyAuthorityMigrationsAfter(database, 35, { now: '2026-11-18T00:00:00.000Z', captureFile: () => { throw new Error('no capture expected'); } });

it('is schema version 36, under the current schema 48, and adds no table', () => {
  expect(WORKBOOK_LIBRARY_SYNC_STATUS_MIGRATION.version).toBe(36);
  expect(CURRENT_AUTHORITY_SCHEMA_VERSION).toBe(48);
  expect(migrationTableNames(36)).toEqual(migrationTableNames(35));
});

it('validates a schema-35 library as a predecessor and refuses it as current', () => {
  const database = schema35Store();
  expect(validateWorkbookLibrary(database, true, true, true, false, false)).toBeGreaterThan(0);
  expect(() => validateWorkbookLibrary(database)).toThrow();
});

it('upgrades every library state to no recorded sync, keeping its state and serving the linked entry as idle', () => {
  const database = schema35Store(), before = rows(database);
  upgrade(database);
  expect(rows(database)).toEqual(before.map(row => ({ ...row, sync_json: null })));
  expect(validateWorkbookLibrary(database)).toBeGreaterThan(0);
  const repository = createWorkbookLibraryRepository({ database, read: work => work(), mutate: work => work().result });
  expect(repository.catalog()[0].sync).toEqual({ state: 'idle' });
  repository.recordSync('roster', { url, finishedAt: IsoInstantSchema.parse('2026-11-18T00:01:00.000Z'), result: 'failed', code: 'SHAREPOINT_DOWNLOAD_FAILED' });
  expect(repository.catalog()[0].sync).toEqual({ state: 'idle', lastFinishedAt: '2026-11-18T00:01:00.000Z', lastResult: 'failed', lastFailureCode: 'SHAREPOINT_DOWNLOAD_FAILED' });
  expect(validateWorkbookLibrary(database)).toBeGreaterThan(0);
});

it('refuses a stored sync record that names no catalog code', () => {
  const database = schema35Store();
  upgrade(database);
  database.prepare('UPDATE workbook_library_state SET sync_json=? WHERE id=?').run(JSON.stringify({ url, finishedAt: at, result: 'failed', code: 'download timed out' }), 'roster');
  expect(() => validateWorkbookLibrary(database)).toThrow();
  const repository = createWorkbookLibraryRepository({ database, read: work => work(), mutate: work => work().result });
  expect(() => repository.catalog()).toThrow(expect.objectContaining({ code: 'WORKBOOK_STORAGE_CORRUPT' }));
});

it('steps an upgraded store back to schema 35 with the rewind helper', () => {
  const database = schema35Store(), before = rows(database);
  upgrade(database);
  database.exec(`UPDATE database_states SET schema_version=${String(CURRENT_AUTHORITY_SCHEMA_VERSION)}; PRAGMA user_version=${String(CURRENT_AUTHORITY_SCHEMA_VERSION)}`);
  removeSchema36WorkbookSyncStatus(database);
  expect(database.prepare('PRAGMA user_version').get()?.user_version).toBe(35);
  expect(rows(database)).toEqual(before);
  expect(validateWorkbookLibrary(database, true, true, true, false, false)).toBeGreaterThan(0);
});
