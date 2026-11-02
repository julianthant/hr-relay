import { cellText, type SheetCell, type SheetRow, type EditableSheet, type EditableWorkbook } from '../../../rules/spreadsheets/workbook-io.js';
import { displayExtractedDate, formatInstantDate } from "../../lib/date-format.js";
import { spreadsheetField, spreadsheetValueMatches } from './spreadsheet-fields-model.js';

export function spreadsheetForeground(background: string | undefined): string | undefined {
  const hex = background?.match(/#[0-9a-f]{6}/i)?.[0];
  if (!hex) return undefined;
  const [r, g, b] = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 140 ? 'var(--ds-sheet-contrast-light)' : 'var(--ds-sheet-contrast-dark)';
}
export function cellDisplayText(cell: SheetCell, fieldId?: string | null): string {
  if (cell.value instanceof Date) return formatInstantDate(cell.value, 'UTC');
  const text = cellText(cell);
  return fieldId && spreadsheetField(fieldId).type === 'date' ? displayExtractedDate(text) : text;
}

export function columnName(index: number): string {
  let value = index + 1, result = '';
  while (value > 0) { value -= 1; result = String.fromCharCode(65 + value % 26) + result; value = Math.floor(value / 26); }
  return result;
}
export function newEditableWorkbook(): EditableWorkbook {
  return { name: 'Untitled.xlsx', themes: [], hasFormulas: false, sheets: [{ id: 'sheet-1', name: 'Sheet 1', width: 3, hidden: [], headerRow: 1, columnBindings: ['fullName', 'eid', 'roster.notes'].map((fieldId, column) => ({ id: `sheet-1:column:${column}`, sourceColumn: null, sourceHeader: ['Name', 'Employee ID', 'Notes'][column], fieldId, basis: 'manual' })), rows: [{ id: 'header', cells: [{ value: 'Name' }, { value: 'Employee ID' }, { value: 'Notes' }] }, { id: 'row-1', cells: [{ value: '' }, { value: '' }, { value: '' }] }] }] };
}
export function addSpreadsheetColumn(sheet: EditableSheet, title: string): EditableSheet {
  if (!title.trim()) throw new Error('SPREADSHEET_COLUMN_TITLE_REQUIRED');
  return { ...sheet, width: sheet.width + 1,
    ...(sheet.columnBindings ? { columnBindings: [...sheet.columnBindings, { id: crypto.randomUUID(), sourceColumn: null, sourceHeader: title.trim(), fieldId: null, basis: 'unmapped' as const }] } : {}),
    rows: sheet.rows.map((row, index) => ({ ...row, cells: [...row.cells, ...Array.from({ length: sheet.width - row.cells.length }, () => ({ value: null })), { value: index === (sheet.headerRow ?? 1) - 1 ? title.trim() : '' }] })),
  };
}
function spreadsheetFieldColumn(sheet: EditableSheet, fieldId: string): number {
  const columns = sheet.columnBindings?.flatMap((binding, column) => binding.fieldId === fieldId ? [column] : []) ?? [];
  if (columns.length !== 1 || columns[0] >= sheet.width) throw new Error('SPREADSHEET_FIELD_BINDING_UNAVAILABLE');
  return columns[0];
}
function spreadsheetDataRow(sheet: EditableSheet, rowId: string): SheetRow {
  const rows = sheet.rows.slice(sheet.headerRow ?? 1).filter(row => row.id === rowId);
  if (rows.length !== 1) throw new Error('SPREADSHEET_DATA_ROW_UNAVAILABLE');
  return rows[0];
}
/** Read and write by stable fields, independently of column order or edited header text. */
export function readSpreadsheetField(sheet: EditableSheet, rowId: string, fieldId: string): SheetCell['value'] {
  return spreadsheetDataRow(sheet, rowId).cells[spreadsheetFieldColumn(sheet, fieldId)].value;
}
function editedCell(cell: SheetCell, value: SheetCell['value']): SheetCell {
  const { richText: _richText, hyperlink: _hyperlink, tooltip: _tooltip, ...retained } = cell;
  return { ...retained, value };
}
export function updateSpreadsheetFields(sheet: EditableSheet, rowId: string, values: Readonly<Record<string, SheetCell['value']>>): EditableSheet {
  spreadsheetDataRow(sheet, rowId);
  const updates = Object.entries(values).map(([fieldId, value]) => {
    const column = spreadsheetFieldColumn(sheet, fieldId);
    if (!spreadsheetValueMatches(fieldId, cellText({ value }))) throw new Error('SPREADSHEET_FIELD_VALUE_INVALID');
    return { column, value };
  });
  return { ...sheet, rows: sheet.rows.map(row => row.id !== rowId ? row : { ...row, cells: row.cells.map((cell, column) => {
    const update = updates.find(entry => entry.column === column);
    return update ? editedCell(cell, update.value) : cell;
  }) }) };
}
export function editSpreadsheetCell(sheet: EditableSheet, rowId: string, column: number, value: string): EditableSheet {
  if (!sheet.rows.some(row => row.id === rowId) || column < 0 || column >= sheet.width) throw new Error('SPREADSHEET_CELL_UNAVAILABLE');
  return { ...sheet, rows: sheet.rows.map(row => row.id !== rowId ? row : { ...row, cells: row.cells.map((cell, index) => index === column ? editedCell(cell, value) : cell) }) };
}
export function sortSpreadsheet(sheet: EditableSheet, column: number, direction: 'asc' | 'desc'): EditableSheet {
  if (column < 0 || column >= sheet.width) throw new Error('SPREADSHEET_COLUMN_UNAVAILABLE');
  return { ...sheet, rows: [sheet.rows[0], ...sheet.rows.slice(1).map((row, index) => ({ row, index })).sort((a, b) => {
    const left = cellText(a.row.cells[column]), right = cellText(b.row.cells[column]);
    if (!left || !right) return !left && !right ? a.index - b.index : !left ? 1 : -1;
    const order = left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' });
    return (direction === 'asc' ? order : -order) || a.index - b.index;
  }).map(entry => entry.row)] };
}
export function downloadSpreadsheet(data: ArrayBuffer | string, name: string, format: 'csv' | 'xlsx'): void {
  const blob = new Blob([data], { type: format === 'csv' ? 'text/csv;charset=utf-8' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = `${name.replace(/\.(xlsx|csv)$/i, '')}-edited.${format}`;
  document.body.append(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** A canonical field issue; original library values remain editable. */
export function spreadsheetCellProblem(sheet: EditableSheet, column: number, value: string): string | undefined {
  const fieldId = sheet.columnBindings?.[column]?.fieldId;
  if (!fieldId || spreadsheetValueMatches(fieldId, value)) return undefined;
  const field = spreadsheetField(fieldId);
  return `Does not match ${field.label} (${field.format}).`;
}

export type SpreadsheetSaveResult =
  | { state: 'confirmed'; version: number; readback: EditableWorkbook }
  | { state: 'refused' | 'conflict' | 'uncertain'; reason: string };

function sameSpreadsheetValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (left instanceof Date || right instanceof Date) return left instanceof Date && right instanceof Date && left.getTime() === right.getTime();
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object' || Array.isArray(left) !== Array.isArray(right)) return false;
  if (Array.isArray(left) && Array.isArray(right) && left.length !== right.length) return false;
  const keys = Object.keys(left).filter(key => Reflect.get(left, key) !== undefined);
  return keys.length === Object.keys(right).filter(key => Reflect.get(right, key) !== undefined).length && keys.every(key => Object.hasOwn(right, key) && sameSpreadsheetValue(Reflect.get(left, key), Reflect.get(right, key)));
}

export function spreadsheetSaveMatches(draft: EditableWorkbook, result: SpreadsheetSaveResult): result is Extract<SpreadsheetSaveResult, { state: 'confirmed' }> {
  return result.state === 'confirmed' && Number.isSafeInteger(result.version) && result.version > 0
    && sameSpreadsheetValue(result.readback, draft.libraryId === undefined && result.version === 1 && result.readback.libraryId ? { ...draft, libraryId: result.readback.libraryId } : draft);
}
