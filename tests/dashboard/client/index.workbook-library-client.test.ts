import assert from "node:assert/strict";
import { it } from "vitest";
import { createDashboardClient, DashboardClientError } from "../../../src/dashboard/client/index.js";
import { EditableWorkbookSchema, WorkbookCreateRequestSchema, WorkbookSaveRequestSchema, WorkbookIntakeRequestSchema, encodeSavedWorkbook, type SavedWorkbook } from "../../../src/models/dashboard/workbooks.js";
import { IsoInstantSchema } from "../../../src/rules/identity/ids.js";
import { FIXTURE_INTAKE_MAPPING } from "../../support/fixtures/dashboard/fixture-intake.js";

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

it("requires history to contain one owner's complete ordered revisions", async () => {
  const history = [saved(1), saved(2)];
  const h = harness(history.map(encodeSavedWorkbook));
  assert.deepEqual(await h.client.workbookHistory("library /one"), history);
  assert.equal(h.calls[0].url, "http://workbooks.test/api/v1/workbooks/library%20%2Fone/history");
  for (const records of [[], [saved(2)], [saved(1), saved(1)], [saved(2), saved(1)], [saved(1), saved(2, "foreign")], [saved(1), { ...saved(2), createdAt: "2025-12-31T00:00:00.000Z" }]]) {
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
