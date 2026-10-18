import { z } from 'zod';
import JSZip from 'jszip';
import { Readable } from 'node:stream';
import { matchSpreadsheetTask } from '../../../src/backend/processing/roster/task-registry.js';
import { ArtifactRefSchema } from '../../../src/models/artifacts/artifacts.js';
import { MatchSpreadsheetInputSchema } from '../../../src/models/processing/roster/match-spreadsheet.js';
import { importSpreadsheet, spreadsheetXlsx, editSpreadsheetCell, updateSpreadsheetFields, sortSpreadsheet } from '../../../src/dashboard/surfaces/spreadsheets/spreadsheet-editor-model.js';
import { prepareSpreadsheetColumns, selectSpreadsheetColumns, spreadsheetColumnErrors, spreadsheetColumnValueIssues } from '../../../src/dashboard/surfaces/spreadsheets/spreadsheet-column-import-model.js';
import { CANONICAL_FIELDS } from '../../../src/models/fields/registry.js';
import { defineIntakeProjection } from '../../../src/models/intake/projection.js';
import { confirmBinding, detectColumns, ColumnMappingSchema, headerFingerprint } from '../../../src/models/intake/mapping.js';
import { validateIntakeRows } from '../../../src/models/intake/validate.js';
import { parseSpreadsheetGrid } from '../../../src/backend/processing/spreadsheet/spreadsheet-grid.js';
import { ItemIdSchema, IntakeTargetFieldIdSchema } from '../../../src/rules/identity/ids.js';
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


it('roundtrips a wide multi-sheet roster as raw library data while execution rejects invalid canonical rows', async () => {
  const source = new Excel.Workbook();
  for (let sheet = 0; sheet < 9; sheet++) {
    const target = source.addWorksheet(`Synthetic ${sheet + 1}`);
    target.getCell('A1').value = 'Synthetic roster';
    const width = sheet === 0 ? 32 : 31;
    target.getRow(5).values = ['Legal Name', 'Lived Name', 'UCPath ID', 'Email', 'Start date', 'Entered in UCPath', 'Date background entered', ...Array.from({ length: width - 7 }, (_, column) => `Custom ${column}`)];
    for (let row = 6; row <= 9; row++) target.getRow(row).values = ['Morrow, Bea', 'Morrow, Bee', row === 7 ? 'Pending' : sheet === 1 && row === 6 ? '10-000-106' : `10${String(sheet * 100 + row).padStart(6, '0')}`, row === 8 ? 'invalid@' : 'bea@example.com', row === 9 ? '02/30/2026' : new Date('2026-10-19T00:00:00Z'), 'JZ 05/29/26', '6.16.26 KM', '  untouched  '];
    target.getCell('A6').value = { richText: [{ text: 'Morrow, ', font: { bold: true, color: { argb: 'FF112233' } } }, { text: 'Bea', font: { italic: true } }] };
    target.getCell('D6').value = { text: 'bea@example.com', hyperlink: 'mailto:bea@example.com', tooltip: 'Email' };
    target.getCell('C6').numFmt = '00000000';
    target.getCell('E6').numFmt = 'mm/dd/yyyy';
    target.getCell('F6').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFF0000' } };
  }
  const originalBytes = await source.xlsx.writeBuffer();
  const imported = await importSpreadsheet('Synthetic.xlsx', originalBytes);
  const prepared = prepareSpreadsheetColumns(imported);
  expect(prepared.sheets.map(sheet => sheet.headerRow)).toEqual(Array(9).fill(5));
  expect(spreadsheetColumnErrors(prepared)).toEqual([]);
  expect(spreadsheetColumnValueIssues(prepared)).toHaveLength(27);
  expect(spreadsheetColumnValueIssues(prepared)[0]).toContain('row 7, column C');
  const selected = selectSpreadsheetColumns(prepared);
  expect(selected.sheets.reduce((sum, sheet) => sum + sheet.width, 0)).toBe(280);
  expect(selected.sheets[0].columnBindings?.slice(0, 2).map(binding => binding.fieldId)).toEqual(['fullName', 'livedName']);
  expect(spreadsheetColumnValueIssues(selected)).toEqual(spreadsheetColumnValueIssues(prepared));
  const f = fixture(), created = f.service.create(selected);
  const saved = f.service.save(created.libraryId, 1, created.workbook);
  const reopened = f.service.read(saved.libraryId);
  expect(reopened).toEqual(saved);
  expect(reopened.workbook.sheets).toEqual(selected.sheets);
  const exported = await spreadsheetXlsx(reopened.workbook);
  const reimported = await importSpreadsheet('Synthetic.xlsx', exported);
  expect(reimported.sheets).toHaveLength(9);
  for (let sheet = 0; sheet < 9; sheet++) expect(reimported.sheets[sheet].rows.map(row => row.cells)).toEqual(selected.sheets[sheet].rows.map(row => row.cells));
  const first = selected.sheets[0], nameRow = first.rows[1];
  const edited = editSpreadsheetCell(first, nameRow.id, 0, 'Morrow, Updated');
  expect(edited.rows[1].cells[0].richText).toBeUndefined();
  const updated = updateSpreadsheetFields(first, nameRow.id, { email: 'updated@example.com' });
  expect(updated.rows[1].cells[3].hyperlink).toBeUndefined();
  expect(updated.rows[1].cells[3].tooltip).toBeUndefined();
  const grid = await parseSpreadsheetGrid({ bytes: Buffer.from(exported), artifactId: 'synthetic', mediaType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', sheet: first.name });
  if (grid.state !== 'parsed') throw new Error('Synthetic exported grid refused');
  const projection = defineIntakeProjection(z.strictObject({ eid: CANONICAL_FIELDS.eid.schema, email: CANONICAL_FIELDS.email.schema, hireDate: CANONICAL_FIELDS.hireDate.schema }), { eid: CANONICAL_FIELDS.eid, email: CANONICAL_FIELDS.email, hireDate: CANONICAL_FIELDS.hireDate });
  const detected = detectColumns(grid.grid[0]);
  const result = validateIntakeRows({ workflow: 'synthetic', sourceSha256: 'ab'.repeat(32), projection, detected,
    bindings: [['eid', 2], ['email', 3], ['hireDate', 4]].map(([field, column]) => confirmBinding({ projection, detected, targetFieldId: IntakeTargetFieldIdSchema.parse(field), sourceColumnId: detected[Number(column)].sourceColumnId, confirmedAt: saved.savedAt })),
    rows: grid.grid.slice(1), readAt: saved.savedAt, deriveItemId: () => ItemIdSchema.parse('11111111-2222-4333-8444-555555555555') });
  expect(result.valid).toHaveLength(1);
  const rosterColumns = detectColumns(prepared.sheets[1].rows[4].cells.map(cell => String(cell.value ?? '')));
  const rosterMapping = ColumnMappingSchema.parse({ workflow: 'person-lookup', intakeProjectionFingerprint: projection.fingerprint, fingerprint: headerFingerprint(rosterColumns), savedAt: saved.savedAt, headerRowIndex: 4,
    columns: rosterColumns.map(({ samples: _samples, ...column }) => column),
    bindings: [['eid', 2], ['fullName', 0]].map(([field, column]) => ({ canonicalFieldId: field, targetFieldId: field, sourceColumnId: rosterColumns[Number(column)].sourceColumnId, confirmedAt: saved.savedAt })) });
  const matched = await matchSpreadsheetTask.impl.run({ input: MatchSpreadsheetInputSchema.parse({ rosterFileRef: ArtifactRefSchema.parse({ id: '11111111-2222-4333-8444-555555555555', sha256: 'ab'.repeat(32), bytes: originalBytes.byteLength, mediaType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), sheet: 'Synthetic 2', mapping: rosterMapping, readAt: saved.savedAt,
    subjects: [{ subjectId: '11111111-2222-4333-8444-555555555555', eid: '10000002', name: 'Bea Morrow' }, { subjectId: '11111111-2222-4333-8444-555555555556', eid: '10000002', name: 'Rick Roe' }, { subjectId: '11111111-2222-4333-8444-555555555557', name: 'Bea Morrow' }] }),
    ctx: { artifacts: { open: async () => Readable.from([Buffer.from(originalBytes)]) }, fail: (code: string) => { throw new Error(code); }, recordData: () => undefined, log: { info: () => undefined } } as never });
  expect(matched.matches.map(match => [match.matchedEid, match.mismatch])).toEqual([['10000002', 'none'], [null, 'name-eid-conflict'], [null, 'ambiguous']]);
  expect(result.rejected.map(row => [row.sourceRow, 'field' in row ? row.field : undefined])).toEqual([[2, 'eid'], [3, 'email'], [4, 'hireDate']]);
});


it('retains original worksheet row locations after sorting and save/reopen', async () => {
  const csv = 'Synthetic roster,\n,\n,\n,\nLegal Name,UCPath ID\nZed Mercer,10000001\nAmy Morrow,Pending';
  const imported = await importSpreadsheet('Synthetic.csv', new TextEncoder().encode(csv).buffer);
  const selected = selectSpreadsheetColumns(prepareSpreadsheetColumns(imported));
  const sheet = sortSpreadsheet(selected.sheets[0], 0, 'asc');
  expect(sheet.rows.slice(1).map(row => row.sourceRow)).toEqual([7, 6]);
  const sorted = { ...selected, sheets: [sheet] };
  expect(spreadsheetColumnValueIssues(sorted)).toEqual(['Sheet 1, row 7, column B: does not match Employee ID.']);
  const f = fixture(), created = f.service.create(sorted);
  const saved = f.service.save(created.libraryId, 1, created.workbook);
  const reopened = f.service.read(saved.libraryId);
  expect(reopened.workbook.sheets[0].rows.slice(1).map(row => row.sourceRow)).toEqual([7, 6]);
  expect(spreadsheetColumnValueIssues(reopened.workbook)).toEqual(spreadsheetColumnValueIssues(sorted));
});


it('preserves selected blank trailing columns and rows using native XLSX dimensions', async () => {
  const source = new Excel.Workbook(), target = source.addWorksheet('Synthetic');
  for (let row = 1; row <= 4; row++) for (let column = 1; column <= 3; column++) {
    const cell = target.getCell(row, column);
    cell.value = row === 1 && column < 3 ? `Field ${column}` : row === 2 && column === 1 ? false : null;
    cell.fill = { type: 'pattern', pattern: 'none' };
  }
  const imported = selectSpreadsheetColumns(prepareSpreadsheetColumns(await importSpreadsheet('Synthetic.xlsx', await source.xlsx.writeBuffer())));
  expect(imported.sheets[0].width).toBe(3);
  expect(imported.sheets[0].rows).toHaveLength(4);
  const f = fixture(), created = f.service.create(imported), reopened = f.service.read(created.libraryId);
  const exported = await spreadsheetXlsx(reopened.workbook);
  const reimported = await importSpreadsheet('Synthetic.xlsx', exported);
  expect(reimported.sheets[0].width).toBe(3);
  expect(reimported.sheets[0].rows).toHaveLength(4);
  expect(reimported.sheets[0].rows.map(row => row.cells.map(cell => cell.value))).toEqual(imported.sheets[0].rows.map(row => row.cells.map(cell => cell.value)));
  const excluded = { ...reopened.workbook, sheets: [{ ...reopened.workbook.sheets[0], hidden: [2] }] };
  expect((await importSpreadsheet('Synthetic.xlsx', await spreadsheetXlsx(excluded))).sheets[0].width).toBe(2);
});

it('validates native worksheet dimensions and references before allocating the editable grid', async () => {
  const source = new Excel.Workbook(); source.addWorksheet('Synthetic').getCell('C3').value = 'Retained';
  const bytes = await source.xlsx.writeBuffer();
  const rewrite = async (path: string, change: (xml: string) => string) => {
    const archive = await JSZip.loadAsync(bytes);
    const entry = archive.file(path); if (!entry) throw new Error('Synthetic XML missing');
    archive.file(path, change(await entry.async('string')));
    return archive.generateAsync({ type: 'arraybuffer' });
  };
  const declared = async (reference: string) => rewrite('xl/worksheets/sheet1.xml', xml => xml.replace(/<dimension[^>]+\/>/u, `<dimension ref="${reference}"/>`));
  const noDimension = await rewrite('xl/worksheets/sheet1.xml', xml => xml.replace(/<dimension[^>]+\/>/u, ''));
  const absent = await importSpreadsheet('Synthetic.xlsx', noDimension);
  expect(absent.sheets[0].width).toBe(3); expect(absent.sheets[0].rows).toHaveLength(3);
  const single = await importSpreadsheet('Synthetic.xlsx', await declared('E7'));
  expect(single.sheets[0].width).toBe(5); expect(single.sheets[0].rows).toHaveLength(7);
  for (const reference of ['invalid', 'D4:A1', 'A0:C3', 'A1:XFE2']) await expect(importSpreadsheet('Synthetic.xlsx', await declared(reference))).rejects.toThrow('SPREADSHEET_DIMENSIONS_INVALID');
  await expect(importSpreadsheet('Synthetic.xlsx', await declared('A1:XFD1048576'))).rejects.toThrow('SPREADSHEET_SIZE_UNSUPPORTED');
  const wrongNamespace = await rewrite('xl/_rels/workbook.xml.rels', xml => xml.replace('http://schemas.openxmlformats.org/package/2006/relationships', 'https://example.com/wrong'));
  await expect(importSpreadsheet('Synthetic.xlsx', wrongNamespace)).rejects.toThrow('SPREADSHEET_WORKSHEET_REFERENCE_INVALID');
  for (const target of ['https://example.com/sheet.xml', 'https://relay.invalid/xl/worksheets/sheet1.xml', '//relay.invalid/xl/worksheets/sheet1.xml', 'worksheets/%2e%2e%2fsheet.xml', 'worksheets/sheet.xml#fragment']) {
    const invalid = await rewrite('xl/_rels/workbook.xml.rels', xml => xml.replace('Target="worksheets/sheet1.xml"', `Target="${target}"`));
    await expect(importSpreadsheet('Synthetic.xlsx', invalid)).rejects.toThrow('SPREADSHEET_WORKSHEET_REFERENCE_INVALID');
  }
});


it('maps native dimensions through exact worksheet relationships rather than relation order or sheet index', async () => {
  const source = new Excel.Workbook();
  source.addWorksheet('First').getCell('C3').value = 'First value';
  source.addWorksheet('Second').getCell('F8').value = 'Second value';
  const archive = await JSZip.loadAsync(await source.xlsx.writeBuffer());
  const rels = archive.file('xl/_rels/workbook.xml.rels'); if (!rels) throw new Error('Synthetic relationships missing');
  let xml = (await rels.async('string')).replace(/Target="worksheets\/sheet([12])\.xml"/gu, (_match, number: string) => `Target="/xl/worksheets/sheet${3 - Number(number)}.xml"`);
  const reversed = [...xml.matchAll(/<Relationship\b[^>]*\/>/gu)].map(match => match[0]).reverse();
  let index = 0;
  xml = xml.replace(/<Relationship\b[^>]*\/>/gu, () => reversed[index++]);
  archive.file(rels.name, xml);
  const imported = await importSpreadsheet('Synthetic.xlsx', await archive.generateAsync({ type: 'arraybuffer' }));
  expect(imported.sheets.map(sheet => [sheet.name, sheet.width, sheet.rows.length])).toEqual([['First', 6, 8], ['Second', 3, 3]]);
  expect(imported.sheets[0].rows[7].cells[5].value).toBe('Second value');
  expect(imported.sheets[1].rows[2].cells[2].value).toBe('First value');
});
