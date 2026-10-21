import assert from "node:assert/strict";
import { afterEach,describe,it } from "vitest";
import { editSpreadsheetCell,newEditableWorkbook } from "../../../../src/dashboard/surfaces/spreadsheets/spreadsheet-editor-model.js";
import { ROSTER_FIELDS } from "../../../../src/dashboard/surfaces/spreadsheets/spreadsheet-mock-data.js";
import { addMockSpreadsheetType,renameMockSpreadsheetType,initialSpreadsheetSheets,NOT_MAPPED,registeredSpreadsheetWorkbook,registerLocalSpreadsheet,registerMockSpreadsheet,resetSpreadsheetMocks,retainSpreadsheetCopy,searchMockSpreadsheet,spreadsheetMappingErrors,WORKBOOK_ONLY,type SpreadsheetType } from "../../../../src/dashboard/surfaces/spreadsheets/spreadsheet-mock-model.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
const roster: SpreadsheetType = { id: "roster", name: "Roster", fields: ROSTER_FIELDS };
const file = () => registerMockSpreadsheet({ name: "Fictional roster.xlsx", typeId: "roster", sheets: initialSpreadsheetSheets(roster) });
afterEach(resetSpreadsheetMocks);
describe("type-based mock spreadsheet registration", () => {
  it("searches every mapped identifier and data field without choosing one match key", () => {
    const record = file(); const sheet = record.sheets[0].name;
    for (const query of ["Jordan Lee", "DEMO-PID-001", "DEMO-1042", "jordan.lee@example.com", "(202) 555-0101", "Sample dining hall"]) {
      const rows = searchMockSpreadsheet(record, sheet, query);
      assert.equal(rows.length, 1, query); assert.equal(rows[0]["Legal name"], "Jordan Lee");
    }
    assert.equal(searchMockSpreadsheet(record, sheet, "unmatched").length, 0);
  });
  it("searches only the current sheet's mapped columns and excludes workbook-only data", () => {
    const record = file(); const first = record.sheets[0];
    const narrowed = { ...record, sheets: [{ ...first, mapping: first.mapping.map(field => field === "Legal name" ? field : WORKBOOK_ONLY) }] };
    assert.equal(searchMockSpreadsheet(narrowed, first.name, "Jordan").length, 1);
    assert.equal(searchMockSpreadsheet(narrowed, first.name, "DEMO-1042").length, 0);
    assert.throws(() => searchMockSpreadsheet(record, "missing", ""), /SPREADSHEET_SHEET_NOT_FOUND/u);
  });
  it("rejects duplicate mappings, invalid header rows and a workbook with no mapped fields", () => {
    const [sheet] = initialSpreadsheetSheets(roster);
    assert.match(spreadsheetMappingErrors([{ ...sheet, mapping: ["Legal name", "Legal name"] }]).join(), /only once/u);
    assert.match(spreadsheetMappingErrors([{ ...sheet, headerRow: 0 }]).join(), /positive header row/u);
    assert.match(spreadsheetMappingErrors([{ ...sheet, mapping: sheet.mapping.map(() => NOT_MAPPED) }]).join(), /at least one/u);
  });
  it("new types define searchable fields and reject duplicate field or type names", () => {
    const type = addMockSpreadsheetType("Contact list", ["Legal name", "Email"]);
    const sheets = initialSpreadsheetSheets(type);
    const record = registerMockSpreadsheet({ name: "Contacts.xlsx", typeId: type.id, sheets });
    assert.equal(searchMockSpreadsheet(record, sheets[0].name, "alex.morgan@example.com").length, 1);
    assert.throws(() => addMockSpreadsheetType("contact LIST", ["Legal name"]), /already exists/u);
    assert.throws(() => addMockSpreadsheetType("Other", ["Legal name", "legal NAME"]), /different name/u);
  });
  it("editing a three-sheet file preserves its identity and sheet membership", () => {
    const record = registerMockSpreadsheet({ name: "Summer.xlsx", typeId: "roster", sheets: initialSpreadsheetSheets(roster).slice(0, 3) });
    const updated = registerMockSpreadsheet({ ...record, sheets: record.sheets.map(sheet => ({ ...sheet, headerRow: 2 })) }, record.id);
    assert.equal(updated.id, record.id); assert.equal(updated.sheets.length, 3);
    assert.deepEqual(updated.sheets.map(sheet => sheet.name), record.sheets.map(sheet => sheet.name));
    assert.ok(updated.sheets.every(sheet => sheet.headerRow === 2));
  });
  it("opens every registered sheet as an isolated editable workbook", () => {
    const record = file(); const document = registeredSpreadsheetWorkbook(record);
    assert.equal(document.libraryId, record.id); assert.equal(document.sheets.length, record.sheets.length);
    assert.ok(document.sheets.every(sheet => sheet.rows.length === 4));
    assert.equal(document.sheets[0].rows[1].cells[0].value, "jordan.lee@example.com");
    assert.notEqual(document.sheets[0].rows[1].cells[0], registeredSpreadsheetWorkbook(record).sheets[0].rows[1].cells[0]);
    assert.equal(registeredSpreadsheetWorkbook(record).sheets[0].rows[1].cells[0].value, "jordan.lee@example.com");
  });
  it("retains edited copies by identity even when filenames match", () => {
    const original = newEditableWorkbook(); const first = registerLocalSpreadsheet(original), second = registerLocalSpreadsheet(original);
    assert.notEqual(first.id, second.id); assert.ok(first.addedAt);
    const edited = { ...original, sheets: [editSpreadsheetCell(original.sheets[0], original.sheets[0].rows[1].id, 0, "edited")] };
    retainSpreadsheetCopy(first.id, edited);
    assert.equal(registeredSpreadsheetWorkbook(first).sheets[0].rows[1].cells[0].value, "edited");
    assert.notEqual(registeredSpreadsheetWorkbook(second).sheets[0].rows[1].cells[0].value, "edited");
    assert.throws(() => retainSpreadsheetCopy("missing", edited), /SPREADSHEET_NOT_FOUND/u);
  });
  it("unknown type, field and existing file references fail explicitly", () => {
    const sheets = initialSpreadsheetSheets(roster);
    assert.throws(() => registerMockSpreadsheet({ name: "Roster.xlsx", typeId: "unknown", sheets }), /SPREADSHEET_TYPE_NOT_FOUND/u);
    assert.throws(() => registerMockSpreadsheet({ name: "Roster.xlsx", typeId: "roster", sheets: [{ ...sheets[0], mapping: ["Unknown field"] }] }), /SPREADSHEET_FIELD_NOT_FOUND/u);
    assert.throws(() => registerMockSpreadsheet({ name: "Roster.xlsx", typeId: "roster", sheets }, "missing"), /SPREADSHEET_NOT_FOUND/u);
  });
});

it("stamps registrations from injected time and retains original timestamps on replacement", () => {
  const clock = manualClock(new Date("2026-10-08T12:00:00Z"));
  const first = registerMockSpreadsheet({ name: "Clock roster.xlsx", typeId: "roster", sheets: initialSpreadsheetSheets(roster) }, undefined, clock);
  assert.equal(first.addedAt, "2026-10-08T12:00:00.000Z");
  const local = registerLocalSpreadsheet({ ...newEditableWorkbook(), name: "Local clock.xlsx" }, undefined, clock);
  assert.equal(local.addedAt, first.addedAt);
  clock.advanceWall(60_000);
  assert.equal(registerMockSpreadsheet({ name: "Renamed roster.xlsx", typeId: "roster", sheets: first.sheets }, first.id, clock).addedAt, first.addedAt);
  assert.equal(registerLocalSpreadsheet({ ...newEditableWorkbook(), name: "Renamed local.xlsx" }, local.id, clock).addedAt, local.addedAt);
  const supplied = registerMockSpreadsheet({ name: "Supplied.xlsx", typeId: "roster", sheets: first.sheets, addedAt: "2026-01-01T00:00:00Z" }, undefined, clock);
  assert.equal(supplied.addedAt, "2026-01-01T00:00:00Z");
});

it("renames a type without changing its identity, columns or existing workbook association", () => {
  const type = addMockSpreadsheetType("Contact list", ["Legal name", "Email"]);
  const registered = registerMockSpreadsheet({ name: "Contacts.xlsx", typeId: type.id, sheets: initialSpreadsheetSheets(type) });
  const renamed = renameMockSpreadsheetType(type.id, "  Contact roster  ");
  assert.deepEqual(renamed, { ...type, name: "Contact roster" });
  assert.equal(registered.typeId, renamed.id);
  assert.throws(() => renameMockSpreadsheetType(type.id, " roster "), /already exists/u);
  assert.throws(() => renameMockSpreadsheetType(type.id, " "), /Enter a type name/u);
  assert.throws(() => renameMockSpreadsheetType("missing", "Name"), /TYPE_NOT_FOUND/u);
});
