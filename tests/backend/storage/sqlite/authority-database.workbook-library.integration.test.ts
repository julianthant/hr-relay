import { unexpectedWorkbookSync } from "../../../support/helpers/backend/workbook-sync.js";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { execFileSync } from "node:child_process";
import { afterEach, it } from "vitest";
import { testProcessImport } from "../../../support/compiled-process.js";
import { createBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";
import { AuthorityDatabase, inspectAuthorityBackupReadOnly } from "../../../support/helpers/synthetic-storage-admission.js";
import { WorkbookLibraryError } from "../../../../src/backend/workbooks/workbook-library-error.js";
import { createWorkbookLibraryService } from "../../../../src/backend/workbooks/workbook-library-service.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { bindOcrRoster } from "../../../../src/rules/spreadsheets/ocr-roster.js";
import { deriveSchemaHash } from "../../../../src/models/validation/schema-bound-value.js";
import { encodeSavedWorkbook, RunWorkbookAllRowsReferenceSchema } from "../../../../src/models/dashboard/workbooks.js";
import { createDebugEventWriter } from "../../../../src/backend/logs/debug-events.js";

const profiles: Awaited<ReturnType<typeof createBoundProfileFixture>>[] = [];
const clock = manualClock(new Date("2026-10-15T12:00:00.000Z"));
const workbook = { name: "Dates.xlsx", themes: [], hasFormulas: false, sheets: [{ id: "sheet", name: "Dates", width: 1, hidden: [], rows: [{ id: "row", cells: [{ value: new Date("2026-01-01T00:00:00.000Z") }] }] }] };
async function fixture() {
  const profile = await createBoundProfileFixture();
  profiles.push(profile);
  const open = () => AuthorityDatabase.open({ path: profile.path, busyTimeoutMs: 250, migrationOwner: "workbook-test" }, clock);
  return { path: profile.path, open };
}
afterEach(async () => { for (const profile of profiles.splice(0)) await profile.close(); });

it("captures all roster data rows at the selected version and leaves keyed-empty references empty", async () => {
  const f = await fixture(), database = f.open();
  try {
    const repository = database.authority.workbooks;
    const service = createWorkbookLibraryService({ sync: unexpectedWorkbookSync, repository, clock });
    const first = service.create({ name: "Roster", themes: [], hasFormulas: false, sheets: [{
      id: "people", name: "People", width: 2, hidden: [], headerRow: 1,
      columnBindings: ["eid", "fullName"].map((fieldId, index) => ({ id: fieldId, sourceColumn: index,
        sourceHeader: fieldId, fieldId, basis: "manual" })),
      rows: [
        { id: "header", cells: [{ value: "EID" }, { value: "Name" }] },
        { id: "one", cells: [{ value: "10000001" }, { value: "Example, Avery" }] },
        { id: "two", cells: [{ value: "10000001" }, { value: "Example, Avery" }] },
        { id: "missing", cells: [{ value: null }, { value: null }] },
      ],
    }] });
    repository.putType({ id: "ocr-roster", name: "OCR roster", keyFieldId: "eid", fields: ["eid", "fullName"], defaultWorkbookId: null });
    service.operatorOperation(first.libraryId, "set-type", { kind: "metadata", expectedVersion: 1, metadata: { typeId: "ocr-roster", sharePoint: null } });
    const request = { mode: "all" as const, typeId: "ocr-roster", libraryId: first.libraryId, expectedVersion: 2,
      fields: ["eid", "fullName"] };
    const reference = RunWorkbookAllRowsReferenceSchema.parse({ request, snapshot: repository.snapshot(request) });
    const { roster: captured } = bindOcrRoster([{ schemaHash: deriveSchemaHash(RunWorkbookAllRowsReferenceSchema, "output"), value: reference }], clock.now().toISOString());
    assert.deepEqual(captured.rows.map(row => row.eid), ["10000001", null]);
    assert.deepEqual(reference.snapshot.rows.map(row => row.matches[0].rowId), ["one", "two", "missing"]);
    assert.deepEqual(repository.snapshot({ typeId: "ocr-roster", libraryId: first.libraryId, keys: [], fields: ["eid", "fullName"] }).rows, []);
    const current = service.read(first.libraryId);
    const changed = structuredClone(current.workbook); changed.sheets[0].rows[1].cells[1].value = "Example, Changed";
    service.save(first.libraryId, 2, changed);
    assert.throws(() => repository.snapshot(request), { code: "WORKBOOK_VERSION_CONFLICT" });
    assert.equal(captured.rows[0].name, "Example, Avery");
    assert.equal(captured.workbookVersion, 2);
  } finally { database.close(); }
});

it("accounts separately for durable admission and atomic master settlement, persists dates, and refuses stale saves", async () => {
  const f = await fixture();
  let database = f.open();
  try {
    const service = () => createWorkbookLibraryService({ sync: unexpectedWorkbookSync, repository: database.authority.workbooks, clock });
    const first = service().create(workbook);
    assert.equal(database.getMeta().authorityGeneration, 1);
    const second = service().save(first.libraryId, 1, { ...first.workbook, name: "Saved.xlsx" });
    assert.equal(database.getMeta().authorityGeneration, 3);
    assert.throws(() => service().save(first.libraryId, 1, first.workbook), { code: "WORKBOOK_VERSION_CONFLICT" });
    assert.equal(database.getMeta().authorityGeneration, 5);
    const inspection = database.inspectSchema();
    const fingerprint = inspectAuthorityBackupReadOnly(f.path).authorityContentFingerprint;
    database.close(); database = f.open();
    assert.deepEqual(service().read(first.libraryId), second);
    assert.deepEqual(service().history(first.libraryId), []);
    assert.deepEqual(database.inspectSchema(), inspection);
    assert.equal(inspectAuthorityBackupReadOnly(f.path).authorityContentFingerprint, fingerprint);
    assert.throws(() => database.withAuthorityTransaction(() => {
      service().save(second.libraryId, 2, { ...second.workbook, name: "Rolled back.xlsx" });
      throw new Error("rollback-workbook");
    }), /rollback-workbook/u);
    assert.equal(database.getMeta().authorityGeneration, 5);
    assert.deepEqual(service().history(first.libraryId), []);
  } finally { database.close(); }
});

it.each(["head", "creation-value", "creation-missing"])("refuses corrupt workbook %s during authority admission", async corruption => {
  const f = await fixture(), database = f.open();
  const service = createWorkbookLibraryService({ sync: unexpectedWorkbookSync, repository: database.authority.workbooks, clock });
  const first = service.create(workbook);
  service.save(first.libraryId, 1, { ...first.workbook, name: "Second.xlsx" });
  database.close();
  const raw = new DatabaseSync(f.path);
  try {
    if (corruption === "head") raw.prepare("UPDATE workbook_library SET saved_at=? WHERE id=?").run("2026-10-16T00:00:00.000Z", first.libraryId);
    else {
      const triggers = raw.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND tbl_name='workbook_creations'").all();
      raw.exec("DROP TRIGGER workbook_creations_immutable; DROP TRIGGER workbook_creations_retained");
      if (corruption === "creation-value") raw.prepare("UPDATE workbook_creations SET payload_json='{}' WHERE id=?").run(first.libraryId);
      else raw.prepare("DELETE FROM workbook_creations WHERE id=?").run(first.libraryId);
      for (const trigger of triggers) if (typeof trigger.sql === 'string' && /^CREATE TRIGGER workbook_creations_(?:immutable|retained)\b/u.test(trigger.sql)) raw.exec(trigger.sql);

    }
  } finally { raw.close(); }
  assert.throws(f.open, error => error instanceof Error && error.cause instanceof WorkbookLibraryError
    && error.cause.code === "WORKBOOK_STORAGE_CORRUPT");
});

it("refuses a snapshot that names another library's valid workbook payload", async () => {
  const f = await fixture(), database = f.open();
  const service = createWorkbookLibraryService({ sync: unexpectedWorkbookSync, repository: database.authority.workbooks, clock });
  const first = service.create(workbook), second = service.create({ ...workbook, name: "Another.xlsx" });
  database.close();
  const raw = new DatabaseSync(f.path);
  try {
    const { payload_json } = raw.prepare("SELECT payload_json FROM workbook_library WHERE id=?").get(second.libraryId) ?? {};
    const { sql } = raw.prepare("SELECT sql FROM sqlite_master WHERE name='workbook_library_snapshots_update'").get() ?? {};
    if (typeof payload_json !== "string" || typeof sql !== "string") throw new Error("workbook corruption fixture is incomplete");
    raw.exec("DROP TRIGGER workbook_library_snapshots_update");
    assert.equal(raw.prepare(`UPDATE workbook_library_snapshots SET payload_json=json_set(payload_json,
      '$.workbookDigest', json_extract(?, '$.workbookDigest')) WHERE workbook_id=?`).run(payload_json, first.libraryId).changes, 1);
    raw.exec(sql);
  } finally { raw.close(); }
  assert.throws(f.open, error => error instanceof Error && error.cause instanceof WorkbookLibraryError
    && error.cause.code === "WORKBOOK_STORAGE_CORRUPT");
});

it('accounts for workflow selections once, rolls them back atomically and validates them on normal readback', async () => {
  const f = await fixture();
  let database = f.open();
  try {
    const value = { workflowId: 'person-lookup', acceptedCommandId: '11111111-1111-4111-8111-111111111111', usedAt: clock.now().toISOString(),
      sources: [{ libraryId: 'removed-or-stale', sheetId: 'people' }] };
    const before = database.getMeta().authorityGeneration;
    assert.equal(database.authority.workbooks.lastUsed(value.workflowId), undefined);
    assert.equal(database.getMeta().authorityGeneration, before);
    const first = database.authority.workbooks.rememberLastUsed(value);
    assert.equal(database.getMeta().authorityGeneration, before + 1);
    assert.deepEqual(database.authority.workbooks.rememberLastUsed(value), first);
    assert.equal(database.getMeta().authorityGeneration, before + 1);
    assert.throws(() => database.withAuthorityTransaction(repositories => {
      repositories.workbooks.rememberLastUsed({ ...value, acceptedCommandId: '22222222-2222-4222-8222-222222222222' });
      throw new Error('rollback-selection');
    }), /rollback-selection/u);
    assert.deepEqual(database.authority.workbooks.lastUsed(value.workflowId), first);
    assert.equal(database.getMeta().authorityGeneration, before + 1);
    database.close(); database = f.open();
    assert.deepEqual(database.authority.workbooks.lastUsed(value.workflowId), first);
  } finally { database.close(); }
  const raw = new DatabaseSync(f.path);
  try { raw.exec('UPDATE workflow_workbook_selections SET revision=revision+1'); } finally { raw.close(); }
  assert.throws(f.open, /workflow_workbook_selections/u);
});

it('reuses frozen workbook reads and selected snapshots until authority changes', async () => {
  const f = await fixture(), database = f.open();
  try {
    const repository = database.authority.workbooks;
    const service = createWorkbookLibraryService({ repository, sync: unexpectedWorkbookSync, clock });
    const created = service.create({ ...workbook, sheets: [{ id: 'sheet', name: 'People', width: 2, hidden: [],
      rows: [{ id: 'row', cells: [{ value: 'Synthetic value' }, { value: new Date('2026-01-01T00:00:00.000Z') }] }] }] });
    const first = service.read(created.libraryId);
    assert.strictEqual(service.read(created.libraryId), first);
    assert.strictEqual(repository.list()[0], first);
    assert.strictEqual(repository.catalog(), repository.catalog());
    assert.equal(Reflect.set(repository.catalog()[0], 'name', 'Changed'), false);
    assert.strictEqual(repository.libraryVersion(created.libraryId).workbook,
      repository.libraryVersion(created.libraryId).workbook);
    assert.equal(Object.isFrozen(first), true);
    assert.equal(Object.isFrozen(first.workbook.sheets[0].rows[0].cells[0]), true);
    assert.equal(Reflect.set(first.workbook.sheets[0].rows[0].cells[0], 'value', 'Changed'), false);
    assert.equal(service.read(created.libraryId).workbook.sheets[0].rows[0].cells[0].value, 'Synthetic value');
    const date = first.workbook.sheets[0].rows[0].cells[1].value;
    assert(date instanceof Date);
    date.setUTCFullYear(2040);
    assert.deepEqual(service.read(created.libraryId).workbook.sheets[0].rows[0].cells[1].value,
      new Date('2026-01-01T00:00:00.000Z'));
    const selected = repository.libraryVersion(created.libraryId).workbook;
    assert.equal(Reflect.set(selected.sheets[0].rows[0].cells[0], 'value', 'Changed'), false);
    assert.equal(repository.libraryVersion(created.libraryId).workbook.sheets[0].rows[0].cells[0].value, 'Synthetic value');
  } finally { database.close(); }
});

it('refreshes cached workbooks after own and cross-process commits and discards rolled-back reads', async () => {
  const f = await fixture(), database = f.open();
  try {
    const repository = database.authority.workbooks;
    const service = createWorkbookLibraryService({ repository, sync: unexpectedWorkbookSync, clock });
    const first = service.create(workbook);
    const before = repository.catalog();
    const second = service.save(first.libraryId, 1, { ...first.workbook, name: 'Updated.xlsx' });
    assert.deepEqual(service.read(first.libraryId), second);
    assert.equal(repository.list()[0].workbook.name, 'Updated.xlsx');
    assert.equal(repository.catalog()[0].name, 'Updated.xlsx');
    assert.notStrictEqual(repository.catalog(), before);
    const savedWire = service.listWire()[0];
    assert.equal(savedWire.workbook.name, 'Updated.xlsx');
    assert.throws(() => database.withAuthorityTransaction(() => {
      service.save(first.libraryId, 2, { ...second.workbook, name: 'Rolled back.xlsx' });
      assert.equal(service.read(first.libraryId).workbook.name, 'Rolled back.xlsx');
      assert.equal(repository.list()[0].workbook.name, 'Rolled back.xlsx');
      assert.equal(repository.catalog()[0].name, 'Rolled back.xlsx');
      assert.equal(service.listWire()[0].workbook.name, 'Rolled back.xlsx');
      throw new Error('rollback-cached-workbook');
    }), /rollback-cached-workbook/u);
    assert.deepEqual(service.read(first.libraryId), second);
    assert.equal(repository.list()[0].workbook.name, 'Updated.xlsx');
    assert.equal(repository.catalog()[0].name, 'Updated.xlsx');
    assert.strictEqual(service.listWire()[0], savedWire);
    const key = database.changeKey();
    const operation = { operationId: 'external-workbook-save', source: { kind: 'operator' }, at: clock.now().toISOString(),
      change: { kind: 'save', expectedVersion: 2, workbook: { ...encodeSavedWorkbook(second).workbook, name: 'External.xlsx' } } };
    const result = execFileSync(process.execPath, ['--import', testProcessImport(), '--input-type=module', '--eval', `
      import { DatabaseSync } from 'node:sqlite';
      import { configureWritableConnection } from ${JSON.stringify(new URL('../../../../src/backend/storage/sqlite/authority-connection.js', import.meta.url).href)};
      import { createWorkbookLibraryRepository } from ${JSON.stringify(new URL('../../../../src/backend/storage/sqlite/workbook-library-repository.js', import.meta.url).href)};
      const [path, id, operation] = process.argv.slice(1);
      const database = new DatabaseSync(path);
      configureWritableConnection(database, 5000);
      const transaction = work => {
        database.exec('BEGIN IMMEDIATE');
        try { const result = work(); database.exec('COMMIT'); return result; }
        catch (error) { database.exec('ROLLBACK'); throw error; }
      };
      try {
        const repository = createWorkbookLibraryRepository({ database, read: transaction, mutate: work => transaction(() => work().result) });
        process.stdout.write(repository.operation(id, JSON.parse(operation)).state);
      } finally { database.close(); }
    `, f.path, first.libraryId, JSON.stringify(operation)], { encoding: 'utf8' });
    assert.equal(result, 'applied');
    assert.notEqual(database.changeKey().dataVersion, key.dataVersion);
    assert.equal(database.changeKey().authorityGeneration, key.authorityGeneration);
    assert.equal(service.read(first.libraryId).workbook.name, 'External.xlsx');
    assert.equal(repository.list()[0].version, 3);
    assert.equal(repository.catalog()[0].name, 'External.xlsx');
    assert.equal(service.listWire()[0].workbook.name, 'External.xlsx');
    assert.equal(service.listWire()[0].version, 3);
    assert.strictEqual(service.read(first.libraryId), repository.list()[0]);
  } finally { database.close(); }
});

it('rechecks collections after diagnostic writes while reusing unchanged decoded rows', async () => {
  const f = await fixture(), database = f.open();
  try {
    const repository = database.authority.workbooks;
    const service = createWorkbookLibraryService({ repository, sync: unexpectedWorkbookSync, clock });
    const created = service.create(workbook);
    const first = service.read(created.libraryId), list = repository.list(), catalog = repository.catalog();
    const selected = repository.libraryVersion(created.libraryId).workbook;
    const key = database.changeKey();
    createDebugEventWriter({ repository: database.authority.timelineEvents, clock, build: 'test' }).emit({
      category: 'http', phase: 'settled', area: 'storage', reason: 'slow-operation', code: 'read-snapshot',
      durationMs: 123, correlationId: 'synthetic-slow-read',
    });
    assert.notDeepEqual(database.changeKey(), key);
    assert.strictEqual(service.read(created.libraryId), first);
    assert.notStrictEqual(repository.list(), list);
    assert.strictEqual(repository.list()[0], first);
    assert.notStrictEqual(repository.catalog(), catalog);
    assert.strictEqual(repository.libraryVersion(created.libraryId).workbook, selected);
  } finally { database.close(); }
});

it('reuses frozen wire records across diagnostic writes and refreshes edited workbooks', async () => {
  const f = await fixture(), database = f.open();
  try {
    const service = createWorkbookLibraryService({ repository: database.authority.workbooks, sync: unexpectedWorkbookSync, clock });
    const created = service.create(workbook);
    const first = service.listWire()[0];
    assert.deepEqual(first, encodeSavedWorkbook(created));
    assert.strictEqual(service.listWire()[0], first);
    assert.equal(Reflect.set(first.workbook.sheets[0].rows[0].cells[0], 'value', 'Changed'), false);
    createDebugEventWriter({ repository: database.authority.timelineEvents, clock, build: 'test' }).emit({
      category: 'http', phase: 'settled', area: 'storage', reason: 'slow-operation', code: 'read-snapshot',
      durationMs: 123, correlationId: 'synthetic-wire-read',
    });
    assert.strictEqual(service.listWire()[0], first);
    service.save(created.libraryId, 1, { ...created.workbook, name: 'Edited.xlsx' });
    const edited = service.listWire()[0];
    assert.notStrictEqual(edited, first);
    assert.equal(edited.version, 2);
    assert.equal(edited.workbook.name, 'Edited.xlsx');
    assert.equal(first.workbook.name, 'Dates.xlsx');
    assert.deepEqual(edited, encodeSavedWorkbook(service.read(created.libraryId)));
  } finally { database.close(); }
});
