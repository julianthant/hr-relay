import { describe, expect, it } from "vitest";
import { IsoInstantSchema } from "../../../../src/rules/identity/ids.js";
import { EditableWorkbookWireSchema, type EditableWorkbookWire } from "../../../../src/models/dashboard/workbooks.js";
import { InputRunSurfaceSchema, type TypedInputDraft } from "../../../../src/models/workflow/ingress.js";
import { workbookRowChoices, resolveWorkbookRowSelection, previewWorkbookRows } from "../../../../src/dashboard/surfaces/run-start/run-workbook-rows-model.js";

const logicalId = "sample-roster";
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
  it("refuses a selected worksheet absent from a named version", () => {
    expect(() => workbookRowChoices(workbook(), "email", "former-sheet")).toThrow(/RUN_WORKBOOK_SHEET_UNAVAILABLE/u);
  });
  it("excludes preamble and headers, preserving sheet order, physical coordinates and source labels", () => {
    expect(workbookRowChoices(workbook(), "email", "first")).toEqual([
      { sheetId: "first", rowId: "same-row", sourceLabel: "First sheet · Row 19", key: { state: "available", value: "duplicate@example.test" } },
      { sheetId: "first", rowId: "next", sourceLabel: "First sheet · Row 4", key: { state: "available", value: "other@example.test" } },
    ]);
  });

  it("keeps every unavailable key visible and does not coerce or trim a saved assertion", () => {
    const input = workbook();
    input.sheets[0].rows = [row("header", "Email"), row("missing", null), row("number", 123), row("boolean", false), row("date", { type: "date", value: IsoInstantSchema.parse("2026-01-01T00:00:00.000Z") }), row("blank", "  "), row("empty", ""), row("raw", " raw@example.test ")];
    input.sheets[0].headerRow = 1;
    const choices = workbookRowChoices(EditableWorkbookWireSchema.parse(input), "email", "first").filter(choice => choice.sheetId === "first");
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

  it("reports missing selected-sheet bindings without dropping data rows", () => {
    const input = workbook();
    delete input.sheets[0].columnBindings;
    expect(workbookRowChoices(input, "email", "first").map(choice => choice.key.state === "unavailable" ? choice.key.reason : choice.key.value)).toEqual(["key-binding-missing", "key-binding-missing"]);
  });

  it("refuses ambiguous bindings rather than choosing a column", () => {
    const input = workbook();
    input.sheets[0].columnBindings = [binding, { ...binding, id: "second-email-column" }];
    expect(workbookRowChoices(input, "email", "first").slice(0, 2).map(choice => choice.key)).toEqual([
      { state: "unavailable", reason: "key-binding-ambiguous" }, { state: "unavailable", reason: "key-binding-ambiguous" },
    ]);
  });

  it("resolves reverse selections in workbook order and keeps duplicate keys and unavailable choices", () => {
    const input = workbook();
    input.sheets[0].rows[3].cells[0].value = null;
    const choices = workbookRowChoices(input, "email", "first");
    const selected = [choices[1], choices[0]];
    expect(resolveWorkbookRowSelection(choices, selected)).toEqual(choices);
    expect(resolveWorkbookRowSelection(choices, [])).toEqual([]);
  });

  it("refuses forged and duplicate physical coordinates", () => {
    const choices = workbookRowChoices(workbook(), "email", "first");
    expect(() => resolveWorkbookRowSelection(choices, [{ sheetId: "absent", rowId: "same-row" }])).toThrow("RUN_WORKBOOK_ROW_SELECTION_UNKNOWN");
    expect(() => resolveWorkbookRowSelection(choices, [{ sheetId: "first", rowId: "header" }])).toThrow("RUN_WORKBOOK_ROW_SELECTION_UNKNOWN");
    expect(() => resolveWorkbookRowSelection(choices, [choices[0], { sheetId: "first", rowId: "same-row" }])).toThrow("RUN_WORKBOOK_ROW_SELECTION_DUPLICATE");
  });
});

const parser = { split: { kind: "delimited", delimiters: [";", "\n"] }, rules: [{ when: { kind: "pattern", pattern: "email" }, emit: "email" }] };
const rowSurface = InputRunSurfaceSchema.parse({ placeholder: "Emails", parser, workbookRows: { typeId: logicalId, inputField: "email" }, typedInput: {
  modeField: "mode", modeLabel: "Hire mode", initialMode: "new-hire", description: "Choose hire mode", controls: [], modes: ["new-hire", "rehire"].map(value => ({
    value, label: value, inputLabel: "Email", hint: "One email", placeholder: "Email", defaults: [{ field: "postalCodeOverride", value: { kind: "text", text: "" } }],
    parser: { kind: "entries", spec: parser }, display: { kind: "first-present", fields: ["email"] }, identityFields: ["email"],
  })),
} });

describe("selected physical row preview", () => {
  it("parses each physical row separately and repeats explicit mode/options without deduplicating keys", () => {
    const choices = workbookRowChoices(workbook(), "email", "first");
    const preview = previewWorkbookRows(rowSurface, choices, [choices[1], choices[0]], { mode: "rehire", postalCodeOverride: "92093" });
    expect(preview.problem).toBeNull();
    expect(preview.submissions).toEqual(["duplicate@example.test", "other@example.test"].map(email => ({ email, mode: "rehire", postalCodeOverride: "92093" })));
    expect(preview.entries).toEqual([
      { index: 0, sourceText: "First sheet · Row 19: duplicate@example.test" }, { index: 1, sourceText: "First sheet · Row 4: other@example.test" },
    ]);
  });

  it("requires an explicit declared mode and never adopts initialMode for saved rows", () => {
    const choices = workbookRowChoices(workbook(), "email", "first");
    const drafts: readonly TypedInputDraft[] = [{}, { mode: "unknown" }, { mode: true }];
    for (const draft of drafts) {
      const preview = previewWorkbookRows(rowSurface, choices, [choices[0]], draft);
      expect(preview.problem).toContain("Choose Hire mode");
      expect(preview.submissions).toEqual([]);
      expect(preview.entries).toHaveLength(1);
    }
    expect(previewWorkbookRows(rowSurface, choices, [])).toEqual({ entries: [], submissions: [], problem: null });
  });

  it.each([null, "bad-email", "first@example.test;second@example.test", "first@example.test\nsecond@example.test", " duplicate@example.test "])("blocks every submission and attributes an unavailable or changed key %j", value => {
    const input = workbook();
    input.sheets[0].rows[3].cells[0].value = value;
    const choices = workbookRowChoices(input, "email", "first");
    const preview = previewWorkbookRows(rowSurface, choices, [choices[0], choices[1]], { mode: "new-hire" });
    expect(preview.submissions).toEqual([]);
    expect(preview.problem).toContain("First sheet · Row 4:");
    expect(preview.entries).toHaveLength(2);
    expect(preview.entries[1].sourceText).toContain("First sheet · Row 4:");
  });

  it("uses exactly the declared inputField and refuses a mode parser emitting a different field", () => {
    const choices = workbookRowChoices(workbook(), "email", "first");
    const surface = structuredClone(rowSurface);
    surface.workbookRows = { typeId: logicalId, inputField: "lookupEmail" };
    surface.parser.rules[0].emit = "lookupEmail";
    expect(previewWorkbookRows(surface, choices, [choices[0]], { mode: "new-hire" }).problem).toContain("preserve the saved row key exactly");
    delete surface.typedInput;
    expect(previewWorkbookRows(surface, choices, [choices[0]]).submissions).toEqual([{ lookupEmail: "duplicate@example.test" }]);
  });

  it("requires the declared workbook row capability before producing submissions", () => {
    const surface = structuredClone(rowSurface);
    delete surface.workbookRows;
    const choices = workbookRowChoices(workbook(), "email", "first");
    expect(previewWorkbookRows(surface, choices, [choices[0]], { mode: "new-hire" })).toMatchObject({ submissions: [], problem: "Saved-row input is unavailable for this workflow." });
  });
});


it("uses operator-facing validation text in both selected entries and problems", () => {
  const choices = workbookRowChoices(workbook(), "email", "first");
  const reasons = ["key-field-missing", "key-binding-missing", "key-binding-ambiguous", "key-missing", "key-not-text", "key-blank"] as const;
  const messages = [
    "This workflow has no lookup key.", "The lookup key column is not mapped.",
    "The lookup key column has an ambiguous mapping.", "This row has no lookup key.",
    "The lookup key must be text.", "The lookup key is blank.",
  ];
  for (const [index, reason] of reasons.entries()) {
    const choice = { ...choices[0], key: { state: "unavailable" as const, reason } };
    const preview = previewWorkbookRows(rowSurface, [choice], [choice], { mode: "new-hire" });
    const expected = `First sheet · Row 19: ${messages[index]}`;
    expect(preview.entries).toEqual([{ index: 0, sourceText: expected }]);
    expect(preview.problem).toBe(expected);
    expect(preview.submissions).toEqual([]);
  }
});
