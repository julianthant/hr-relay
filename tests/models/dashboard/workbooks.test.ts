import assert from "node:assert/strict";
import { it } from "vitest";
import { EditableWorkbookSchema, EditableWorkbookWireSchema, SavedWorkbookSchema, decodeEditableWorkbook, encodeEditableWorkbook, decodeSavedWorkbook, encodeSavedWorkbook } from "../../../src/models/dashboard/workbooks.js";
import { RunWorkbookReferenceSchema, RunWorkbookAllRowsReferenceSchema, bindRunWorkbookReference, parseRunWorkbookReference } from "../../../src/models/dashboard/workbooks.js";
import { canonicalJsonStringify } from "../../../src/rules/validation/canonical-json.js";
import { sha256Hex } from "../../../src/rules/validation/sha256.js";
import { RunWorkbookNamedReferenceSchema, RunWorkbookNamedAllRowsReferenceSchema } from "../../../src/models/dashboard/workbooks.js";
import { SchemaBoundCanonicalValueSchema, deriveSchemaHash } from "../../../src/models/validation/schema-bound-value.js";

it('admits 250,000 false values in a 500,000-position grid and refuses either limit independently', () => {
  const workbook = { name: 'Synthetic.xlsx', themes: [], hasFormulas: false, sheets: [{ id: 'one', name: 'One', width: 1000, hidden: [], rows:
    Array.from({ length: 500 }, (_, row) => ({ id: `row-${row}`, cells: Array.from({ length: 1000 }, (_, column) => ({ value: column % 2 === 0 ? false : null })) })) }] };
  assert.equal(EditableWorkbookSchema.safeParse(workbook).success, true);
  workbook.sheets[0].rows[0].cells[1].value = false;
  const populated = EditableWorkbookSchema.safeParse(workbook);
  assert.equal(populated.success, false);
  if (!populated.success) assert.match(populated.error.issues[0].message, /250,001 populated cells.*250,000/su);
  workbook.sheets[0].rows[0].cells[1].value = null;
  workbook.sheets[0].rows.push({ id: 'extra', cells: Array.from({ length: 1000 }, () => ({ value: null })) });
  const grid = EditableWorkbookWireSchema.safeParse(workbook);
  assert.equal(grid.success, false);
  if (!grid.success) assert.match(grid.error.issues[0].message, /250,000 populated cells.*501,000.*500,000/su);
});

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
import { WorkbookSelectedRowReferenceRequestSchema, RunWorkbookSelectedRowReferenceSchema } from "../../../src/models/dashboard/workbooks.js";
import { WorkbookActiveSelectionSchema } from "../../../src/models/dashboard/workbook-library.js";

it("retains selected physical row authority with explicit library, version and at least one key", () => {
  const selectedRow = { sheetId: "people", rowId: "person" };
  const request = { typeId: "onboarding-roster", libraryId: "roster", versionId: "saved", selectedRow,
    keys: ["hire@example.test"], fields: ["email"] };
  const snapshot = { libraryId: "roster", version: 1, versionId: "saved", versionName: "Saved",
    worksheets: [{ sheetId: "people", name: "People" }],
    type: { id: "onboarding-roster", name: "Roster", keyFieldId: "email", fields: ["email"], defaultWorkbookId: null },
    rows: [{ key: request.keys[0], state: "matched", matches: [{ ...selectedRow, values: { email: request.keys[0] } }] }] };
  assert.deepEqual(RunWorkbookSelectedRowReferenceSchema.parse({ request, snapshot }), { request, snapshot });
  assert.equal(bindRunWorkbookReference(request, snapshot).schemaHash, deriveSchemaHash(RunWorkbookSelectedRowReferenceSchema, "output"));
  const { selectedRow: _selection, ...ordinary } = request;
  assert.equal(bindRunWorkbookReference(ordinary, snapshot).schemaHash, deriveSchemaHash(RunWorkbookNamedReferenceSchema, "output"));
  assert.deepEqual(WorkbookActiveSelectionSchema.parse({ entry: 1,
    libraryId: request.libraryId, versionId: request.versionId, sheetId: selectedRow.sheetId,
    expectedVersion: 1, selectedRow }).selectedRow, selectedRow);
  assert.equal(WorkbookSelectedRowReferenceRequestSchema.safeParse({ ...request, keys: [...request.keys, "other@example.test"] }).success, true);
  for (const value of [{ ...request, libraryId: undefined }, { ...request, versionId: undefined }, { ...request, keys: [] }]) {
    assert.equal(WorkbookSelectedRowReferenceRequestSchema.safeParse(value).success, false);
  }
  for (const value of [{ ...request, selectedRow: { ...selectedRow, sheetId: "foreign" } },
    { ...request, selectedRow: { ...selectedRow, rowId: "missing" } }]) {
    assert.equal(RunWorkbookSelectedRowReferenceSchema.safeParse({ request: value, snapshot }).success, false);
  }
  assert.equal(RunWorkbookSelectedRowReferenceSchema.safeParse({ request, snapshot: { ...snapshot, versionId: "different" } }).success, false);
  assert.equal(RunWorkbookSelectedRowReferenceSchema.safeParse({ request, snapshot: { ...snapshot,
    rows: [{ ...snapshot.rows[0], state: "ambiguous", matches: [...snapshot.rows[0].matches, ...snapshot.rows[0].matches] }] } }).success, false);
  assert.equal(WorkbookActiveSelectionSchema.safeParse({ entry: 1, selectedRow }).success, false);
  assert.equal(WorkbookActiveSelectionSchema.safeParse({ entry: 1, typeId: request.typeId,
    libraryId: request.libraryId, versionId: request.versionId, sheetId: selectedRow.sheetId,
    expectedVersion: 1 }).success, false);
  assert.equal(WorkbookActiveSelectionSchema.safeParse({ entry: 1, libraryId: request.libraryId,
    versionId: request.versionId, sheetId: selectedRow.sheetId }).success, false);
});

it("retains the exact published selected-row hash even without a selector or version metadata", () => {
  assert.equal(deriveSchemaHash(RunWorkbookNamedReferenceSchema, "output"), "64e6bab94d4bcf27c4e5c5328eff093840ede504eac806de297b253b51f37b7f");
  assert.equal(deriveSchemaHash(RunWorkbookNamedAllRowsReferenceSchema, "output"), "b454cb6d56b75b93c4ae28ff93560b7af4a87b018769f3a3721e39d367fea409");
  assert.equal(deriveSchemaHash(RunWorkbookSelectedRowReferenceSchema, "output"), "037d180c6cd7962144b5ba0a48991ee6bf00318c6e3b38df0ffe4b54a1e8ea6c");
  const bound = SchemaBoundCanonicalValueSchema.parse(JSON.parse('{"schemaHash":"037d180c6cd7962144b5ba0a48991ee6bf00318c6e3b38df0ffe4b54a1e8ea6c","value":{"request":{"typeId":"roster","keys":["key"],"fields":["eid"]},"snapshot":{"libraryId":"library","version":2,"worksheets":[{"sheetId":"people","name":"People"}],"type":{"id":"roster","name":"Roster","keyFieldId":"eid","fields":["eid"],"defaultWorkbookId":"library"},"rows":[{"key":"key","state":"missing","matches":[]}]}}}'));
  const bytes = canonicalJsonStringify(bound), digest = sha256Hex(bytes);
  assert.deepEqual(parseRunWorkbookReference(bound), bound.value);
  assert.equal(canonicalJsonStringify(bound), bytes); assert.equal(sha256Hex(canonicalJsonStringify(bound)), digest);
  assert.throws(() => parseRunWorkbookReference(SchemaBoundCanonicalValueSchema.parse({ ...bound, schemaHash: "f".repeat(64) })));
  assert.throws(() => parseRunWorkbookReference({ ...bound, value: { ...parseRunWorkbookReference(bound), snapshot: { ...parseRunWorkbookReference(bound).snapshot, versionId: "unpaired" } } }));
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
