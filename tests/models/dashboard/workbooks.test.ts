import assert from "node:assert/strict";
import { it } from "vitest";
import { EditableWorkbookSchema, EditableWorkbookWireSchema, SavedWorkbookSchema, decodeEditableWorkbook, encodeEditableWorkbook, decodeSavedWorkbook, encodeSavedWorkbook } from "../../../src/models/dashboard/workbooks.js";

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
