import assert from "node:assert/strict";
import { it } from "vitest";
import { EditableWorkbookSchema, EditableWorkbookWireSchema, SavedWorkbookSchema, decodeEditableWorkbook, encodeEditableWorkbook, decodeSavedWorkbook, encodeSavedWorkbook } from "../../../src/models/dashboard/workbooks.js";
import { RunWorkbookReferenceSchema, RunWorkbookAllRowsReferenceSchema, bindRunWorkbookReference, parseRunWorkbookReference } from "../../../src/models/dashboard/workbooks.js";
import { deriveSchemaHash } from "../../../src/models/validation/schema-bound-value.js";

it("preserves the keyed reference schema hash and reads each active reference by its declared hash", () => {
  assert.equal(deriveSchemaHash(RunWorkbookReferenceSchema, "output"), "bb13aafcb41e28b291bd51f4b9a803f6fabcbd71a6b92cf2a036a3d0c1cc6bac");
  assert.equal(deriveSchemaHash(RunWorkbookAllRowsReferenceSchema, "output"), "a6278c40db9223757b28b00d0e975a3bf6f58e2d4444b527a4d2b04e5680d419");
  const snapshot = { libraryId: "library", version: 2, worksheets: [{ sheetId: "people", name: "People" }],
    type: { id: "roster", name: "Roster", keyFieldId: "eid", fields: ["eid"], defaultWorkbookId: "library" }, rows: [] };
  const keyed = bindRunWorkbookReference({ typeId: "roster", keys: [], fields: ["eid"] }, snapshot);
  const all = bindRunWorkbookReference({ mode: "all", typeId: "roster", libraryId: "library", expectedVersion: 2, fields: ["eid"] }, snapshot);
  assert.equal(keyed.schemaHash, deriveSchemaHash(RunWorkbookReferenceSchema, "output"));
  assert.equal(all.schemaHash, deriveSchemaHash(RunWorkbookAllRowsReferenceSchema, "output"));
  assert.notEqual(keyed.schemaHash, all.schemaHash);
  assert.deepEqual(parseRunWorkbookReference(keyed), { request: { typeId: "roster", keys: [], fields: ["eid"] }, snapshot });
  assert.deepEqual(parseRunWorkbookReference(all).snapshot, snapshot);
  assert.throws(() => parseRunWorkbookReference({ ...all, schemaHash: keyed.schemaHash }));
  assert.throws(() => parseRunWorkbookReference({ ...keyed, schemaHash: all.schemaHash }));
});

it("roundtrips explicit Date cells while ISO-looking strings stay strings and provenance survives", () => {
  const workbook = EditableWorkbookSchema.parse({ name: "Dates.xlsx", libraryId: "library", themes: { theme1: "theme" }, hasFormulas: true,
    sheets: [{ id: "sheet", name: "Dates", width: 2, hidden: [1], headerRow: 1, sourceHeaderRow: 7,
      columnBindings: [{ id: "col-a", sourceColumn: 4, sourceHeader: "Date", fieldId: "roster.notes", basis: "manual" }, { id: "col-b", sourceColumn: null, sourceHeader: "Added", fieldId: null, basis: "unmapped" }],
      rows: [{ id: "row", cells: [{ value: new Date("2026-01-01T00:00:00.000Z"), fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FF112233" } } }, { value: "2026-01-01T00:00:00.000Z" }] }] }] });
  const wire = JSON.parse(JSON.stringify(encodeEditableWorkbook(workbook))) as unknown;
  assert.deepEqual(decodeEditableWorkbook(wire), workbook);
  const saved = SavedWorkbookSchema.parse({ libraryId: "library", version: 2, createdAt: "2026-01-01T00:00:00.000Z", savedAt: "2026-01-02T00:00:00.000Z", workbook });
  assert.deepEqual(decodeSavedWorkbook(JSON.parse(JSON.stringify(encodeSavedWorkbook(saved)))), saved);
  const bad = structuredClone(encodeEditableWorkbook(workbook));
  Reflect.set(bad.sheets[0].rows[0].cells[0], "value", { type: "date", value: "not-a-date" });
  assert.equal(EditableWorkbookWireSchema.safeParse(bad).success, false);
  assert.equal(EditableWorkbookWireSchema.safeParse(workbook).success, false);
});

it('keeps original cell metadata closed and bound to its displayed text', () => {
  const document = { name: 'Synthetic.xlsx', themes: [], hasFormulas: false, sheets: [{ id: 's', name: 'Sheet', width: 2, hidden: [], rows: [{ id: 'r', cells: [
    { value: '001234', numFmt: '000000', hyperlink: 'https://example.com', tooltip: 'Record' },
    { value: 'Tracker note', richText: [{ text: 'Tracker ', font: { bold: true, color: { theme: 1, tint: 0.2 } } }, { text: 'note', font: { underline: 'single' } }] },
  ] }] }] };
  assert.deepEqual(decodeEditableWorkbook(JSON.parse(JSON.stringify(encodeEditableWorkbook(document)))), document);
  const invalid = structuredClone(document);
  Reflect.set(invalid.sheets[0].rows[0].cells[1].richText![0].font, 'unsupported', true);
  assert.equal(EditableWorkbookSchema.safeParse(invalid).success, false);
  const badRow = structuredClone(document);
  Reflect.set(badRow.sheets[0].rows[0], 'sourceRow', 0);
  assert.equal(EditableWorkbookSchema.safeParse(badRow).success, false);
  const stale = structuredClone(document);
  stale.sheets[0].rows[0].cells[1].value = 'Changed';
  assert.equal(EditableWorkbookSchema.safeParse(stale).success, false);
});
