import { expect, it } from 'vitest';
import { WorkbookTypeSchema } from '../../../../src/models/dashboard/workbooks.js';
import { spreadsheetTypeColumn, spreadsheetTypeColumns, spreadsheetTypeError, spreadsheetTypeHeaders } from '../../../../src/dashboard/surfaces/spreadsheets/spreadsheet-type-model.js';
import { spreadsheetField } from '../../../../src/models/fields/workbook-fields.js';
import { newEditableWorkbook } from '../../../../src/dashboard/surfaces/spreadsheets/spreadsheet-editor-model.js';

it('authors 31 named columns with stable identities and required fields', () => {
  const columns = Array.from({ length: 31 }, (_, index) => spreadsheetTypeColumn(`Synthetic field ${index + 1}`));
  expect(spreadsheetTypeError('Onboarding roster', columns)).toBeUndefined();
  expect(() => spreadsheetField(columns[0].id)).toThrow(/SPREADSHEET_FIELD_NOT_FOUND/u);
  const type = WorkbookTypeSchema.parse({ id: 'synthetic', name: 'Onboarding roster', keyFieldId: null, defaultWorkbookId: null,
    fields: columns.map(column => column.id), fieldLabels: Object.fromEntries(columns.map(column => [column.id, column.name])), requiredFields: [columns[0].id] });
  expect(spreadsheetTypeColumns(type)).toEqual(columns.map((column, index) => ({ ...column, required: index === 0 })));
  const renamed = WorkbookTypeSchema.parse({ ...type, fieldLabels: { ...type.fieldLabels, [columns[0].id]: 'Renamed field' } });
  expect(renamed.fields).toEqual(type.fields);
  expect(spreadsheetTypeError('Roster', [])).toMatch(/at least one/);
  expect(spreadsheetTypeError('Roster', [{ ...columns[0], name: '' }])).toMatch(/every column/);
  expect(spreadsheetTypeError('Roster', [columns[0], { ...columns[1], name: ` ${columns[0].name.toUpperCase()} ` }])).toMatch(/unique/);
  expect(WorkbookTypeSchema.safeParse({ ...type, requiredFields: ['roster.absent'] }).success).toBe(false);
  expect(WorkbookTypeSchema.safeParse({ ...type, fieldLabels: { ...type.fieldLabels, [columns[1].id]: columns[0].name } }).success).toBe(false);
});

it('suggests only the selected header row from each imported sheet', () => {
  const workbook = newEditableWorkbook(), sheet = workbook.sheets[0];
  expect(spreadsheetTypeHeaders({ ...workbook, sheets: [{ ...sheet, headerRow: 2, rows: [sheet.rows[1], sheet.rows[0]] }] })).toEqual(['Name', 'Employee ID', 'Notes']);
  expect(spreadsheetTypeColumn('Employee ID').id).toBe('eid');
});
