import { DatabaseSync } from 'node:sqlite';
import { createWorkbookLibraryRepository, WORKBOOK_LIBRARY_MIGRATION, WORKBOOK_MASTER_MIGRATION, WORKBOOK_LIBRARY_CATALOG_MIGRATION, WORKBOOK_LIBRARY_SYNC_STATUS_MIGRATION } from '../../../../../src/backend/storage/sqlite/workbook-library-repository.js';
import { createWorkbookLibraryService, projectWorkbookCompatibilityFromRepository } from '../../../../../src/backend/workbooks/workbook-library-service.js';
import { manualClock } from '../../../../../src/rules/time/clock.js';
import { unexpectedWorkbookSync } from '../../../../support/helpers/backend/workbook-sync.js';
import { installRetainedMergeFixture } from '../../../../support/fixtures/storage/retained-workbook-merge.js';
import { ERROR_CATALOG } from '../../../../../src/models/failures/error-catalog.js';
import { Hono } from 'hono';
import type { DashboardApp } from '../../../../../src/backend/transports/http/routes/api-types.js';
import { registerWorkbookRoutes } from '../../../../../src/backend/transports/http/routes/workbooks.js';
import { WorkbookLibraryError } from '../../../../../src/backend/workbooks/workbook-library-error.js';
import { fixtureDescriptor } from '../../../../support/fixtures/descriptor-fixtures.js';

import assert from "node:assert/strict";
import { afterEach, expect, it, vi } from "vitest";
import { WorkbookImportResultSchema, encodeEditableWorkbook, decodeSavedWorkbook } from "../../../../../src/models/dashboard/workbooks.js";
import { WorkbookLibraryCatalogSchema, WorkbookLibraryVersionViewSchema } from "../../../../../src/models/dashboard/workbook-library.js";
import { assertHttpFaultOnly,faultAuthoritySnapshot,disposeHttpRouteHarness, foreignOriginCases, harness } from "../../../../support/helpers/backend/http-route-harness.js";

afterEach(disposeHttpRouteHarness);
const headers = { host: "localhost", origin: "http://localhost", "content-type": "application/json" };
const workbook = { name: "Dates.xlsx", themes: [], hasFormulas: false, sheets: [{ id: "sheet", name: "Dates", width: 1, hidden: [], rows: [{ id: "row", cells: [{ value: new Date("2026-01-01T00:00:00.000Z") }] }] }] };
it('serves current workbook compatibility from server workflow declarations before the dynamic library route', async () => {
  const h = await harness();
  const response = await h.app.request('http://localhost/api/v1/workbooks/compatibility');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), projectWorkbookCompatibilityFromRepository(h.database.authority.workbooks, [fixtureDescriptor]));
});

it('retires workbook routes with no mounted consumer', async () => {
  const h = await harness();
  const base = 'http://localhost/api/v1/workbooks';
  const created = await h.app.request(base, { method: 'POST', headers, body: JSON.stringify({ workbook: encodeEditableWorkbook(workbook) }) });
  assert.equal(created.status, 201);
  const { libraryId } = decodeSavedWorkbook(await created.json());
  const path = `${base}/${libraryId}`;
  const post = { method: 'POST', headers, body: '{}' };
  const retired = [
    await h.app.request(`${base}/results`),
    await h.app.request(`${path}/metadata`),
    await h.app.request(`${path}/versions`),
    await h.app.request(`${path}/changes`),
    await h.app.request(`${path}/operations`, post),
    await h.app.request(`${path}/sync`, post),
  ];
  assert.deepEqual(retired.map(response => response.status), [404, 404, 404, 404, 404, 404]);
});

it("serves create/list/open/save/conflict/history with exact Date transport and durable CAS", async () => {
  const h = await harness();
  const created = await h.app.request("http://localhost/api/v1/workbooks", { method: "POST", headers, body: JSON.stringify({ workbook: encodeEditableWorkbook(workbook) }) });
  assert.equal(created.status, 201);
  const first = decodeSavedWorkbook(await created.json());
  const path = `http://localhost/api/v1/workbooks/${first.libraryId}`;
  const list = await h.app.request("http://localhost/api/v1/workbooks/list");
  assert.equal(list.status, 200); assert.equal((await list.json() as unknown[]).length, 1);
  assert.deepEqual(decodeSavedWorkbook(await (await h.app.request(path)).json()), first);
  const save = await h.app.request(`${path}/save`, { method: "POST", headers, body: JSON.stringify({ expectedVersion: 1, workbook: encodeEditableWorkbook({ ...first.workbook, name: "Saved.xlsx" }) }) });
  assert.equal(save.status, 200); const second = decodeSavedWorkbook(await save.json());
  const conflict = await h.app.request(`${path}/save`, { method: "POST", headers, body: JSON.stringify({ expectedVersion: 1, workbook: encodeEditableWorkbook(first.workbook) }) });
  assert.equal(conflict.status, 409); assert.equal((await conflict.json() as { code: string }).code, "WORKBOOK_VERSION_CONFLICT");
  assert.deepEqual(decodeSavedWorkbook(await (await h.app.request(path)).json()), second);
  assert.deepEqual((await (await h.app.request(`${path}/history`)).json() as unknown[]).map(decodeSavedWorkbook), []);
  assert.deepEqual(decodeSavedWorkbook(await (await h.app.request(`${path}/revisions/1`)).json()), first);
  assert.deepEqual(decodeSavedWorkbook(await (await h.app.request(`${path}/revisions/2`)).json()), second);
  const unavailable = await h.app.request(`${path}/revisions/3`);
  assert.equal(unavailable.status, 404); assert.equal((await unavailable.json() as { code: string }).code, 'WORKBOOK_REVISION_UNAVAILABLE');
  for (const invalid of ['0', '-1', 'NaN', '1.5']) assert.equal((await h.app.request(`${path}/revisions/${invalid}`)).status, 400);
});
it('returns a named conflict and retains the master when formula metadata makes Save unsafe', async () => {
  const h = await harness();
  const created = await h.app.request('http://localhost/api/v1/workbooks', { method: 'POST', headers, body: JSON.stringify({ workbook: encodeEditableWorkbook({ ...workbook, hasFormulas: true }) }) });
  assert.equal(created.status, 201);
  const first = decodeSavedWorkbook(await created.json());
  const path = `http://localhost/api/v1/workbooks/${first.libraryId}`;
  const response = await h.app.request(`${path}/save`, { method: 'POST', headers, body: JSON.stringify({ expectedVersion: first.version, workbook: encodeEditableWorkbook({ ...first.workbook, name: 'Changed.xlsx' }) }) });
  assert.equal(response.status, 409);
  assert.equal((await response.json() as { code: string }).code, 'WORKBOOK_METADATA_UNSUPPORTED');
  assert.deepEqual(decodeSavedWorkbook(await (await h.app.request(path)).json()), first);
});
it.each(["/api/v1/workbooks/id/clone", "/api/v1/workbooks/import", "/api/v1/workbooks", "/api/v1/workbooks/id/save", "/api/v1/workbooks/id/intake", "/api/v1/workbooks/types", "/api/v1/workbooks/id/library-actions"])("requires JSON before effects for %s", async path => {
  const h = await harness(), beforeFault = faultAuthoritySnapshot(h);
  const response = await h.app.request(`http://localhost${path}`, { method: "POST", headers: { host: "localhost", origin: "http://localhost", "content-type": "text/plain" }, body: "{}" });
  assert.equal(response.status, 415); assertHttpFaultOnly(h, beforeFault, 1);
});
it.each(foreignOriginCases())("rejects foreign workbook mutation %s before reading the body", async (_label, originHeaders) => {
  const h = await harness();
  for (const path of ["/api/v1/workbooks/id/clone", "/api/v1/workbooks/import", "/api/v1/workbooks", "/api/v1/workbooks/id/save", "/api/v1/workbooks/id/intake", "/api/v1/workbooks/types", "/api/v1/workbooks/id/library-actions"]) {
    const request = new Request(`http://localhost${path}`, { method: "POST", headers: { ...originHeaders, "content-type": "application/json" }, body: "{}" });
    const read = vi.spyOn(request, "json");
    assert.equal((await h.app.request(request)).status, 403); assert.equal(request.bodyUsed, false); assert.equal(read.mock.calls.length, 0);
  }
});

it("refuses malformed workbook dates and dimensions with WORKBOOK_INVALID before library effects", async () => {
  const h = await harness();
  const wire = encodeEditableWorkbook(workbook);
  for (const malformed of [
    { ...wire, sheets: [{ ...wire.sheets[0], width: 2 }] },
    { ...wire, sheets: [{ ...wire.sheets[0], rows: [{ id: "row", cells: [{ value: { type: "date", value: "invalid" } }] }] }] },
  ]) {
    const response = await h.app.request("http://localhost/api/v1/workbooks", { method: "POST", headers, body: JSON.stringify({ workbook: malformed }) });
    assert.equal(response.status, 400); assert.equal((await response.json() as { code: string }).code, "WORKBOOK_INVALID");
    assert.deepEqual(h.database.authority.workbooks.list(), []);
  }
});

it('serves persisted types and manual named versions, refusing forged sources and unlinked Sync', async () => {
  const h = await harness();
  const create = await h.app.request('http://localhost/api/v1/workbooks', { method: 'POST', headers, body: JSON.stringify({ workbook: encodeEditableWorkbook(workbook) }) });
  const first = decodeSavedWorkbook(await create.json()), path = `http://localhost/api/v1/workbooks/${first.libraryId}`;
  assert.equal((await h.app.request('http://localhost/api/v1/workbooks/types')).status, 200);
  const catalog = async () => {
    const response = await h.app.request('http://localhost/api/v1/workbooks/catalog');
    assert.equal(response.status, 200);
    const entry = WorkbookLibraryCatalogSchema.parse(await response.json()).find(item => item.libraryId === first.libraryId);
    assert.ok(entry);
    return entry;
  };
  const post = (body: unknown) => h.app.request(`${path}/library-actions`, { method: 'POST', headers, body: JSON.stringify(body) });
  const before = await catalog();
  const request = { operationId: 'reviewed', expectedVersion: first.version, expectedRevision: before.state.revision,
    change: { kind: 'create-version', name: 'Reviewed', from: { kind: 'version', versionId: before.state.selectedVersionId }, useNow: false } };
  assert.equal((await post(request)).status, 200);
  assert.equal((await post(request)).status, 200);
  const after = await catalog();
  assert.deepEqual(after.state.versions.filter(({ id }) => id === request.operationId).map(({ name, source }) => ({ name, source })), [{ name: 'Reviewed', source: 'operator' }]);
  const view = await h.app.request(`${path}/versions/${request.operationId}`);
  assert.equal(view.status, 200);
  assert.equal(WorkbookLibraryVersionViewSchema.parse(await view.json()).version.name, 'Reviewed');
  for (const forged of [{ ...request, source: { kind: 'run', runId: 'foreign' } }, { ...request, at: '2099-01-01T00:00:00.000Z' }, { ...request, operationId: 'run', change: { kind: 'patch', key: '001', values: { 'roster.notes': 'forged' } } }])
    assert.equal((await post(forged)).status, 400);
  const sync = await post({ operationId: 'sync', expectedVersion: first.version, expectedRevision: after.state.revision, change: { kind: 'sync' } });
  assert.equal(sync.status, 409);
  assert.equal((await sync.json() as { code: string }).code, 'WORKBOOK_SYNC_LINK_REQUIRED');
  assert.equal(h.database.authority.workbooks.read(first.libraryId)?.version, 1);
});


it('rejects retired import purpose input and serves a plain import with admitted mutation and a catalog entry', async () => {
  const h = await harness(), wire = encodeEditableWorkbook(workbook);
  const post = (body: unknown) => h.app.request('http://localhost/api/v1/workbooks/import', { method: 'POST', headers, body: JSON.stringify(body) });
  for (const purpose of [{ kind: 'other' }, { kind: 'workflow-reference', workflowId: 'unknown', typeId: 'general' }]) {
    const response = await post({ workbook: wire, purpose });
    assert.equal(response.status, 400);
    assert.equal(h.database.authority.workbooks.list().length, 0);
  }
  const imported = await post({ workbook: wire });
  assert.equal(imported.status, 201);
  const result = WorkbookImportResultSchema.parse(await imported.json());
  assert.deepEqual(Object.keys(result), ['workbook']);
  assert.equal(result.workbook.version, 1);
  const catalog = await h.app.request('http://localhost/api/v1/workbooks/catalog');
  assert.equal(catalog.status, 200);
  assert.deepEqual(WorkbookLibraryCatalogSchema.parse(await catalog.json()).map(entry => entry.libraryId), [result.workbook.libraryId]);
});

it('serves clone as a new import result and refuses an existing name without creating another spreadsheet', async () => {
  const h = await harness();
  const response = await h.app.request('http://localhost/api/v1/workbooks/import', { method: 'POST', headers,
    body: JSON.stringify({ workbook: encodeEditableWorkbook(workbook), tags: ['Original'] }) });
  expect(response.status).toBe(201);
  const original = WorkbookImportResultSchema.parse(await response.json()).workbook;
  const path = `http://localhost/api/v1/workbooks/${original.libraryId}/clone`;
  const cloneResponse = await h.app.request(path, { method: 'POST', headers, body: JSON.stringify({ name: 'Clone.xlsx', tags: ['Copy'] }) });
  expect(cloneResponse.status).toBe(201);
  const cloned = WorkbookImportResultSchema.parse(await cloneResponse.json()).workbook;
  expect(cloned.workbook).toEqual({ ...original.workbook, libraryId: cloned.libraryId, name: 'Clone.xlsx' });
  const duplicate = await h.app.request(path, { method: 'POST', headers, body: JSON.stringify({ name: 'Clone.xlsx' }) });
  expect(duplicate.status).toBe(409);
  expect(await duplicate.json()).toMatchObject({ code: 'WORKBOOK_NAME_EXISTS',
    message: 'A spreadsheet with this name already exists. Choose a different name.' });
  expect(h.database.authority.workbooks.catalog()).toHaveLength(2);
});

it('dispatches a SharePoint import to the authenticated download boundary and serves its linked, tagged result', async () => {
  const database = new DatabaseSync(':memory:');
  try {
    for (const sql of [...WORKBOOK_LIBRARY_MIGRATION.statements, ...WORKBOOK_MASTER_MIGRATION.statements, ...WORKBOOK_LIBRARY_CATALOG_MIGRATION.statements, ...WORKBOOK_LIBRARY_SYNC_STATUS_MIGRATION.statements]) database.exec(sql);
    const repository = createWorkbookLibraryRepository({ database, read: work => work(), mutate: work => work().result });
    let downloads = 0;
    const library = createWorkbookLibraryService({ repository, clock: manualClock(new Date('2026-11-02T00:00:00.000Z')),
      sync: { async withDownload(command, use) {
        downloads++;
        return use({ name: 'Remote.csv', bytes: new TextEncoder().encode('Label\nRemote\n').buffer },
          { signal: command.signal, assertCurrent: () => command.signal.throwIfAborted() });
      } } });
    const app: DashboardApp = new Hono();
    registerWorkbookRoutes(app, { workbooks: { library, intake: async () => { throw new Error('unexpected intake'); }, workflows: [] } });
    const url = 'https://example.sharepoint.com/sites/hr/Remote.csv';
    const response = await app.request('/api/v1/workbooks/import', { method: 'POST', headers,
      body: JSON.stringify({ source: 'sharepoint', name: 'Remote', url, tags: ['Fall'] }) });
    expect(response.status).toBe(201);
    const result = WorkbookImportResultSchema.parse(await response.json());
    expect(downloads).toBe(1);
    expect(library.catalog()).toHaveLength(1);
    expect(library.catalog()[0]).toMatchObject({ libraryId: result.workbook.libraryId, name: 'Remote',
      metadata: { sharePoint: { url } }, state: { tags: ['Fall'] } });
  } finally { database.close(); }
});

it.each(['new-merge', 'merge'])('rejects retired merge %s before service or replay lookup', async operationId => {
  const app: DashboardApp = new Hono();
  app.onError((error, context) => {
    if (!(error instanceof WorkbookLibraryError)) throw error;
    return context.json({ code: error.code }, 400);
  });
  registerWorkbookRoutes(app, {});
  const response = await app.request('/api/v1/workbooks/historical-target/library-actions', { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ operationId, expectedRevision: 1, expectedVersion: 1,
      change: { kind: 'merge', name: 'Merged.xlsx', duplicates: 'keep-both', sources: [{ libraryId: 'historical-source', expectedRevision: 1, expectedVersion: 1 }] } }) });
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ code: 'WORKBOOK_INVALID' });
});

it('serves a closed retired status without merge payload and rejects its exact completed POST', async () => {
  const database = new DatabaseSync(':memory:');
  try {
    for (const statement of [...WORKBOOK_LIBRARY_MIGRATION.statements, ...WORKBOOK_MASTER_MIGRATION.statements, ...WORKBOOK_LIBRARY_CATALOG_MIGRATION.statements, ...WORKBOOK_LIBRARY_SYNC_STATUS_MIGRATION.statements]) database.exec(statement);
    const record = installRetainedMergeFixture(database);
    const repository = createWorkbookLibraryRepository({ database, read: work => work(), mutate: work => work().result });
    const library = createWorkbookLibraryService({ repository, clock: manualClock(new Date(record.at)), sync: unexpectedWorkbookSync });
    const app: DashboardApp = new Hono();
    app.onError((error, context) => {
      if (!(error instanceof WorkbookLibraryError)) throw error;
      return context.json({ code: error.code }, 400);
    });
    registerWorkbookRoutes(app, { workbooks: { library, intake: async () => { throw new Error('unexpected intake'); }, workflows: [] } });
    const before = database.prepare('SELECT * FROM workbook_library_actions').all();
    const path = `/api/v1/workbooks/${record.libraryId}/library-actions`;
    const status = await app.request(`${path}/${record.action.operationId}`);
    expect(status.status).toBe(200);
    expect(await status.json()).toEqual({ state: 'retired', code: 'WORKBOOK_ACTION_RETIRED', message: ERROR_CATALOG.WORKBOOK_ACTION_RETIRED.text });
    const rejected = await app.request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(record.action) });
    expect(rejected.status).toBe(400);
    expect(await rejected.json()).toEqual({ code: 'WORKBOOK_INVALID' });
    expect(database.prepare('SELECT * FROM workbook_library_actions').all()).toEqual(before);
    expect(repository.libraryActionRecord(record.libraryId, record.action.operationId)).toEqual(record);
  } finally { database.close(); }
});
