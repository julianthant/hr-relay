import type { EditableWorkbook } from "../../../src/models/dashboard/workbooks.js";
import { DatabaseSync } from "node:sqlite";
import Excel from "exceljs";
import { afterEach, expect, it } from "vitest";
import { createWorkbookLibraryRepository, WORKBOOK_LIBRARY_MIGRATION } from "../../../src/backend/storage/sqlite/workbook-library-repository.js";
import { createWorkbookLibraryService, WorkbookLibraryError } from "../../../src/backend/workbooks/workbook-library-service.js";
import { manualClock } from "../../../src/rules/time/clock.js";

const databases: DatabaseSync[] = [];
afterEach(() => { for (const database of databases.splice(0)) database.close(); });
function fixture() {
  const database = new DatabaseSync(":memory:"); databases.push(database);
  for (const statement of WORKBOOK_LIBRARY_MIGRATION.statements) database.exec(statement);
  const transaction = <T>(work: () => T): T => {
    database.exec("BEGIN IMMEDIATE");
    try { const result = work(); database.exec("COMMIT"); return result; }
    catch (error) { database.exec("ROLLBACK"); throw error; }
  };
  const repository = createWorkbookLibraryRepository({ database, mutate: work => transaction(() => work().result), read: transaction });
  const clock = manualClock(new Date("2026-10-12T12:00:00.000Z"));
  return { database, clock, service: createWorkbookLibraryService({ repository, clock }) };
}
function workbook(): EditableWorkbook {
  return {
    name: "Roster.xlsx", themes: ["<theme>original</theme>"], hasFormulas: true,
    sheets: [{ id: "sheet-a", name: "People", width: 2, hidden: [1], headerRow: 1, sourceHeaderRow: 7,
      columnBindings: [{ id: "binding-a", sourceColumn: 4, sourceHeader: "Employee ID", fieldId: "eid", basis: "manual" }, { id: "binding-b", sourceColumn: null, sourceHeader: "Notes", fieldId: "roster.notes", basis: "header" }],
      rows: [{ id: "source-7", cells: [{ value: "Employee ID", fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FFFF0000" } }, background: "#ff0000" }, { value: "Notes" }] },
        { id: "source-8", cells: [{ value: "00123456" }, { value: new Date("2026-10-01T00:00:00.000Z"), fill: { type: "gradient", gradient: "path", center: { left: 0.2, top: 0.3 }, stops: [{ position: 0, color: { theme: 1, tint: 0.2 } }, { position: 1, color: { indexed: 3 } }] } }] }] },
    { id: "sheet-b", name: "Other", width: 3, hidden: [], rows: [{ id: "row", cells: [{ value: 0 }, { value: false }, { value: null }] }] }],
  };
}
function failure(work: () => unknown, code: WorkbookLibraryError["code"]) {
  expect(work).toThrowError(expect.objectContaining({ name: "WorkbookLibraryError", code }));
}

it("preserves all workbook data, typed dates, hidden cells and stable bindings through create/read/save/history", () => {
  const f = fixture(), original = workbook();
  expect(f.service.list()).toEqual([]);
  const created = f.service.create(original);
  expect(created).toEqual({ libraryId: created.libraryId, version: 1, createdAt: "2026-10-12T12:00:00.000Z", savedAt: "2026-10-12T12:00:00.000Z", workbook: { ...original, libraryId: created.libraryId } });
  original.sheets[0].rows[1].cells[1].value = "changed caller";
  expect(f.service.read(created.libraryId)).toEqual(created);
  f.clock.advanceWall(1000);
  const updated = f.service.save(created.libraryId, 1, { ...created.workbook, name: "Renamed.xlsx" });
  expect(updated.version).toBe(2);
  expect(updated.createdAt).toBe(created.createdAt);
  expect(updated.savedAt).toBe("2026-10-12T12:00:01.000Z");
  expect(updated.workbook.sheets).toEqual(created.workbook.sheets);
  expect(f.service.list()).toEqual([updated]);
  expect(f.service.history(created.libraryId)).toEqual([created, updated]);
  expect(f.database.prepare("SELECT payload_json FROM workbook_library").get()?.payload_json).toContain('"type":"date"');
});

it("refuses stale versions and identity changes without touching the current workbook or history", () => {
  const f = fixture(), created = f.service.create(workbook());
  const saved = f.service.save(created.libraryId, 1, created.workbook);
  failure(() => f.service.save(created.libraryId, 1, { ...created.workbook, name: "Stale.xlsx" }), "WORKBOOK_VERSION_CONFLICT");
  failure(() => f.service.save(created.libraryId, 2, { ...created.workbook, libraryId: "other" }), "WORKBOOK_INVALID");
  failure(() => f.service.save(created.libraryId, 2, { ...created.workbook, sheets: [] }), "WORKBOOK_INVALID");
  expect(f.service.read(created.libraryId)).toEqual(saved);
  expect(f.service.history(created.libraryId)).toEqual([created, saved]);
  failure(() => f.service.read("missing"), "WORKBOOK_NOT_FOUND");
  failure(() => f.service.history("missing"), "WORKBOOK_NOT_FOUND");
});

it("orders a populated library by saved time with stable identity tie breaking", () => {
  const f = fixture(), a = f.service.create(workbook());
  f.clock.advanceWall(1000);
  const b = f.service.create(workbook());
  expect(f.service.list().map(record => record.libraryId)).toEqual([b.libraryId, a.libraryId]);
  f.clock.advanceWall(1000);
  const a2 = f.service.save(a.libraryId, 1, a.workbook);
  expect(f.service.list()).toEqual([a2, b]);
});

const malformed: readonly [string, (value: EditableWorkbook) => unknown][] = [
  ["no sheets", value => ({ ...value, sheets: [] })],
  ["unknown property", value => ({ ...value, discarded: true })],
  ["unknown theme key", value => ({ ...value, themes: { "../theme1": "xml" } })],
  ["nested theme metadata", value => ({ ...value, themes: { theme1: { xml: "xml" } } })],
  ["nonfinite value", value => { value.sheets[0].rows[0].cells[0].value = Infinity; return value; }],
  ["invalid date", value => { value.sheets[0].rows[0].cells[0].value = new Date("invalid"); return value; }],
  ["duplicate sheet id", value => { value.sheets[1].id = value.sheets[0].id; return value; }],
  ["duplicate row id", value => { value.sheets[0].rows[1].id = value.sheets[0].rows[0].id; return value; }],
  ["width mismatch", value => { value.sheets[0].width = 3; return value; }],
  ["outside hidden index", value => { value.sheets[0].hidden = [2]; return value; }],
  ["duplicate hidden index", value => { value.sheets[0].hidden = [1, 1]; return value; }],
  ["outside header", value => { value.sheets[0].headerRow = 3; return value; }],
  ["duplicate field", value => { value.sheets[0].columnBindings![1].fieldId = "eid"; return value; }],
  ["duplicate binding id", value => { value.sheets[0].columnBindings![1].id = "binding-a"; return value; }],
  ["unknown namespace", value => { value.sheets[0].columnBindings![0].fieldId = "other.eid"; return value; }],
  ["missing binding", value => { value.sheets[0].columnBindings!.pop(); return value; }],
  ["malformed fill", value => ({ ...value, sheets: [{ ...value.sheets[0], rows: [{ id: "row", cells: [{ value: 1, fill: { type: "unknown" } }, { value: 2 }] }] }] })],
];
it.each(malformed)("refuses %s before storage effects", (_name, change) => {
  const f = fixture();
  failure(() => f.service.create(change(workbook())), "WORKBOOK_INVALID");
  expect(f.service.list()).toEqual([]);
  expect(f.database.prepare("SELECT COUNT(*) AS count FROM workbook_library_history").get()?.count).toBe(0);
});

it("rolls back both current and history changes when history publication fails", () => {
  const f = fixture(), created = f.service.create(workbook());
  f.database.exec("CREATE TRIGGER injected_failure BEFORE INSERT ON workbook_library_history WHEN NEW.version=2 BEGIN SELECT RAISE(ABORT,'injected'); END");
  failure(() => f.service.save(created.libraryId, 1, { ...created.workbook, name: "Changed.xlsx" }), "WORKBOOK_STORAGE_FAILED");
  expect(f.service.read(created.libraryId)).toEqual(created);
  expect(f.service.history(created.libraryId)).toEqual([created]);
});

it.each(["payload", "columns", "history"])("refuses corrupt stored %s without replacing it", kind => {
  const f = fixture(), created = f.service.create(workbook());
  if (kind === "payload") f.database.prepare("UPDATE workbook_library SET payload_json='{}' WHERE id=?").run(created.libraryId);
  else if (kind === "columns") f.database.prepare("UPDATE workbook_library SET version=99 WHERE id=?").run(created.libraryId);
  else {
    f.database.exec("DROP TRIGGER workbook_library_history_immutable");
    f.database.prepare("UPDATE workbook_library_history SET payload_json='{}' WHERE workbook_id=?").run(created.libraryId);
  }
  failure(() => f.service.read(created.libraryId), "WORKBOOK_STORAGE_CORRUPT");
  failure(() => f.service.list(), "WORKBOOK_STORAGE_CORRUPT");
  failure(() => f.service.history(created.libraryId), "WORKBOOK_STORAGE_CORRUPT");
  failure(() => f.service.save(created.libraryId, 1, created.workbook), "WORKBOOK_STORAGE_CORRUPT");
});

it("retains accepted history against update and delete", () => {
  const f = fixture(), created = f.service.create(workbook());
  expect(() => f.database.prepare("DELETE FROM workbook_library_history WHERE workbook_id=?").run(created.libraryId)).toThrow("workbook-history-retained");
  expect(() => f.database.prepare("UPDATE workbook_library_history SET version=9 WHERE workbook_id=?").run(created.libraryId)).toThrow("workbook-history-immutable");
  expect(() => f.database.exec("INSERT OR REPLACE INTO workbook_library_history SELECT * FROM workbook_library_history")).toThrow("workbook-history-immutable");
  expect(f.service.history(created.libraryId)).toEqual([created]);
});

it("distinguishes dates from date-like strings and omits undefined optionals without changing names", () => {
  const f = fixture(), value = workbook();
  value.name = " Roster.xlsx ";
  value.sheets[0].name = " People ";
  value.sheets[0].columnBindings![1] = { ...value.sheets[0].columnBindings![1], fieldId: null, basis: "manual" };
  value.sheets[0].rows[0].cells[1].fill = { type: "pattern", pattern: "solid", fgColor: { argb: "ABCDEF" }, bgColor: { argb: "FFABCDEF" } };
  value.sheets[1] = { ...value.sheets[1], headerRow: undefined, columnBindings: undefined,
    rows: [{ id: "row", cells: [{ value: new Date("2026-01-01T00:00:00.000Z"), fill: undefined }, { value: "2026-01-01T00:00:00.000Z", background: undefined }, { value: null }] }] };
  const created = f.service.create(value), restored = f.service.read(created.libraryId);
  expect(restored.workbook.name).toBe(value.name);
  expect(restored.workbook.sheets[0].name).toBe(" People ");
  expect(restored.workbook.sheets[0].rows[0].cells[1].fill).toEqual(value.sheets[0].rows[0].cells[1].fill);
  expect(restored.workbook.sheets[0].columnBindings![1].fieldId).toBeNull();
  expect(restored.workbook.sheets[1].rows[0].cells[0].value).toEqual(new Date("2026-01-01T00:00:00.000Z"));
  expect(restored.workbook.sheets[1].rows[0].cells[1].value).toBe("2026-01-01T00:00:00.000Z");
  expect(restored.workbook.sheets[1].rows[0].cells[2].value).toBeNull();
});

it("validates older snapshots and contiguous versions when full history is requested", () => {
  const f = fixture(), first = f.service.create(workbook());
  const last = f.service.save(first.libraryId, 1, first.workbook);
  f.database.exec("DROP TRIGGER workbook_library_history_immutable");
  f.database.prepare("UPDATE workbook_library_history SET payload_json='{}' WHERE workbook_id=? AND version=1").run(first.libraryId);
  expect(f.service.read(first.libraryId)).toEqual(last);
  failure(() => f.service.history(first.libraryId), "WORKBOOK_STORAGE_CORRUPT");
});

it("refuses a regressing clock without changing accepted versions", () => {
  const f = fixture(), first = f.service.create(workbook());
  f.clock.advanceWall(1000);
  const last = f.service.save(first.libraryId, 1, first.workbook);
  f.clock.advanceWall(-500);
  failure(() => f.service.save(first.libraryId, 2, first.workbook), "WORKBOOK_INVALID");
  expect(f.service.history(first.libraryId)).toEqual([first, last]);
});

it("preserves the actual theme object emitted by ExcelJS XLSX imports", async () => {
  const f = fixture(), source = new Excel.Workbook();
  source.addWorksheet("People").getCell("A1").value = "Employee ID";
  const imported = new Excel.Workbook();
  await imported.xlsx.load(await source.xlsx.writeBuffer());
  expect(Array.isArray(imported.model.themes)).toBe(false);
  const value = { ...workbook(), themes: imported.model.themes };
  const saved = f.service.create(value);
  expect(f.service.read(saved.libraryId).workbook.themes).toEqual(imported.model.themes);
});
