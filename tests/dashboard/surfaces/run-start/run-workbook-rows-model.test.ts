import { describe, expect, it } from "vitest";
import { IsoInstantSchema } from "../../../../src/rules/identity/ids.js";
import { EditableWorkbookWireSchema, WorkbookTypeSchema, type EditableWorkbookWire } from "../../../../src/models/dashboard/workbooks.js";
import { workbookRowChoices, resolveWorkbookRowSelection } from "../../../../src/dashboard/surfaces/run-start/run-workbook-rows-model.js";

const type = WorkbookTypeSchema.parse({ id: "sample-roster", name: "Sample roster", keyFieldId: "email", fields: ["email"], defaultWorkbookId: null });
const binding = { id: "email-column", sourceColumn: 9, sourceHeader: "Email", fieldId: "email", basis: "manual" as const };
const row = (id: string, value: EditableWorkbookWire["sheets"][number]["rows"][number]["cells"][number]["value"], sourceRow?: number) => ({ id, cells: [{ value }], ...(sourceRow === undefined ? {} : { sourceRow }) });
function workbook(): EditableWorkbookWire {
  return EditableWorkbookWireSchema.parse({ name: "Saved roster", libraryId: "saved-roster", hasFormulas: false, themes: [], sheets: [
    { id: "first", name: "First sheet", width: 1, hidden: [], headerRow: 2, sourceHeaderRow: 18, columnBindings: [binding], rows: [
      row("preamble", "Preamble"), row("header", "Email"), row("same-row", "duplicate@example.test", 19), row("next", "other@example.test"),
    ] },
    { id: "second", name: "Second sheet", width: 1, hidden: [], columnBindings: [binding], rows: [
      row("header", "Email"), row("same-row", "duplicate@example.test"),
    ] },
  ] });
}

describe("saved workbook row choices", () => {
  it("excludes preamble and headers, preserving sheet order, physical coordinates and source labels", () => {
    expect(workbookRowChoices(workbook(), type)).toEqual([
      { sheetId: "first", rowId: "same-row", sourceLabel: "First sheet · Row 19", key: { state: "available", value: "duplicate@example.test" } },
      { sheetId: "first", rowId: "next", sourceLabel: "First sheet · Row 4", key: { state: "available", value: "other@example.test" } },
      { sheetId: "second", rowId: "same-row", sourceLabel: "Second sheet · Row 2", key: { state: "available", value: "duplicate@example.test" } },
    ]);
  });

  it("keeps every unavailable key visible and does not coerce or trim a saved assertion", () => {
    const input = workbook();
    input.sheets[0].rows = [row("header", "Email"), row("missing", null), row("number", 123), row("boolean", false), row("date", { type: "date", value: IsoInstantSchema.parse("2026-01-01T00:00:00.000Z") }), row("blank", "  "), row("empty", ""), row("raw", " raw@example.test ")];
    input.sheets[0].headerRow = 1;
    const choices = workbookRowChoices(EditableWorkbookWireSchema.parse(input), type).filter(choice => choice.sheetId === "first");
    expect(choices.map(choice => choice.rowId)).toEqual(["missing", "number", "boolean", "date", "blank", "empty", "raw"]);
    expect(choices.map(choice => choice.key)).toEqual([
      { state: "unavailable", reason: "key-missing" },
      { state: "unavailable", reason: "key-not-text" },
      { state: "unavailable", reason: "key-not-text" },
      { state: "unavailable", reason: "key-not-text" },
      { state: "unavailable", reason: "key-blank" },
      { state: "unavailable", reason: "key-blank" },
      { state: "available", value: " raw@example.test " },
    ]);
  });

  it("reports absent type keys and missing sheet bindings without dropping data rows", () => {
    const input = workbook();
    delete input.sheets[0].columnBindings;
    expect(workbookRowChoices(input, type).map(choice => choice.key.state === "unavailable" ? choice.key.reason : choice.key.value)).toEqual(["key-binding-missing", "key-binding-missing", "duplicate@example.test"]);
    expect(workbookRowChoices(input, { ...type, keyFieldId: null }).map(choice => choice.key)).toEqual(Array.from({ length: 3 }, () => ({ state: "unavailable", reason: "key-field-missing" })));
  });

  it("refuses ambiguous bindings rather than choosing a column", () => {
    const input = workbook();
    input.sheets[0].columnBindings = [binding, { ...binding, id: "second-email-column" }];
    expect(workbookRowChoices(input, type).slice(0, 2).map(choice => choice.key)).toEqual([
      { state: "unavailable", reason: "key-binding-ambiguous" }, { state: "unavailable", reason: "key-binding-ambiguous" },
    ]);
  });

  it("resolves reverse selections in workbook order and keeps duplicate keys and unavailable choices", () => {
    const input = workbook();
    input.sheets[0].rows[3].cells[0].value = null;
    const choices = workbookRowChoices(input, type);
    const selected = [choices[2], choices[1], choices[0]];
    expect(resolveWorkbookRowSelection(choices, selected)).toEqual(choices);
    expect(resolveWorkbookRowSelection(choices, [])).toEqual([]);
  });

  it("refuses forged and duplicate physical coordinates", () => {
    const choices = workbookRowChoices(workbook(), type);
    expect(() => resolveWorkbookRowSelection(choices, [{ sheetId: "absent", rowId: "same-row" }])).toThrow("RUN_WORKBOOK_ROW_SELECTION_UNKNOWN");
    expect(() => resolveWorkbookRowSelection(choices, [{ sheetId: "first", rowId: "header" }])).toThrow("RUN_WORKBOOK_ROW_SELECTION_UNKNOWN");
    expect(() => resolveWorkbookRowSelection(choices, [choices[0], { sheetId: "first", rowId: "same-row" }])).toThrow("RUN_WORKBOOK_ROW_SELECTION_DUPLICATE");
  });
});
