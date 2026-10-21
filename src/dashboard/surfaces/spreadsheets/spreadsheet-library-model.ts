import type { RegisteredSpreadsheet, SpreadsheetType } from './spreadsheet-mock-model.js';
import { registeredSpreadsheetWorkbook } from './spreadsheet-mock-model.js';

export type KronosReportDatesPort = Readonly<{ start: string; end: string; disabled?: boolean; onChange: (field: 'start' | 'end', value: string) => void }>;
export function spreadsheetRowCount(file: RegisteredSpreadsheet): number {
  return file.rowCount ?? registeredSpreadsheetWorkbook(file).sheets.reduce((count, sheet) => count + sheet.rows.length - (sheet.headerRow ?? 1), 0);
}
export function spreadsheetTypeName(file: RegisteredSpreadsheet, types: readonly SpreadsheetType[]): string {
  return types.find(type => type.id === file.typeId)?.name ?? (/\.csv$/iu.test(file.name) ? 'CSV' : 'XLSX');
}
