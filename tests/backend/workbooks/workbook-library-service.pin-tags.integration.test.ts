import { DatabaseSync } from 'node:sqlite';
import { afterEach, expect, it } from 'vitest';
import type { z } from 'zod';
import { createWorkbookLibraryRepository, WORKBOOK_LIBRARY_MIGRATION, WORKBOOK_MASTER_MIGRATION, WORKBOOK_LIBRARY_CATALOG_MIGRATION, validateWorkbookLibrary } from '../../../src/backend/storage/sqlite/workbook-library-repository.js';
import { createWorkbookLibraryService } from '../../../src/backend/workbooks/workbook-library-service.js';
import { WorkbookLibraryOriginSchema, type WorkbookLibraryChangeSchema } from '../../../src/models/dashboard/workbook-library.js';
import { manualClock } from '../../../src/rules/time/clock.js';
import { unexpectedWorkbookSync } from '../../support/helpers/backend/workbook-sync.js';

const databases: DatabaseSync[] = [];
afterEach(() => databases.splice(0).forEach(database => database.close()));

function fixture() {
  const database = new DatabaseSync(':memory:'); databases.push(database);
  for (const sql of [...WORKBOOK_LIBRARY_MIGRATION.statements, ...WORKBOOK_MASTER_MIGRATION.statements, ...WORKBOOK_LIBRARY_CATALOG_MIGRATION.statements]) database.exec(sql);
  database.exec("CREATE TABLE runs (id TEXT PRIMARY KEY,state TEXT NOT NULL,lifecycle_json TEXT NOT NULL); CREATE TABLE run_requests (id TEXT PRIMARY KEY,payload_json TEXT NOT NULL)");
  const transaction = <T>(work: () => T) => {
    database.exec('BEGIN IMMEDIATE');
    try { const result = work(); database.exec('COMMIT'); return result; }
    catch (error) { database.exec('ROLLBACK'); throw error; }
  };
  const repository = createWorkbookLibraryRepository({ database, read: transaction, mutate: work => transaction(() => work().result) });
  const service = createWorkbookLibraryService({ repository, sync: unexpectedWorkbookSync, clock: manualClock(new Date('2026-11-02T00:00:00Z')) });
  const record = service.create({ name: 'Roster.xlsx', themes: [], hasFormulas: false, sheets: [{ id: 'people', name: 'Sheet 1', hidden: [], width: 1,
    rows: [{ id: 'header', cells: [{ value: 'EID' }] }, { id: 'person', cells: [{ value: '10000001' }] }] }] });
  let sequence = 0;
  const action = (change: z.infer<typeof WorkbookLibraryChangeSchema>) => ({ operationId: `action-${++sequence}`,
    expectedRevision: repository.libraryState(record.libraryId).revision, expectedVersion: service.read(record.libraryId).version, change });
  const apply = (change: z.infer<typeof WorkbookLibraryChangeSchema>) => service.libraryAction(record.libraryId, action(change), new AbortController().signal);
  return { database, repository, service, record, action, apply };
}

it('serves a new spreadsheet unpinned with no manual tags', () => {
  const f = fixture();
  expect(f.service.catalog()[0].state).toMatchObject({ pinned: false, tags: [] });
});

it('pins, tags and unpins through library actions and serves the result with the library list', async () => {
  const f = fixture(), id = f.record.libraryId;
  const pinned = await f.apply({ kind: 'pin' });
  expect(pinned.result).toMatchObject({ pinned: true, tags: [], revision: 2 });
  await f.apply({ kind: 'set-tags', tags: ['Fall hires', 'Payroll'] });
  expect(f.service.catalog()[0].state).toMatchObject({ pinned: true, tags: ['Fall hires', 'Payroll'], revision: 3 });
  await f.apply({ kind: 'unpin' });
  await f.apply({ kind: 'set-tags', tags: [] });
  expect(f.service.catalog()[0].state).toMatchObject({ pinned: false, tags: [], revision: 5 });
  expect(f.service.read(id).version).toBe(1);
  expect(validateWorkbookLibrary(f.database)).toBeGreaterThan(0);
});

it('replays a recorded pin exactly and refuses a stale revision', async () => {
  const f = fixture(), id = f.record.libraryId;
  const request = f.action({ kind: 'pin' });
  const first = await f.service.libraryAction(id, request, new AbortController().signal);
  expect(await f.service.libraryAction(id, request, new AbortController().signal)).toEqual(first);
  await expect(f.service.libraryAction(id, { ...request, operationId: 'stale', change: { kind: 'set-tags', tags: ['Late'] } }, new AbortController().signal))
    .rejects.toMatchObject({ code: 'WORKBOOK_VERSION_CONFLICT' });
  expect(f.service.catalog()[0].state.tags).toEqual([]);
});

it('keeps workflow-derived tags out of the stored manual tags', () => {
  const f = fixture();
  const origin = WorkbookLibraryOriginSchema.parse({ kind: 'workflow', runId: '6f1c2d3e-4a5b-4c6d-8e7f-901234567890', partitionDay: '2026-11-02', workflowId: 'separations', workflowLabel: 'Separations', rowCount: 1, rowSubject: 'person' });
  const saved = f.repository.create({ ...f.record, libraryId: 'result-sheet', workbook: { ...f.record.workbook, libraryId: 'result-sheet' } }, origin);
  expect(f.repository.libraryState(saved.libraryId)).toMatchObject({ origin, pinned: false, tags: [] });
});
