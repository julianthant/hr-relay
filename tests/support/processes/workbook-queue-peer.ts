import { DatabaseSync } from 'node:sqlite';
import { configureWritableConnection } from '../../../src/backend/storage/sqlite/authority-database.js';
import { createWorkbookLibraryRepository } from '../../../src/backend/storage/sqlite/workbook-library-repository.js';
const [path, id, request] = process.argv.slice(2);
const database = new DatabaseSync(path); configureWritableConnection(database, 5000);
const tx = <T>(work: () => T): T => {
  database.exec('BEGIN IMMEDIATE');
  try { const result = work(); database.exec('COMMIT'); return result; } catch (error) { database.exec('ROLLBACK'); throw error; }
};
const repository = createWorkbookLibraryRepository({ database, read: tx, mutate: work => tx(() => work().result) });
const sequence = repository.enqueue(id, JSON.parse(request));
process.send?.({ state: 'admitted', sequence });
process.once('message', () => {
  try { repository.drain(id); process.send?.({ state: 'drained' }); }
  finally { database.close(); process.disconnect?.(); }
});
