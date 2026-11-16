import assert from "node:assert/strict";
import { it } from "vitest";
import { createDashboardClient, DashboardClientError } from "../../../src/dashboard/client/index.js";
import { WorkbookImportRequestSchema, EditableWorkbookSchema, WorkbookCreateRequestSchema, WorkbookSaveRequestSchema, WorkbookIntakeRequestSchema, encodeSavedWorkbook, encodeEditableWorkbook, type SavedWorkbook } from "../../../src/models/dashboard/workbooks.js";
import { IsoInstantSchema } from "../../../src/rules/identity/ids.js";
import { FIXTURE_INTAKE_MAPPING } from "../../support/fixtures/dashboard/fixture-intake.js";
import { WorkbookLibraryActionResultSchema, WorkbookLibraryActionStatusSchema, WorkbookLibraryActionSchema, WorkbookLibraryActionRecordSchema, WorkbookLibraryEntrySchema } from "../../../src/models/dashboard/workbook-library.js";
import { WorkbookCompatibilitySchema } from "../../../src/models/dashboard/workbook-library.js";

const NOW = IsoInstantSchema.parse("2026-01-01T00:00:00.000Z");
const draft = EditableWorkbookSchema.parse({ name: "Dates.xlsx", themes: { theme1: "theme" }, hasFormulas: false,
  sheets: [{ id: "sheet", name: "Dates", width: 2, hidden: [1], sourceHeaderRow: 7,
    rows: [{ id: "row", cells: [{ value: new Date(NOW) }, { value: NOW }] }] }] });
function saved(version = 1, libraryId = "library /one"): SavedWorkbook {
  return { libraryId, version, createdAt: NOW, savedAt: NOW, workbook: { ...draft, libraryId } };
}
function harness(body: unknown, status = 200) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const client = createDashboardClient({ baseUrl: "http://workbooks.test", fetchImpl: async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  } });
  return { client, calls };
}
function requestBody(call: { init: RequestInit | undefined }): string {
  assert.ok(typeof call.init?.body === "string");
  return call.init.body;
}
function schemaFailure(error: unknown): boolean {
  assert.ok(error instanceof DashboardClientError);
  assert.equal(error.kind, "schema");
  return true;
}
it('reads only strict compatibility wire from the dedicated GET route', async () => {
  const empty = WorkbookCompatibilitySchema.parse({ workflows: [], libraries: [] });
  const read = harness(empty);
  assert.deepEqual(await read.client.workbookCompatibility(), empty);
  assert.equal(read.calls[0].url, 'http://workbooks.test/api/v1/workbooks/compatibility');
  await assert.rejects(harness({ ...empty, extra: true }).client.workbookCompatibility(), schemaFailure);
});

it('binds catalogue changes and result lookups to the exact library and action', async () => {
  const record = saved(), version = { id: 'original', snapshotId: JSON.stringify([record.libraryId, 'original']), name: 'Original version', version: 1, savedAt: NOW, source: 'import' };
  const entry = WorkbookLibraryEntrySchema.parse({ libraryId: record.libraryId, version: 1, name: record.workbook.name, updatedAt: NOW,
    rowCount: 0, worksheets: [{ id: 'sheet', name: 'Dates' }], metadata: { typeId: 'general', sharePoint: null },
    type: { id: 'general', name: 'General workbook', keyFieldId: null, fields: [], defaultWorkbookId: null },
    state: { libraryId: record.libraryId, revision: 1, selectedVersionId: 'original', removed: false, pinned: false, tags: [], origin: { kind: 'local' }, versions: [version] } });
  assert.deepEqual(await harness([entry]).client.workbookCatalog(), [entry]);
  await assert.rejects(harness([entry, entry]).client.workbookCatalog(), schemaFailure);
  const action = WorkbookLibraryActionSchema.parse({ operationId: 'rename /one', expectedRevision: 1, expectedVersion: 1,
    change: { kind: 'rename-version', versionId: 'original', name: 'Reviewed' } });
  const result = WorkbookLibraryActionRecordSchema.parse({ libraryId: record.libraryId, action, at: NOW,
    result: { ...entry.state, revision: 2, versions: [{ ...version, name: 'Reviewed' }] } });
  const applied = harness(result);
  assert.deepEqual(await applied.client.workbookLibraryAction(record.libraryId, action), result);
  assert.equal(applied.calls[0].url, 'http://workbooks.test/api/v1/workbooks/library%20%2Fone/library-actions');
  assert.deepEqual(JSON.parse(requestBody(applied.calls[0])), action);
  await assert.rejects(harness(result).client.workbookLibraryAction('another-library', action), schemaFailure);
  const status = harness({ state: 'recorded', record: result });
  assert.deepEqual(await status.client.workbookLibraryActionStatus(record.libraryId, action.operationId), { state: 'recorded', record: result });
  assert.equal(status.calls[0].url, 'http://workbooks.test/api/v1/workbooks/library%20%2Fone/library-actions/rename%20%2Fone');
  await assert.rejects(harness({ state: 'recorded', record: result }).client.workbookLibraryActionStatus(record.libraryId, 'other-action'), schemaFailure);
  const exact = { libraryId: record.libraryId, version: entry.state.versions[0], workbook: encodeSavedWorkbook(record).workbook };
  assert.deepEqual(await harness(exact).client.workbookLibraryVersion(record.libraryId, 'original'), exact);
  await assert.rejects(harness(exact).client.workbookLibraryVersion(record.libraryId, 'another-version'), schemaFailure);
});

it("lists, opens and reconstructs Date cells without converting ISO strings", async () => {
  const record = saved();
  const list = harness([encodeSavedWorkbook(record)]);
  assert.deepEqual(await list.client.workbookList(), [record]);
  assert.equal(list.calls[0].url, "http://workbooks.test/api/v1/workbooks/list");
  const open = harness(encodeSavedWorkbook(record));
  assert.deepEqual(await open.client.workbookOpen(record.libraryId), record);
  assert.equal(open.calls[0].url, "http://workbooks.test/api/v1/workbooks/library%20%2Fone");
  const empty = harness([]);
  assert.deepEqual(await empty.client.workbookList(), []);
});

it("creates and saves exact canonical content with explicit version and Date encoding", async () => {
  const first = saved();
  const create = harness(encodeSavedWorkbook(first), 201);
  assert.deepEqual(await create.client.workbookCreate({ ...draft, libraryId: undefined }), first);
  assert.equal(create.calls[0].url, "http://workbooks.test/api/v1/workbooks");
  assert.equal(create.calls[0].init?.method, "POST");
  const request = WorkbookCreateRequestSchema.parse(JSON.parse(requestBody(create.calls[0])));
  assert.deepEqual(request.workbook.sheets[0].rows[0].cells.map((cell: { value: unknown }) => cell.value), [{ type: "date", value: NOW }, NOW]);
  const next = saved(2);
  const save = harness(encodeSavedWorkbook(next));
  assert.deepEqual(await save.client.workbookSave(first.libraryId, 1, first.workbook), next);
  assert.equal(save.calls[0].url, "http://workbooks.test/api/v1/workbooks/library%20%2Fone/save");
  assert.deepEqual(WorkbookSaveRequestSchema.parse(JSON.parse(requestBody(save.calls[0]))), { expectedVersion: 1, workbook: encodeSavedWorkbook(first).workbook });
});
it('reads only the requested revision identity and rejects invalid revisions before transport', async () => {
  const record = saved(2), h = harness(encodeSavedWorkbook(record));
  assert.deepEqual(await h.client.workbookRevision(record.libraryId, 2), record);
  assert.equal(h.calls[0].url, 'http://workbooks.test/api/v1/workbooks/library%20%2Fone/revisions/2');
  for (const wrong of [saved(1), saved(2, 'foreign')])
    await assert.rejects(harness(encodeSavedWorkbook(wrong)).client.workbookRevision(record.libraryId, 2), schemaFailure);
  const invalid = harness({});
  for (const version of [0, -1, 1.5, NaN]) await assert.rejects(invalid.client.workbookRevision(record.libraryId, version), schemaFailure);
  assert.equal(invalid.calls.length, 0);
});

it("rejects malformed responses, duplicate list IDs and foreign open identity", async () => {
  const malformed = encodeSavedWorkbook(saved());
  Reflect.set(malformed.workbook.sheets[0].rows[0].cells[0], "value", { type: "date", value: "invalid" });
  for (const body of [{}, malformed]) {
    await assert.rejects(harness(body).client.workbookOpen("library /one"), schemaFailure);
  }
  const record = encodeSavedWorkbook(saved());
  await assert.rejects(harness([record, record]).client.workbookList(), schemaFailure);
  await assert.rejects(harness(record).client.workbookOpen("another"), schemaFailure);
});

it("rejects incorrect create/save content and revisions", async () => {
  const first = saved();
  for (const body of [encodeSavedWorkbook(saved(2)), encodeSavedWorkbook({ ...first, workbook: { ...first.workbook, name: "Changed.xlsx" } })]) {
    await assert.rejects(harness(body).client.workbookCreate(draft), schemaFailure);
  }
  for (const record of [saved(1), saved(3), saved(2, "foreign"), { ...saved(2), workbook: { ...first.workbook, name: "Changed.xlsx" } }]) {
    await assert.rejects(harness(encodeSavedWorkbook(record)).client.workbookSave(first.libraryId, 1, first.workbook), schemaFailure);
  }
  const invalid = harness({});
  await assert.rejects(invalid.client.workbookSave("foreign", 1, first.workbook), schemaFailure);
  await assert.rejects(invalid.client.workbookCreate(first.workbook), schemaFailure);
  await assert.rejects(invalid.client.workbookCreate({}), schemaFailure);
  assert.equal(invalid.calls.length, 0);
});

it("preserves typed conflicts and performs no retry", async () => {
  const h = harness({ state: "error", code: "WORKBOOK_VERSION_CONFLICT", message: "Read its current version before saving.", retryable: false }, 409);
  await assert.rejects(h.client.workbookSave("library /one", 1, saved().workbook), (error: unknown) => {
    assert.ok(error instanceof DashboardClientError);
    assert.equal(error.kind, "http"); assert.equal(error.status, 409); assert.equal(error.code, "WORKBOOK_VERSION_CONFLICT");
    return true;
  });
  assert.equal(h.calls.length, 1);
});

it("requires named snapshot history to retain owner and nondecreasing master revisions", async () => {
  const history = [saved(1), saved(2)];
  const h = harness(history.map(encodeSavedWorkbook));
  assert.deepEqual(await h.client.workbookHistory("library /one"), history);
  assert.equal(h.calls[0].url, "http://workbooks.test/api/v1/workbooks/library%20%2Fone/history");
  for (const records of [[], [saved(2)], [saved(1), saved(1)]]) assert.deepEqual(await harness(records.map(encodeSavedWorkbook)).client.workbookHistory("library /one"), records);
  for (const records of [[saved(2), saved(1)], [saved(1), saved(2, "foreign")], [saved(1), { ...saved(2), createdAt: "2025-12-31T00:00:00.000Z" }]]) {
    await assert.rejects(harness(records.map(encodeSavedWorkbook)).client.workbookHistory("library /one"), schemaFailure);
  }
});

it("bridges the exact workbook revision and workflow, retaining typed refusals", async () => {
  const session = { ...FIXTURE_INTAKE_MAPPING, workbookSource: { libraryId: "library /one", version: 2 } };
  for (const [state, status] of [["created", 201], ["joined", 200]] as const) {
    const h = harness({ state, session }, status);
    assert.deepEqual(await h.client.workbookIntake("library /one", 2, session.workflow), { state, session });
    assert.equal(h.calls[0].url, "http://workbooks.test/api/v1/workbooks/library%20%2Fone/intake");
    assert.deepEqual(WorkbookIntakeRequestSchema.parse(JSON.parse(requestBody(h.calls[0]))), { expectedVersion: 2, workflowId: session.workflow });
  }
  const refusal = { state: "refused", code: "INTAKE_UNREADABLE_FILE", message: "Cannot read workbook." };
  assert.deepEqual(await harness(refusal, 422).client.workbookIntake("library /one", 2, session.workflow), refusal);
  for (const body of [
    { state: "created", session: { ...session, workbookSource: undefined } },
    { state: "created", session: { ...session, workbookSource: { libraryId: "foreign", version: 2 } } },
    { state: "created", session: { ...session, workbookSource: { libraryId: "library /one", version: 1 } } },
    { state: "created", session: { ...session, workflow: "another-workflow" } },
  ]) await assert.rejects(harness(body, 201).client.workbookIntake("library /one", 2, session.workflow), schemaFailure);
  await assert.rejects(harness({ state: "created", session }, 200).client.workbookIntake("library /one", 2, session.workflow), schemaFailure);
  await assert.rejects(harness(refusal, 200).client.workbookIntake("library /one", 2, session.workflow), schemaFailure);
  await assert.rejects(harness({ state: "created", session }, 422).client.workbookIntake("library /one", 2, session.workflow), schemaFailure);
});


it('imports a plain workbook at version one and rejects retired purpose or reference fields', async () => {
  const body = { workbook: encodeSavedWorkbook(saved()) };
  const h = harness(body, 201);
  assert.deepEqual(await h.client.workbookImport(draft), body);
  assert.equal(h.calls[0].url, 'http://workbooks.test/api/v1/workbooks/import');
  assert.deepEqual(WorkbookImportRequestSchema.parse(JSON.parse(requestBody(h.calls[0]))), { workbook: encodeEditableWorkbook(draft) });
  for (const extra of [{ purpose: { kind: 'other' } }, { reference: null }]) {
    await assert.rejects(harness({ ...body, ...extra }, 201).client.workbookImport(draft), schemaFailure);
  }
  await assert.rejects(harness({ workbook: encodeSavedWorkbook(saved(2)) }, 201).client.workbookImport(draft), schemaFailure);
});

it('reads grouped results through the typed facade and rejects malformed group data', async () => {
  const h = harness({ workflows: [], unavailable: [] });
  assert.deepEqual(await h.client.workbookResults(), { workflows: [], unavailable: [] });
  assert.equal(h.calls[0].url, 'http://workbooks.test/api/v1/workbooks/results');
  await assert.rejects(harness({ workflows: [], unavailable: [], extra: true }).client.workbookResults(), schemaFailure);
});

it('rejects merge requests before transport and refuses historical merge records on active result/status wires', async () => {
  const action = { operationId: 'retired-merge', expectedRevision: 1, expectedVersion: 1,
    change: { kind: 'merge', name: 'Merged.xlsx', duplicates: 'keep-both', sources: [{ libraryId: 'source', expectedVersion: 1, expectedRevision: 1 }] } };
  const result = WorkbookLibraryActionRecordSchema.parse({ libraryId: 'target', action, at: NOW,
    result: { libraryId: 'target', revision: 2, selectedVersionId: 'original', origin: { kind: 'local' }, removed: false, pinned: false, tags: [],
      versions: [{ id: 'original', snapshotId: '["target","original"]', name: 'Original', version: 1, savedAt: NOW, source: 'import' }] } });
  assert.equal(WorkbookLibraryActionSchema.safeParse(action).success, false);
  assert.equal(WorkbookLibraryActionResultSchema.safeParse(result).success, false);
  assert.equal(WorkbookLibraryActionStatusSchema.safeParse({ state: 'recorded', record: result }).success, false);
  const h = harness(result);
  const current = WorkbookLibraryActionSchema.parse({ ...action, change: { kind: 'remove' } });
  Reflect.set(current, 'change', action.change);
  await assert.rejects(h.client.workbookLibraryAction('target', current), schemaFailure);
  assert.equal(h.calls.length, 0);
  await assert.rejects(harness(result).client.workbookLibraryAction('target', { ...current, change: { kind: 'remove' } }), schemaFailure);
  await assert.rejects(harness({ state: 'recorded', record: result }).client.workbookLibraryActionStatus('target', action.operationId), schemaFailure);
  const retired = { state: 'retired', code: 'WORKBOOK_ACTION_RETIRED', message: 'This library action has been retired. Its retained evidence is unavailable here.' };
  assert.deepEqual(await harness(retired).client.workbookLibraryActionStatus('target', action.operationId), retired);
  await assert.rejects(harness({ ...retired, record: result }).client.workbookLibraryActionStatus('target', action.operationId), schemaFailure);
});
