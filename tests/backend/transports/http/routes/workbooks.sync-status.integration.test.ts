import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, expect, it } from 'vitest';
import { Hono } from 'hono';
import type { DashboardApp } from '../../../../../src/backend/transports/http/routes/api-types.js';
import { registerWorkbookRoutes } from '../../../../../src/backend/transports/http/routes/workbooks.js';
import { createWorkbookLibraryRepository, WORKBOOK_LIBRARY_MIGRATION, WORKBOOK_MASTER_MIGRATION, WORKBOOK_LIBRARY_CATALOG_MIGRATION, WORKBOOK_LIBRARY_SYNC_STATUS_MIGRATION, validateWorkbookLibrary, WORKBOOK_PAYLOAD_TABLE } from '../../../../../src/backend/storage/sqlite/workbook-library-repository.js';
import { createWorkbookLibraryService, type WorkbookSyncDownload } from '../../../../../src/backend/workbooks/workbook-library-service.js';
import { SharePointDownloadError } from '../../../../../src/backend/systems/sharepoint/driver/interpreter.js';
import { WorkbookLibraryCatalogSchema } from '../../../../../src/models/dashboard/workbook-library.js';
import { manualClock } from '../../../../../src/rules/time/clock.js';

const databases: DatabaseSync[] = [];
const directories: string[] = [];
const at = '2026-11-17T10:00:00.000Z';
const finished = '2026-11-17T10:01:00.000Z';
const url = 'https://example.sharepoint.com/sites/hr/Linked.csv';
const headers = { host: 'localhost', origin: 'http://localhost', 'content-type': 'application/json' };
const bytes = () => new TextEncoder().encode('Label\nRemote\n').buffer;
const unexpectedSync: WorkbookSyncDownload = { withDownload: () => { throw new Error('unexpected download'); } };
afterEach(() => {
  databases.splice(0).forEach(database => { if (database.isOpen) database.close(); });
  directories.splice(0).forEach(directory => rmSync(directory, { recursive: true, force: true }));
});

function open(database: DatabaseSync, sync: WorkbookSyncDownload) {
  const transaction = <T>(work: () => T): T => {
    database.exec('BEGIN IMMEDIATE');
    try { const result = work(); database.exec('COMMIT'); return result; }
    catch (error) { database.exec('ROLLBACK'); throw error; }
  };
  const repository = createWorkbookLibraryRepository({ database, read: transaction, mutate: work => transaction(() => work().result) });
  const clock = manualClock(new Date(at));
  const service = createWorkbookLibraryService({ repository, clock, sync });
  const app: DashboardApp = new Hono();
  registerWorkbookRoutes(app, { workbooks: { library: service, workflows: [] } });
  const catalog = async () => {
    const response = await app.request('/api/v1/workbooks/catalog');
    expect(response.status).toBe(200);
    return WorkbookLibraryCatalogSchema.parse(await response.json());
  };
  return { repository, service, app, clock, catalog };
}

function fixture(download: WorkbookSyncDownload, path = ':memory:') {
  const database = new DatabaseSync(path); databases.push(database);
  for (const sql of [...WORKBOOK_LIBRARY_MIGRATION.statements, ...WORKBOOK_MASTER_MIGRATION.statements, ...WORKBOOK_LIBRARY_CATALOG_MIGRATION.statements, ...WORKBOOK_LIBRARY_SYNC_STATUS_MIGRATION.statements, ...WORKBOOK_PAYLOAD_TABLE.statements]) database.exec(sql);
  database.exec("CREATE TABLE runs (id TEXT PRIMARY KEY,state TEXT NOT NULL,lifecycle_json TEXT NOT NULL); CREATE TABLE run_requests (id TEXT PRIMARY KEY,payload_json TEXT NOT NULL)");
  const opened = open(database, download);
  const create = (name: string) => opened.service.create({ name, themes: [], hasFormulas: false,
    sheets: [{ id: 'source', name: 'Sheet 1', width: 1, hidden: [], rows: [
      { id: 'header', cells: [{ value: 'Label' }] }, { id: 'value', cells: [{ value: 'Local' }] },
    ] }] });
  const local = create('Local.csv'), linked = create('Linked.csv');
  opened.service.operatorOperation(linked.libraryId, 'link', { kind: 'metadata', expectedVersion: 1,
    metadata: { typeId: 'general', sharePoint: { url, verifiedAt: at } } });
  const sync = (operationId: string) => opened.app.request(`/api/v1/workbooks/${linked.libraryId}/library-actions`, { method: 'POST', headers,
    body: JSON.stringify({ operationId, expectedVersion: 2, expectedRevision: opened.repository.libraryState(linked.libraryId).revision, change: { kind: 'sync' } }) });
  return { ...opened, database, local: local.libraryId, linked: linked.libraryId, sync };
}

const downloading = (finish: (f: ReturnType<typeof fixture>) => void) => {
  let release: () => void = () => { throw new Error('download not started'); };
  let started: () => void = () => { throw new Error('start signal not installed'); };
  const running = new Promise<void>(resolve => { started = resolve; });
  const sync: WorkbookSyncDownload = { async withDownload(command, use) {
    await new Promise<void>(resolve => { release = resolve; started(); });
    return use({ name: 'Linked.csv', bytes: bytes() }, { signal: command.signal, assertCurrent: () => command.signal.throwIfAborted() });
  } };
  return { sync, running, release: (f: ReturnType<typeof fixture>) => { finish(f); release(); } };
};

it('serves running during library Sync, then the successful finish, and omits status on a local entry', async () => {
  const download = downloading(f => f.clock.advanceWall(60_000));
  const f = fixture(download.sync);
  expect((await f.catalog()).find(entry => entry.libraryId === f.linked)?.sync).toEqual({ state: 'idle' });
  const state = f.repository.libraryState(f.linked);
  const syncing = f.sync('sync-1');
  await download.running;
  try {
    const running = await f.catalog();
    expect(running.find(entry => entry.libraryId === f.linked)?.sync).toEqual({ state: 'running' });
    expect(running.find(entry => entry.libraryId === f.local)).not.toHaveProperty('sync');
    expect(f.repository.libraryState(f.linked)).toEqual(state);
  } finally { download.release(f); }
  expect((await syncing).status).toBe(200);
  const served = await f.catalog();
  expect(served.find(entry => entry.libraryId === f.linked)?.sync).toEqual({ state: 'idle', lastFinishedAt: finished, lastResult: 'ok' });
  expect(served.find(entry => entry.libraryId === f.local)).not.toHaveProperty('sync');
  expect(validateWorkbookLibrary(f.database)).toBeGreaterThan(0);
});

it('serves a failed library Sync as failed with its catalog code, keeping the content unchanged', async () => {
  const f = fixture({ async withDownload() { f.clock.advanceWall(60_000); throw new SharePointDownloadError('SHAREPOINT_DOWNLOAD_FAILED'); } });
  const before = f.service.read(f.linked);
  expect((await f.sync('sync-failed')).status).toBe(500);
  const served = await f.catalog();
  expect(served.find(entry => entry.libraryId === f.linked)?.sync).toEqual({ state: 'idle', lastFinishedAt: finished, lastResult: 'failed', lastFailureCode: 'SHAREPOINT_DOWNLOAD_FAILED' });
  expect(served.find(entry => entry.libraryId === f.local)).not.toHaveProperty('sync');
  expect(f.service.read(f.linked)).toEqual(before);
});

it('records a failure without its own code as WORKBOOK_SYNC_FAILED', async () => {
  const f = fixture({ async withDownload() { throw new Error('browser crashed'); } });
  expect((await f.sync('sync-unknown')).status).toBe(500);
  expect((await f.catalog()).find(entry => entry.libraryId === f.linked)?.sync).toEqual({ state: 'idle', lastFinishedAt: at, lastResult: 'failed', lastFailureCode: 'WORKBOOK_SYNC_FAILED' });
});

it('serves the last finished sync after the store reopens, and drops it once the entry links elsewhere', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-sync-status-')); directories.push(directory);
  const path = join(directory, 'library.db');
  const download = downloading(f => f.clock.advanceWall(60_000));
  const f = fixture(download.sync, path);
  const syncing = f.sync('sync-restart');
  await download.running;
  download.release(f);
  expect((await syncing).status).toBe(200);
  f.database.close();

  const database = new DatabaseSync(path); databases.push(database);
  const reopened = open(database, unexpectedSync);
  expect((await reopened.catalog()).find(entry => entry.libraryId === f.linked)?.sync).toEqual({ state: 'idle', lastFinishedAt: finished, lastResult: 'ok' });
  reopened.clock.advanceWall(120_000);
  const relinked = await reopened.app.request(`/api/v1/workbooks/${f.linked}/library-actions`, { method: 'POST', headers,
    body: JSON.stringify({ operationId: 'relink', expectedVersion: reopened.service.read(f.linked).version, expectedRevision: reopened.repository.libraryState(f.linked).revision,
      change: { kind: 'link', url: 'https://example.sharepoint.com/sites/hr/Other.csv' } }) });
  expect(relinked.status).toBe(200);
  expect(reopened.service.metadata(f.linked).sharePoint?.url).toBe('https://example.sharepoint.com/sites/hr/Other.csv');
  expect((await reopened.catalog()).find(entry => entry.libraryId === f.linked)?.sync).toEqual({ state: 'idle' });
});

it('serves a library Sync whose captured version lost to a concurrent edit as failed, keeping the link', async () => {
  const f = fixture({ async withDownload(command, use) {
    f.service.operatorOperation(f.linked, 'reverify', { kind: 'metadata', expectedVersion: 2,
      metadata: { typeId: 'general', sharePoint: { url, verifiedAt: finished } } });
    f.clock.advanceWall(60_000);
    return use({ name: 'Linked.csv', bytes: bytes() }, { signal: command.signal, assertCurrent: () => command.signal.throwIfAborted() });
  } });
  const before = f.service.read(f.linked).workbook;
  expect((await f.sync('concurrent-sync')).status).toBe(500);
  expect(f.service.read(f.linked).workbook).toEqual(before);
  expect(f.service.metadata(f.linked).sharePoint?.url).toBe(url);
  expect((await f.catalog()).find(entry => entry.libraryId === f.linked)?.sync).toEqual({ state: 'idle', lastFinishedAt: finished, lastResult: 'failed', lastFailureCode: 'WORKBOOK_VERSION_CONFLICT' });
});
