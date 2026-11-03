import type { EditableWorkbookWire, WorkbookType } from "../../../models/dashboard/workbooks.js";

export interface WorkbookRowCoordinate {
  readonly sheetId: string;
  readonly rowId: string;
}

export type WorkbookRowChoice = WorkbookRowCoordinate & {
  readonly sourceLabel: string;
  readonly key: { readonly state: "available"; readonly value: string }
    | { readonly state: "unavailable"; readonly reason: "key-field-missing" | "key-binding-missing" | "key-binding-ambiguous" | "key-missing" | "key-not-text" | "key-blank" };
};

export function workbookRowChoices(workbook: EditableWorkbookWire, type: WorkbookType): readonly WorkbookRowChoice[] {
  return workbook.sheets.flatMap(sheet => {
    const columns = sheet.columnBindings?.flatMap((binding, index) => binding.fieldId === type.keyFieldId && type.keyFieldId !== null ? [index] : []) ?? [];
    const headerRows = sheet.headerRow ?? 1;
    return sheet.rows.slice(headerRows).map((row, index): WorkbookRowChoice => {
      const coordinate = { sheetId: sheet.id, rowId: row.id, sourceLabel: `${sheet.name} · Row ${row.sourceRow ?? headerRows + index + 1}` };
      if (type.keyFieldId === null) return { ...coordinate, key: { state: "unavailable", reason: "key-field-missing" } };
      if (columns.length === 0) return { ...coordinate, key: { state: "unavailable", reason: "key-binding-missing" } };
      if (columns.length > 1) return { ...coordinate, key: { state: "unavailable", reason: "key-binding-ambiguous" } };
      const value = row.cells[columns[0]]?.value;
      if (value === undefined || value === null) return { ...coordinate, key: { state: "unavailable", reason: "key-missing" } };
      if (typeof value !== "string") return { ...coordinate, key: { state: "unavailable", reason: "key-not-text" } };
      if (value.trim().length === 0) return { ...coordinate, key: { state: "unavailable", reason: "key-blank" } };
      return { ...coordinate, key: { state: "available", value } };
    });
  });
}

const rowIdentity = ({ sheetId, rowId }: WorkbookRowCoordinate): string => JSON.stringify([sheetId, rowId]);

export function resolveWorkbookRowSelection(choices: readonly WorkbookRowChoice[], selected: readonly WorkbookRowCoordinate[]): readonly WorkbookRowChoice[] {
  const known = new Set(choices.map(rowIdentity));
  const identities = new Set<string>();
  for (const coordinate of selected) {
    const identity = rowIdentity(coordinate);
    if (!known.has(identity)) throw new Error("RUN_WORKBOOK_ROW_SELECTION_UNKNOWN");
    if (identities.has(identity)) throw new Error("RUN_WORKBOOK_ROW_SELECTION_DUPLICATE");
    identities.add(identity);
  }
  return choices.filter(choice => identities.has(rowIdentity(choice)));
}
