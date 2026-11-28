import { DatabaseSync } from 'node:sqlite';
import { createWorkbookLibraryRepository, WORKBOOK_LIBRARY_MIGRATION, WORKBOOK_MASTER_MIGRATION, WORKBOOK_LIBRARY_CATALOG_MIGRATION, WORKBOOK_PAYLOAD_TABLE, WORKBOOK_LIBRARY_SYNC_STATUS_MIGRATION } from '../../../../../src/backend/storage/sqlite/workbook-library-repository.js';
import { createWorkbookLibraryService, projectWorkbookCompatibilityFromRepository, snapshotWorkbookReference } from '../../../../../src/backend/workbooks/workbook-library-service.js';
import { buildRunWorkbookSection } from '../../../../../src/backend/runs/workbooks.js';
import { manualClock } from '../../../../../src/rules/time/clock.js';
import { unexpectedWorkbookSync } from '../../../../support/helpers/backend/workbook-sync.js';
import { installRetainedMergeFixture } from '../../../../support/fixtures/storage/retained-workbook-merge.js';
import { ERROR_CATALOG } from '../../../../../src/models/failures/error-catalog.js';
import { Hono } from 'hono';
import type { DashboardApp } from '../../../../../src/backend/transports/http/routes/api-types.js';
import { registerWorkbookRoutes } from '../../../../../src/backend/transports/http/routes/workbooks.js';
import { WorkbookLibraryError } from '../../../../../src/backend/workbooks/workbook-library-error.js';
import { fixtureDescriptor } from '../../../../support/fixtures/descriptor-fixtures.js';
import { createWorkbookLibraryQueries } from '../../../../../src/dashboard/client/queries/workbook-library-queries.js';
import { createDashboardTransport } from '../../../../../src/dashboard/client/transport.js';
import { DashboardClientError } from '../../../../../src/dashboard/client/errors.js';

import assert from "node:assert/strict";
import { afterEach, expect, it, vi } from "vitest";
import { WorkbookImportResultSchema, bindRunWorkbookReference, encodeEditableWorkbook, decodeSavedWorkbook, parseRunWorkbookReference } from "../../../../../src/models/dashboard/workbooks.js";
import { RunRecordSchema } from '../../../../../src/models/run/record.js';
import { derivePlannedInputFingerprint } from '../../../../../src/models/run/start-plan.js';
import { deriveSchemaHash } from '../../../../../src/models/validation/schema-bound-value.js';
import { CrmDocDownloadCanonicalInput, CrmDocDownloadInput } from '../../../../../src/models/workflows/crm-doc-download/input.js';
import { ReadCrmDocumentRows } from '../../../../../src/models/workflows/crm-doc-download/read-document-rows.js';
import { ONBOARDING_ROSTER_TYPE_ID } from '../../../../../src/models/workflows/onboarding/roster.js';
import { canonicalJsonStringify } from '../../../../../src/rules/validation/canonical-json.js';
import { sha256Hex } from '../../../../../src/rules/validation/sha256.js';
import { QUEUED_RUN, START_PLAN } from '../../../../support/fixtures/phase1f-run-fixtures.js';
import { HASH_B } from '../../../../support/fixtures/phase1c-contract-fixtures.js';
import { testRunService } from '../../../../support/fixtures/run-lifecycle-fixtures.js';
import { WorkbookLibraryActionStatusSchema, WorkbookLibraryCatalogSchema, WorkbookLibraryVersionViewSchema } from "../../../../../src/models/dashboard/workbook-library.js";
import { assertHttpFaultOnly,faultAuthoritySnapshot,disposeHttpRouteHarness, foreignOriginCases, harness } from "../../../../support/helpers/backend/http-route-harness.js";

afterEach(disposeHttpRouteHarness);
const headers = { host: "localhost", origin: "http://localhost", "content-type": "application/json" };
const workbook = { name: "Dates.xlsx", themes: [], hasFormulas: false, sheets: [{ id: "sheet", name: "Dates", width: 1, hidden: [], rows: [{ id: "row", cells: [{ value: new Date("2026-01-01T00:00:00.000Z") }] }] }] };
function workbookClient(app: DashboardApp) {
  return createWorkbookLibraryQueries(createDashboardTransport({ baseUrl: 'http://localhost', fetchImpl: async (url, init) => {
    const request = new Request(url, init);
    request.headers.set('host', new URL(url).host);
    return app.request(request);
  } }));
}
it('lists only workbook display summaries through the typed client, keeping full content on open', async () => {
  const h = await harness();
  const document = { name: 'Roster.xlsx', themes: [], hasFormulas: false, sheets: [{ id: 'people', name: 'People', width: 2, hidden: [], headerRow: 2, sourceHeaderRow: 7,
    columnBindings: [{ id: 'name', sourceColumn: 0, sourceHeader: 'Name', fieldId: 'roster.name', basis: 'manual' }, { id: 'notes', sourceColumn: 1, sourceHeader: 'Notes', fieldId: null, basis: 'unmapped' }],
    rows: [{ id: 'preamble', cells: [{ value: 'Roster' }, { value: null }] }, { id: 'header', cells: [{ value: 'Name' }, { value: 'Notes' }] },
      { id: 'person', cells: [{ value: 'Synthetic person' }, { value: 'Body content stays on the per-id route' }] }] }] };
  const response = await h.app.request('http://localhost/api/v1/workbooks', { method: 'POST', headers, body: JSON.stringify({ workbook: document }) });
  assert.equal(response.status, 201);
  const saved = decodeSavedWorkbook(await response.json());
  const client = workbookClient(h.app);
  const expected = [{ libraryId: saved.libraryId, name: 'Roster.xlsx', typeId: 'general', version: 1, createdAt: saved.createdAt, savedAt: saved.savedAt, rowCount: 1,
    sheets: [{ name: 'People', headerRow: 7, columns: ['Name', 'Notes'], columnBindings: document.sheets[0].columnBindings }] }];
  const list = await h.app.request('http://localhost/api/v1/workbooks/list');
  assert.equal(list.status, 200);
  assert.deepEqual(await list.json(), expected);
  assert.deepEqual(await client.workbookList(), expected);
  assert.deepEqual(await client.workbookOpen(saved.libraryId), saved);
});
it('refreshes summaries after content and type changes and omits a removed workbook', async () => {
  const h = await harness();
  const client = workbookClient(h.app);
  const first = await client.workbookCreate(workbook);
  const initial = { libraryId: first.libraryId, name: 'Dates.xlsx', typeId: 'general', version: 1,
    createdAt: first.createdAt, savedAt: first.savedAt, rowCount: 0, sheets: [{ name: 'Dates', headerRow: 1, columns: ['2026-01-01'] }] };
  assert.deepEqual(await client.workbookList(), [initial]);
  const type = await client.workbookPutType({ id: 'reference', name: 'Reference', keyFieldId: null, fields: ['roster.date'], defaultWorkbookId: null });
  const entry = (await client.workbookCatalog())[0];
  await client.workbookLibraryAction(first.libraryId, { operationId: 'change-type', expectedRevision: entry.state.revision, expectedVersion: 1,
    change: { kind: 'metadata', metadata: { typeId: type.id, sharePoint: null } } });
  assert.deepEqual(await client.workbookList(), [{ ...initial, typeId: 'reference', version: 2 }]);
  const replacement = await client.workbookSave(first.libraryId, 2, { ...first.workbook, name: 'Replacement.xlsx',
    sheets: [{ id: 'numbers', name: 'Numbers', width: 1, hidden: [], rows: [{ id: 'header', cells: [{ value: 'Number' }] },
      { id: 'one', cells: [{ value: 42 }] }, { id: 'two', cells: [{ value: false }] }] }] });
  assert.deepEqual(await client.workbookList(), [{ ...initial, name: 'Replacement.xlsx', typeId: 'reference', version: 3, savedAt: replacement.savedAt,
    rowCount: 2, sheets: [{ name: 'Numbers', headerRow: 1, columns: ['Number'] }] }]);
  assert.deepEqual(await client.workbookOpen(first.libraryId), replacement);
  const current = (await client.workbookCatalog())[0];
  await client.workbookLibraryAction(first.libraryId, { operationId: 'remove', expectedRevision: current.state.revision, expectedVersion: 3, change: { kind: 'remove' } });
  assert.deepEqual(await client.workbookList(), []);
});
it('lists the workbook revision and type from the same authority snapshot', async () => {
  const database = new DatabaseSync(':memory:');
  try {
    for (const migration of [WORKBOOK_LIBRARY_MIGRATION, WORKBOOK_MASTER_MIGRATION, WORKBOOK_LIBRARY_CATALOG_MIGRATION, WORKBOOK_LIBRARY_SYNC_STATUS_MIGRATION, WORKBOOK_PAYLOAD_TABLE]) {
      for (const statement of migration.statements) database.exec(statement);
    }
    function transaction<Result>(work: () => Result): Result {
      database.exec('BEGIN');
      try {
        const result = work();
        database.exec('COMMIT');
        return result;
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    }
    let settleAfterRead: (() => void) | undefined;
    const repository = createWorkbookLibraryRepository({ database, mutate: work => transaction(() => work().result), read: work => {
      const result = transaction(work);
      const settle = settleAfterRead;
      settleAfterRead = undefined;
      settle?.();
      return result;
    } });
    const library = createWorkbookLibraryService({ repository, clock: manualClock(new Date('2026-11-02T00:00:00.000Z')), sync: unexpectedWorkbookSync });
    const app: DashboardApp = new Hono();
    registerWorkbookRoutes(app, { workbooks: { library, workflows: [] } });
    const client = workbookClient(app);
    const first = library.create(workbook);
    library.putType({ id: 'reference', name: 'Reference', keyFieldId: null, fields: ['roster.date'], defaultWorkbookId: null });
    settleAfterRead = () => {
      const receipt = library.operatorOperation(first.libraryId, 'settle-between-reads', { kind: 'metadata', expectedVersion: 1,
        metadata: { typeId: 'reference', sharePoint: null } });
      assert.equal(receipt.state, 'applied');
    };

    assert.deepEqual((await client.workbookList()).map(({ libraryId, version, typeId }) => ({ libraryId, version, typeId })),
      [{ libraryId: first.libraryId, version: 1, typeId: 'general' }]);
    assert.deepEqual((await client.workbookList()).map(({ libraryId, version, typeId }) => ({ libraryId, version, typeId })),
      [{ libraryId: first.libraryId, version: 2, typeId: 'reference' }]);
  } finally { database.close(); }
});
it('rejects duplicate identities and malformed summary fields through the typed transport', async () => {
  const h = await harness();
  const client = workbookClient(h.app);
  await client.workbookCreate(workbook);
  const summary = (await client.workbookList())[0];
  assert.ok(Object.isFrozen(summary));
  assert.ok(Object.isFrozen(summary.sheets[0].columns));
  const sheet = summary.sheets[0];
  const binding = { id: 'column', sourceColumn: 0, sourceHeader: 'Date', fieldId: 'roster.date', basis: 'manual' };
  for (const body of [[summary, summary], [{ ...summary, workbook: {} }], [{ ...summary, savedAt: 'invalid' }],
    [{ ...summary, savedAt: '2000-01-01T00:00:00.000Z' }], [{ ...summary, rowCount: -1 }], [{ ...summary, sheets: [{ ...sheet, rows: [] }] }],
    [{ ...summary, sheets: [{ ...sheet, headerRow: 0 }] }], [{ ...summary, sheets: [sheet, { ...sheet, name: sheet.name.toUpperCase() }] }],
    [{ ...summary, sheets: [{ ...sheet, columnBindings: [] }] }],
    [{ ...summary, sheets: [{ ...sheet, columns: ['One', 'Two'], columnBindings: [binding, binding] }] }],
    [{ ...summary, sheets: [{ ...sheet, columns: ['One', 'Two'], columnBindings: [binding, { ...binding, id: 'second' }] }] }]]) {
    const invalid = createWorkbookLibraryQueries(createDashboardTransport({ baseUrl: 'http://localhost', fetchImpl: async (url, init) => {
      const response = await h.app.request(url, init);
      assert.equal(response.status, 200);
      return new Response(JSON.stringify(body), { status: response.status, headers: response.headers });
    } }));
    await assert.rejects(invalid.workbookList(), (error: unknown) => {
      assert.ok(error instanceof DashboardClientError);
      assert.equal(error.kind, 'schema');
      return true;
    });
  }
});
it('serves current workbook compatibility from server workflow declarations before the dynamic library route', async () => {
  const h = await harness();
  const response = await h.app.request('http://localhost/api/v1/workbooks/compatibility');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), projectWorkbookCompatibilityFromRepository(h.database.authority.workbooks, [fixtureDescriptor]));
});

it('serves workbook readiness in bootstrap and revalidates the three separate workbook reads', async () => {
  const h = await harness();
  const boot: unknown = await (await h.app.request('/api/v1/bootstrap')).json();
  expect(boot).not.toHaveProperty('workbookCompatibility');
  expect(boot).toHaveProperty('workflows.0.start.readiness.scope', 'workbook-sources');
  const paths = ['catalog', 'compatibility', 'types'].map(read => `/api/v1/workbooks/${read}`);
  const validators = await Promise.all(paths.map(async path => {
    const first = await h.app.request(path);
    expect(first.status).toBe(200);
    expect(first.headers.get('cache-control')).toBe('private, no-cache');
    expect(first.headers.get('vary')?.toLowerCase()).toContain('x-relay-session');
    const etag = first.headers.get('etag');
    assert.ok(etag);
    const revisit = await h.app.request(path, { headers: { 'if-none-match': etag } });
    expect(revisit.status).toBe(304);
    expect(await revisit.text()).toBe('');
    return { 'if-none-match': etag };
  }));
  const client = workbookClient(h.app);
  const saved = await client.workbookCreate(workbook);
  await client.workbookPutType({ id: 'reference', name: 'Reference', keyFieldId: null, fields: ['roster.date'], defaultWorkbookId: null });
  const changed = await Promise.all(paths.map(async (path, index) => h.app.request(path, { headers: validators[index] })));
  expect(changed.map(response => response.status)).toEqual([200, 200, 200]);
  expect(await changed[0].json()).toMatchObject([{ libraryId: saved.libraryId }]);
  expect(await changed[1].json()).toMatchObject({ libraries: [{ libraryId: saved.libraryId }] });
  expect(await changed[2].json()).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'reference' })]));
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
  const firstBody = await created.text();
  const first = decodeSavedWorkbook(JSON.parse(firstBody));
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
  const revision = await h.app.request(`${path}/revisions/1`);
  assert.equal(revision.status, 200);
  assert.equal(await revision.text(), firstBody);
  assert.deepEqual(decodeSavedWorkbook(await (await h.app.request(`${path}/revisions/2`)).json()), second);
  const unavailable = await h.app.request(`${path}/revisions/3`);
  assert.equal(unavailable.status, 404); assert.equal((await unavailable.json() as { code: string }).code, 'WORKBOOK_REVISION_UNAVAILABLE');
  for (const invalid of ['0', '-1', 'NaN', '1.5', '1e0', '01', '0x1', '%201']) assert.equal((await h.app.request(`${path}/revisions/${invalid}`)).status, 400);
});
it('copies a worksheet\'s column mapping to the worksheets with its headers through the served route', async () => {
  const h = await harness();
  const client = workbookClient(h.app);
  const sheet = (id: string, headers: readonly string[], fields: readonly (string | null)[]) => ({ id, name: id, width: headers.length, hidden: [],
    columnBindings: headers.map((header, column) => ({ id: `${id}:${column}`, sourceColumn: column, sourceHeader: header, fieldId: fields[column], basis: fields[column] === null ? 'unmapped' : 'manual' })),
    rows: [{ id: `${id}:header`, cells: headers.map(value => ({ value })) }, { id: `${id}:row`, cells: headers.map(() => ({ value: 'x' })) }] });
  const created = await client.workbookCreate({ name: 'Separations.xlsx', themes: [], hasFormulas: false, sheets: [
    sheet('july', ['Email', 'UCPath ID', 'Last Day'], ['email', 'eid', null]),
    sheet('august', ['Email', 'UCPath ID', 'Last Day'], [null, null, null]),
    sheet('notes', ['Email', 'Note'], [null, null]),
  ] });
  const copied = await client.workbookCopyMapping(created.libraryId, created.version, 'july');
  assert.equal(copied.version, created.version + 1);
  const fields = (id: string) => copied.workbook.sheets.find(item => item.id === id)?.columnBindings?.map(binding => binding.fieldId);
  assert.deepEqual(fields('august'), ['email', 'eid', null]);
  assert.deepEqual(fields('notes'), [null, null]);
  assert.deepEqual(await client.workbookOpen(created.libraryId), copied);
  const stale = await h.app.request(`http://localhost/api/v1/workbooks/${created.libraryId}/copy-mapping`, { method: 'POST', headers, body: JSON.stringify({ expectedVersion: created.version, worksheetId: 'july' }) });
  assert.equal(stale.status, 409); assert.equal((await stale.json() as { code: string }).code, 'WORKBOOK_VERSION_CONFLICT');
  const missing = await h.app.request(`http://localhost/api/v1/workbooks/${created.libraryId}/copy-mapping`, { method: 'POST', headers, body: JSON.stringify({ expectedVersion: copied.version, worksheetId: 'absent' }) });
  assert.equal(missing.status, 400); assert.equal((await missing.json() as { code: string }).code, 'WORKBOOK_INVALID');
  assert.deepEqual(await client.workbookOpen(created.libraryId), copied);
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
it.each(["/api/v1/workbooks/id/clone", "/api/v1/workbooks/import", "/api/v1/workbooks", "/api/v1/workbooks/id/save", "/api/v1/workbooks/id/copy-mapping", "/api/v1/workbooks/types", "/api/v1/workbooks/id/library-actions"])("requires JSON before effects for %s", async path => {
  const h = await harness(), beforeFault = faultAuthoritySnapshot(h);
  const response = await h.app.request(`http://localhost${path}`, { method: "POST", headers: { host: "localhost", origin: "http://localhost", "content-type": "text/plain" }, body: "{}" });
  assert.equal(response.status, 415); assertHttpFaultOnly(h, beforeFault, 1);
});
it.each(foreignOriginCases())("rejects foreign workbook mutation %s before reading the body", async (_label, originHeaders) => {
  const h = await harness();
  for (const path of ["/api/v1/workbooks/id/clone", "/api/v1/workbooks/import", "/api/v1/workbooks", "/api/v1/workbooks/id/save", "/api/v1/workbooks/id/copy-mapping", "/api/v1/workbooks/types", "/api/v1/workbooks/id/library-actions"]) {
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
  const request = { operationId: 'reviewed% final', expectedVersion: first.version, expectedRevision: before.state.revision,
    change: { kind: 'create-version', name: 'Reviewed', from: { kind: 'version', versionId: before.state.selectedVersionId }, useNow: false } };
  assert.equal((await post(request)).status, 200);
  const after = await catalog();
  assert.deepEqual(after.state.versions.map(({ id, name, source }) => ({ id, name, source })), [
    ...before.state.versions.map(({ id, name, source }) => ({ id, name, source })),
    { id: request.operationId, name: 'Reviewed', source: 'operator' },
  ]);
  assert.equal((await post(request)).status, 200);
  assert.deepEqual(await catalog(), after);
  const view = await h.app.request(`${path}/versions/${encodeURIComponent(request.operationId)}`);
  assert.equal(view.status, 200);
  assert.equal(WorkbookLibraryVersionViewSchema.parse(await view.json()).version.name, 'Reviewed');
  for (const forged of [{ ...request, source: { kind: 'run', runId: 'foreign' } }, { ...request, at: '2099-01-01T00:00:00.000Z' }, { ...request, operationId: 'run', change: { kind: 'patch', key: '001', values: { 'roster.notes': 'forged' } } }])
    assert.equal((await post(forged)).status, 400);
  const sync = await post({ operationId: 'sync', expectedVersion: first.version, expectedRevision: after.state.revision, change: { kind: 'sync' } });
  assert.equal(sync.status, 409);
  assert.equal((await sync.json() as { code: string }).code, 'WORKBOOK_SYNC_LINK_REQUIRED');
  const action = async (operationId: string, change: unknown) => {
    const entry = await catalog();
    return post({ operationId, expectedVersion: entry.version, expectedRevision: entry.state.revision, change });
  };
  for (const [index, change] of [
    request.change,
    { kind: 'rename-version', versionId: before.state.selectedVersionId, name: 'Reviewed' },
  ].entries()) {
    const duplicate = await action(`duplicate-${index}`, change);
    assert.equal(duplicate.status, 409);
    assert.deepEqual(await duplicate.json(), { state: 'error', code: 'WORKBOOK_VERSION_NAME_EXISTS', message: 'A version with this name exists.', retryable: false });
  }
  assert.deepEqual(await catalog(), after);
  assert.equal((await action('keep-own-name', { kind: 'rename-version', versionId: request.operationId, name: 'Reviewed' })).status, 200);
  const inUse = await action('delete-current', { kind: 'delete-version', versionId: before.state.selectedVersionId });
  assert.equal(inUse.status, 409);
  assert.equal((await inUse.json() as { code: string }).code, 'WORKBOOK_VERSION_IN_USE');
  assert.equal((await action('rename-reviewed', { kind: 'rename-version', versionId: request.operationId, name: 'Approved' })).status, 200);
  const renamed = await h.app.request(`${path}/versions/${encodeURIComponent(request.operationId)}`);
  assert.equal(WorkbookLibraryVersionViewSchema.parse(await renamed.json()).version.name, 'Approved');
  const branch = await action('archive-review', { kind: 'create-version', name: 'Archived review', from: { kind: 'version', versionId: request.operationId }, useNow: false });
  assert.equal(branch.status, 200);
  assert.equal((await action('delete-reviewed', { kind: 'delete-version', versionId: request.operationId })).status, 200);
  assert.equal((await h.app.request(`${path}/versions/${encodeURIComponent(request.operationId)}`)).status, 404);
  const unavailable = await action('copy-deleted', { kind: 'create-version', name: 'Unavailable', from: { kind: 'version', versionId: request.operationId }, useNow: false });
  assert.equal(unavailable.status, 404);
  assert.equal((await unavailable.json() as { code: string }).code, 'WORKBOOK_REVISION_UNAVAILABLE');
  assert.deepEqual((await catalog()).state.versions.map(({ name }) => name), ['Original version', 'Archived review']);
  assert.equal(h.database.authority.workbooks.read(first.libraryId)?.version, 1);
});

it('protects a version held by a start plan or queued run and keeps the finished run reference after deletion', async () => {
  const h = await harness();
  const { authority } = h.database;
  const client = workbookClient(h.app);
  const { libraryId } = await client.workbookCreate({
    ...workbook, name: 'Roster.xlsx', sheets: [{
      id: 'people', name: 'People', width: 1, hidden: [], headerRow: 1,
      columnBindings: [{ id: 'email', sourceColumn: 0, sourceHeader: 'Email', fieldId: 'email', basis: 'manual' }],
      rows: [{ id: 'header', cells: [{ value: 'Email' }] }, { id: 'retained', cells: [{ value: 'retained@example.test' }] }],
    }],
  });
  const [entry] = await client.workbookCatalog();
  const versionId = 'historical-roster';
  const created = await client.workbookLibraryAction(libraryId, {
    operationId: versionId, expectedRevision: entry.state.revision, expectedVersion: entry.version,
    change: { kind: 'create-version', name: 'Historical roster', from: { kind: 'version', versionId: entry.state.selectedVersionId }, useNow: false },
  });
  const path = `http://localhost/api/v1/workbooks/${libraryId}`;
  const remove = (operationId: string) => h.app.request(`${path}/library-actions`, {
    method: 'POST', headers, body: JSON.stringify({
      operationId, expectedRevision: created.result.revision, expectedVersion: entry.version,
      change: { kind: 'delete-version', versionId },
    }),
  });
  const assertInUse = async (operationId: string) => {
    const response = await remove(operationId);
    assert.equal(response.status, 409);
    expect(await response.json()).toMatchObject({ code: 'WORKBOOK_VERSION_IN_USE' });
  };

  const request = { typeId: ONBOARDING_ROSTER_TYPE_ID, libraryId, versionId, keys: ['retained@example.test'], fields: ['email'] };
  const snapshot = snapshotWorkbookReference(authority.workbooks, {
    ...request, kind: 'selected-source', mode: 'keys', sheetId: 'people', expectedVersion: entry.version, keyFieldId: 'email', writableFields: [],
  });
  const bound = bindRunWorkbookReference(request, snapshot);
  const planned = START_PLAN.planned.map(run => ({ ...run, workbookReferences: [bound] }));
  const plannedAt = h.clock.now().toISOString(), expiresAt = new Date(h.clock.nowMs() + 60_000).toISOString();
  assert.equal(authority.startPlans.create({
    ...START_PLAN, planned, plannedAt, expiresAt, createdAt: plannedAt, updatedAt: plannedAt,
    inputFingerprint: derivePlannedInputFingerprint(planned, START_PLAN.ingressSchemaHash, START_PLAN.canonicalInputSchemaHash),
  }).state, 'inserted');
  await assertInUse('delete-with-plan');

  const { people: [person] } = ReadCrmDocumentRows.example;
  const raw = { people: person.subject.value };
  const queued = RunRecordSchema.parse({
    ...QUEUED_RUN, claimGeneration: 1,
    envelope: { ...QUEUED_RUN.envelope, workflow: 'crm-doc-download', traceId: 'crm-170000-2222' },
    input: { ...QUEUED_RUN.input, raw, parsed: { schemaHash: deriveSchemaHash(CrmDocDownloadCanonicalInput, 'output'),
      protectedBindings: [], value: CrmDocDownloadInput.parse(raw) }, workbookReferences: [bound] },
  });
  authority.runs.enqueue(queued);
  h.clock.setWall(new Date(expiresAt));
  await assertInUse('delete-with-queued-run');
  const { runId, workflow, itemId, attempt, descriptorVersion, contractFingerprint } = queued.envelope;
  const finished = testRunService(h.database, h.clock).transition({
    commandId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', runId, expectedVersion: queued.version,
    lifecycle: { state: 'terminal', outcome: 'discarded', endedAt: expiresAt },
  });
  assert.equal(finished.state, 'applied');
  const referenceDigest = sha256Hex(canonicalJsonStringify(bound));
  authority.runCheckpoints.insert({
    workflowId: workflow, itemId, nodeId: 'document-rows', attempt, claimGeneration: queued.claimGeneration,
    runId, output: { schemaHash: deriveSchemaHash(ReadCrmDocumentRows.output, 'output'), value: ReadCrmDocumentRows.output.parse({
      referenceDigest, sourceDigests: [referenceDigest], state: 'resolve-required',
      people: [{ ...person, resolution: { state: 'resolve-required', reason: 'row-missing', candidates: [] } }],
    }) }, descriptorVersion, contractFingerprint, implFingerprint: HASH_B, provenance: [], writtenAt: expiresAt,
  });
  const before = buildRunWorkbookSection(authority, finished.run);
  expect(before.referenceChoices).toMatchObject([{ libraryId, referenceDigest, key: person.subject.value }]);

  assert.equal((await remove('delete-after-finish')).status, 200);
  assert.equal((await h.app.request(`${path}/versions/${versionId}`)).status, 404);
  const retained = authority.runs.get(runId);
  assert.ok(retained);
  assert.deepEqual(buildRunWorkbookSection(authority, retained), before);
  const retainedReference = retained.input.workbookReferences?.[0];
  assert.ok(retainedReference);
  expect(parseRunWorkbookReference(retainedReference).snapshot.rows).toEqual([{
    key: 'retained@example.test', state: 'matched',
    matches: [{ sheetId: 'people', rowId: 'retained', values: { email: 'retained@example.test' } }],
  }]);
});

it('creates a named version from SharePoint only after its download settles', async () => {
  let available = false, downloads = 0;
  const h = await harness({ workbookSync: { async withDownload(command, use) {
    downloads++;
    const bytes = new TextEncoder().encode('Label\r\nRemote\r\n').buffer;
    const result = await use({ name: 'Remote.csv', bytes }, { signal: command.signal, assertCurrent: () => command.signal.throwIfAborted() });
    if (!available) throw new WorkbookLibraryError('WORKBOOK_SYNC_CONTEXT_CHANGED');
    return result;
  } } });
  const client = workbookClient(h.app);
  const saved = await client.workbookCreate({ name: 'Local.csv', themes: [], hasFormulas: false, sheets: [{ id: 'label', name: 'Sheet 1',
    hidden: [], width: 1, rows: [{ id: 'header', cells: [{ value: 'Label' }] }, { id: 'local', cells: [{ value: 'Local' }] }] }] });
  const path = `http://localhost/api/v1/workbooks/${saved.libraryId}`;
  const action = (body: unknown) => h.app.request(`${path}/library-actions`, { method: 'POST', headers, body: JSON.stringify(body) });
  const change = { kind: 'create-version', name: 'Remote review', from: { kind: 'sharepoint' }, useNow: false };
  const unlinked = await action({ operationId: 'unlinked', expectedVersion: 1, expectedRevision: 1, change });
  assert.equal(unlinked.status, 409);
  assert.equal((await unlinked.json() as { code: string }).code, 'WORKBOOK_SYNC_LINK_REQUIRED');
  assert.equal(downloads, 0);

  await client.workbookLibraryAction(saved.libraryId, { operationId: 'link', expectedVersion: 1, expectedRevision: 1,
    change: { kind: 'link', url: 'https://example.sharepoint.com/sites/hr/Remote.csv' } });
  const [before] = await client.workbookCatalog();
  const request = { operationId: 'import-version', expectedVersion: before.version, expectedRevision: before.state.revision, change };
  const unsettled = await action(request);
  assert.equal(unsettled.status, 409);
  assert.equal((await unsettled.json() as { code: string }).code, 'WORKBOOK_SYNC_CONTEXT_CHANGED');
  assert.deepEqual((await client.workbookCatalog())[0], before);
  const status = await h.app.request(`${path}/library-actions/${request.operationId}`);
  assert.deepEqual(WorkbookLibraryActionStatusSchema.parse(await status.json()), { state: 'absent' });

  available = true;
  assert.equal((await action(request)).status, 200);
  const read = await h.app.request(`${path}/versions/${request.operationId}`);
  assert.equal(read.status, 200);
  const named = WorkbookLibraryVersionViewSchema.parse(await read.json());
  assert.equal(named.version.name, 'Remote review');
  assert.equal(named.version.source, 'sharepoint');
  assert.equal(named.workbook.sheets[0].rows[1].cells[0].value, 'Remote');
  const [after] = await client.workbookCatalog();
  assert.equal(after.state.selectedVersionId, before.state.selectedVersionId);
  const duplicate = await action({ ...request, operationId: 'duplicate-version', expectedVersion: after.version, expectedRevision: after.state.revision });
  assert.equal(duplicate.status, 409);
  assert.deepEqual(await duplicate.json(), { state: 'error', code: 'WORKBOOK_VERSION_NAME_EXISTS', message: 'A version with this name exists.', retryable: false });
  assert.equal((await action(request)).status, 200);
  assert.equal(downloads, 2);
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
    for (const sql of [...WORKBOOK_LIBRARY_MIGRATION.statements, ...WORKBOOK_MASTER_MIGRATION.statements, ...WORKBOOK_LIBRARY_CATALOG_MIGRATION.statements, ...WORKBOOK_LIBRARY_SYNC_STATUS_MIGRATION.statements, ...WORKBOOK_PAYLOAD_TABLE.statements]) database.exec(sql);
    const repository = createWorkbookLibraryRepository({ database, read: work => work(), mutate: work => work().result });
    let downloads = 0;
    const library = createWorkbookLibraryService({ repository, clock: manualClock(new Date('2026-11-02T00:00:00.000Z')),
      sync: { async withDownload(command, use) {
        downloads++;
        return use({ name: 'Remote.csv', bytes: new TextEncoder().encode('Label\nRemote\n').buffer },
          { signal: command.signal, assertCurrent: () => command.signal.throwIfAborted() });
      } } });
    const app: DashboardApp = new Hono();
    registerWorkbookRoutes(app, { workbooks: { library, workflows: [] } });
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
    for (const statement of [...WORKBOOK_LIBRARY_MIGRATION.statements, ...WORKBOOK_MASTER_MIGRATION.statements, ...WORKBOOK_LIBRARY_CATALOG_MIGRATION.statements, ...WORKBOOK_LIBRARY_SYNC_STATUS_MIGRATION.statements, ...WORKBOOK_PAYLOAD_TABLE.statements]) database.exec(statement);
    const record = installRetainedMergeFixture(database);
    const repository = createWorkbookLibraryRepository({ database, read: work => work(), mutate: work => work().result });
    const library = createWorkbookLibraryService({ repository, clock: manualClock(new Date(record.at)), sync: unexpectedWorkbookSync });
    const app: DashboardApp = new Hono();
    app.onError((error, context) => {
      if (!(error instanceof WorkbookLibraryError)) throw error;
      return context.json({ code: error.code }, 400);
    });
    registerWorkbookRoutes(app, { workbooks: { library, workflows: [] } });
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

it("refuses malformed workbook path encoding across reads and mutations", async () => {
  const h = await harness();
  const base = "http://localhost/api/v1/workbooks";
  const requests = [
    new Request(`${base}/%zz`),
    new Request(`${base}/%zz/history`),
    new Request(`${base}/%zz/revisions/1`),
    new Request(`${base}/example/versions/%zz`),
    new Request(`${base}/example/library-actions/%zz`),
    ...["clone", "library-actions", "save"].map(action =>
      new Request(`${base}/%zz/${action}`, { method: "POST", headers, body: "{}" })),
  ];
  const responses = await Promise.all(requests.map(async request => {
    const response = await h.app.request(request);
    return { url: request.url, status: response.status, body: await response.text(), bodyUsed: request.bodyUsed };
  }));
  for (const { url, status, body, bodyUsed } of responses) {
    assert.equal(status, 400, url);
    assert.match(body, /"code":"WORKBOOK_INVALID"/u, url);
    assert.equal(bodyUsed, false, url);
  }
});
