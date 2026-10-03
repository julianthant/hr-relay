import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { addMockSpreadsheetType, initialSpreadsheetSheets, NOT_MAPPED, registerMockSpreadsheet, resetSpreadsheetMocks, searchMockSpreadsheet, spreadsheetMappingErrors, WORKBOOK_ONLY, type SpreadsheetType } from "../../../src/dashboard/surfaces/spreadsheet-mock-model.js";
import { ROSTER_FIELDS } from "../../../src/dashboard/surfaces/spreadsheet-mock-data.js";
const roster: SpreadsheetType = { id: "roster", name: "Roster", fields: ROSTER_FIELDS };
const file = () => registerMockSpreadsheet({ name: "Fictional roster.xlsx", typeId: "roster", sheets: initialSpreadsheetSheets(roster) });
afterEach(resetSpreadsheetMocks);
describe("type-based mock spreadsheet registration", () => {
  it("searches every mapped identifier and data field without choosing one match key", () => {
    const record = file(); const sheet = record.sheets[0].name;
    for (const query of ["Jordan Lee", "DEMO-PID-001", "DEMO-1042", "jordan.lee@example.com", "Sample dining hall"]) {
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
  it("unknown type, field and existing file references fail explicitly", () => {
    const sheets = initialSpreadsheetSheets(roster);
    assert.throws(() => registerMockSpreadsheet({ name: "Roster.xlsx", typeId: "unknown", sheets }), /SPREADSHEET_TYPE_NOT_FOUND/u);
    assert.throws(() => registerMockSpreadsheet({ name: "Roster.xlsx", typeId: "roster", sheets: [{ ...sheets[0], mapping: ["Unknown field"] }] }), /SPREADSHEET_FIELD_NOT_FOUND/u);
    assert.throws(() => registerMockSpreadsheet({ name: "Roster.xlsx", typeId: "roster", sheets }, "missing"), /SPREADSHEET_NOT_FOUND/u);
  });
});
