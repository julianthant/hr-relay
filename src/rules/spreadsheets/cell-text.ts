import type { SheetCell } from './workbook-io.js';

/** Kept apart from workbook-io so the dashboard reads cell text without loading the XLSX and CSV libraries. */
export function cellText(cell: SheetCell): string {
  return cell.value instanceof Date ? cell.value.toISOString().slice(0, 10) : cell.value === null ? '' : String(cell.value);
}
