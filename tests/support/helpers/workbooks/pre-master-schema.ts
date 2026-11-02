import assert from 'node:assert/strict';
import type { DatabaseSync } from 'node:sqlite';
import { WORKBOOK_LIBRARY_MIGRATION } from '../../../../src/backend/storage/sqlite/workbook-library-repository.js';

export function restoreEmptyPreMasterWorkbookFixture(database: DatabaseSync): void {
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM workbook_library').get()?.count, 0);
  for (const table of ['workbook_operations', 'workbook_library_history', 'workbook_creations', 'workbook_types', 'workbook_library']) database.exec(`DROP TABLE ${table}`);
  for (const statement of WORKBOOK_LIBRARY_MIGRATION.statements) database.exec(statement);
}
