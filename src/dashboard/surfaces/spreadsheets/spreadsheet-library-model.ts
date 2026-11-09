import { WorkbookLibraryEntrySchema, type WorkbookLibraryEntry } from '../../../models/dashboard/workbook-library.js';
import { WorkbookTypeSchema, type WorkbookType } from '../../../models/dashboard/workbooks.js';
import { registeredSpreadsheetWorkbook, type RegisteredSpreadsheet, type SpreadsheetType } from './spreadsheet-mock-model.js';
import { fieldForSpreadsheetHeader } from '../../../models/fields/workbook-fields.js';

export function mockWorkbookTypes(types: readonly SpreadsheetType[]): WorkbookType[] {
  return [...types.map(type => type.definition ?? WorkbookTypeSchema.parse({ id: type.id, name: type.name, fields: type.fields.map(field => {
    const resolved = fieldForSpreadsheetHeader(field);
    if (!resolved) throw new Error('SPREADSHEET_FIELD_NOT_FOUND');
    return resolved.id;
  }), keyFieldId: null, defaultWorkbookId: null })), WorkbookTypeSchema.parse({ id: 'local', name: 'Local spreadsheet', fields: [], keyFieldId: null, defaultWorkbookId: null })];
}
export function mockWorkbookLibrary(files: readonly RegisteredSpreadsheet[], types: readonly WorkbookType[]): WorkbookLibraryEntry[] {
  return files.map(file => {
    if (!file.addedAt) throw new Error('SPREADSHEET_FIXTURE_DATE_REQUIRED');
    const version = file.version ?? 1;
    return WorkbookLibraryEntrySchema.parse({ libraryId: file.id, version, name: file.name, updatedAt: file.addedAt,
      worksheets: file.sheets.map((sheet, index) => ({ id: `sheet-${index + 1}`, name: sheet.name })),
      rowCount: file.rowCount ?? registeredSpreadsheetWorkbook(file).sheets.reduce((count, sheet) => count + sheet.rows.length - (sheet.headerRow ?? 1), 0),
      metadata: { typeId: file.typeId, sharePoint: null }, type: types.find(type => type.id === file.typeId),
      state: { libraryId: file.id, revision: version, selectedVersionId: 'current', origin: { kind: 'local' }, removed: false,
        versions: [{ id: 'current', name: 'Original', snapshotId: `${file.id}:current`, version, savedAt: file.addedAt, source: 'import' }] } });
  });
}
