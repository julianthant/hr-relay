import { cellText } from './cell-text.js';
import type { EditableSheet, EditableWorkbook } from './workbook-io.js';

const headersOf = (sheet: EditableSheet): string =>
  JSON.stringify(Array.from({ length: sheet.width }, (_, column) => cellText(sheet.rows[(sheet.headerRow ?? 1) - 1]?.cells[column] ?? { value: null }).trim()));

/** The ids of the worksheets whose header row matches `worksheetId`'s, that one included, in workbook order. */
export function sameHeaderWorksheets(workbook: EditableWorkbook, worksheetId: string): readonly string[] {
  const source = workbook.sheets.find(sheet => sheet.id === worksheetId);
  if (!source?.columnBindings) return [];
  const headers = headersOf(source);
  return workbook.sheets.filter(sheet => sheet.columnBindings && headersOf(sheet) === headers).map(sheet => sheet.id);
}

/** Every worksheet with `worksheetId`'s headers takes its column mapping; the others are unchanged. */
export function copyColumnMapping(workbook: EditableWorkbook, worksheetId: string): EditableWorkbook {
  const source = workbook.sheets.find(sheet => sheet.id === worksheetId)?.columnBindings;
  if (!source) throw new Error('SPREADSHEET_COLUMN_BINDING_UNAVAILABLE');
  const targets = new Set(sameHeaderWorksheets(workbook, worksheetId));
  return { ...workbook, sheets: workbook.sheets.map(sheet => !targets.has(sheet.id) || sheet.id === worksheetId ? sheet
    : { ...sheet, columnBindings: sheet.columnBindings?.map((binding, column) => ({ ...binding, fieldId: source[column].fieldId, basis: source[column].basis })) }) };
}
