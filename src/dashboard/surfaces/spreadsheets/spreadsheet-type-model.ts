import type { WorkbookType } from '../../../models/dashboard/workbooks.js';
import { cellText, type EditableWorkbook } from '../../../rules/spreadsheets/workbook-io.js';
import { fieldForSpreadsheetHeader, spreadsheetField } from './spreadsheet-fields-model.js';

export type SpreadsheetTypeColumn = { id: string; name: string; required: boolean };
export function spreadsheetTypeColumns(type?: WorkbookType): SpreadsheetTypeColumn[] {
  return (type?.fields ?? ['firstName', 'lastName', 'eid']).map(id => ({ id, name: type?.fieldLabels?.[id] ?? spreadsheetField(id).label, required: type?.requiredFields?.includes(id) ?? false }));
}
export function spreadsheetTypeColumn(name = ''): SpreadsheetTypeColumn {
  return { id: fieldForSpreadsheetHeader(name)?.id ?? `roster.custom${crypto.randomUUID().replaceAll('-', '')}`, name, required: false };
}
export function spreadsheetTypeHeaders(workbook?: EditableWorkbook | null): string[] {
  return [...new Set(workbook?.sheets.flatMap(sheet => sheet.rows[(sheet.headerRow ?? 1) - 1].cells.map(cellText).map(header => header.trim()).filter(Boolean)) ?? [])];
}
export function spreadsheetTypeError(name: string, columns: readonly SpreadsheetTypeColumn[]): string | undefined {
  if (!name.trim()) return 'Enter a type name.';
  if (!columns.length) return 'Add at least one column.';
  if (columns.some(column => !column.name.trim())) return 'Enter a name for every column.';
  if (new Set(columns.map(column => column.name.trim().toLowerCase())).size !== columns.length) return 'Column names must be unique.';
  if (new Set(columns.map(column => column.id)).size !== columns.length) return 'These columns map to the same field. Keep one of them.';
}
