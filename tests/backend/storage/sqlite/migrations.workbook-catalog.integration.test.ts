import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import { SQLITE_MIGRATIONS } from '../../../../src/backend/storage/sqlite/migrations.js';
import { createWorkbookLibraryRepository, WORKBOOK_LIBRARY_PIN_TAGS_MIGRATION } from '../../../../src/backend/storage/sqlite/workbook-library-repository.js';
import { RunWorkbookReferenceSchema, RunWorkbookAllRowsReferenceSchema, bindRunWorkbookReference } from '../../../../src/models/dashboard/workbooks.js';
import { deriveSchemaHash } from '../../../../src/models/validation/schema-bound-value.js';

function source() {
  const database = new DatabaseSync(':memory:');
  for (const migration of SQLITE_MIGRATIONS.filter(migration => migration.version < 18)) {
    for (const sql of migration.statements) database.exec(sql);
  }
  return database;
}
function apply(database: DatabaseSync) {
  const migration = SQLITE_MIGRATIONS.find(migration => migration.version === 18);
  if (migration === undefined) throw new Error('current migration missing');
  for (const sql of [...migration.statements, ...WORKBOOK_LIBRARY_PIN_TAGS_MIGRATION.statements]) database.exec(sql);
}

it('initializes the empty named catalogue without changing a numeric workbook revision', () => {
  const database = source();
  try {
    const record = { libraryId: 'library', version: 1, createdAt: '2026-11-02T00:00:00Z', savedAt: '2026-11-02T00:00:00Z',
      workbook: { name: 'Roster.xlsx', libraryId: 'library', themes: [], hasFormulas: false,
        sheets: [{ id: 'people', name: 'People', width: 1, hidden: [], rows: [{ id: 'header', cells: [{ value: 'EID' }] }] }] } };
    const json = JSON.stringify(record);
    database.prepare('INSERT INTO workbook_library(id,version,created_at,saved_at,payload_json) VALUES(?,?,?,?,?)').run(record.libraryId, 1, record.createdAt, record.savedAt, json);
    database.prepare('INSERT INTO workbook_creations(id,payload_json) VALUES(?,?)').run(record.libraryId, json);
    apply(database);
    const repository = createWorkbookLibraryRepository({ database, read: work => work(), mutate: () => { throw new Error('read-only proof'); } });
    expect(repository.read('library')).toEqual(record);
    expect(repository.libraryVersion('library').workbook).toEqual(record.workbook);
    expect(repository.libraryState('library').versions).toHaveLength(1);
    expect(() => database.exec("UPDATE workbook_library_snapshots SET payload_json='{}'")).toThrow(/workbook-library-snapshot-immutable/u);
  } finally { database.close(); }
});

it.each(['unknown', 'altered', 'keyed', 'all'] as const)('refuses incompatible captured reference identity before catalogue effects; mode=%s', mode => {
  const compatible = mode === 'keyed' || mode === 'all';
  const database = source();
  try {
    const masterHash = deriveSchemaHash(RunWorkbookAllRowsReferenceSchema, 'output');
    const schemaHash = compatible ? deriveSchemaHash(mode === 'all' ? RunWorkbookAllRowsReferenceSchema : RunWorkbookReferenceSchema, 'output')
      : mode === 'altered' ? `${masterHash.slice(0, -1)}${masterHash.endsWith('0') ? '1' : '0'}` : 'a'.repeat(64);
    const snapshot = { libraryId: 'library', version: 1, worksheets: [{ sheetId: 'people', name: 'People' }],
      type: { id: 'roster', name: 'Roster', keyFieldId: 'eid', fields: ['eid'], defaultWorkbookId: 'library' }, rows: [] };
    const request = mode === 'keyed' ? { typeId: 'roster', keys: [], fields: ['eid'] }
      : { mode: 'all', typeId: 'roster', libraryId: 'library', expectedVersion: 1, fields: ['eid'] };
    const retained = bindRunWorkbookReference(request, snapshot);
    database.prepare('INSERT INTO run_requests(id,workflow,actor_id,expires_at,version,payload_json,created_at) VALUES(?,?,?,?,?,?,?)')
      .run('plan', 'workflow', 'local-operator', '2026-11-03T00:00:00Z', 1,
        JSON.stringify({ planned: [{ workbookReferences: [{ ...retained, schemaHash }] }] }), '2026-11-02T00:00:00Z');
    if (compatible) {
      expect(() => apply(database)).not.toThrow();
      expect(database.prepare("SELECT name FROM sqlite_master WHERE name='workbook_library_state'").get()).toBeDefined();
    } else {
      expect(() => apply(database)).toThrow(/workbook_reference_schema_upgrade_unproved/u);
      expect(database.prepare("SELECT name FROM sqlite_master WHERE name='workbook_library_state'").get()).toBeUndefined();
      expect(database.prepare('SELECT payload_json FROM run_requests').get()?.payload_json).toContain(schemaHash);
    }
  } finally { database.close(); }
});
