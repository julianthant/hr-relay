import { cellText, columnName, type EditableSheet, type EditableWorkbook } from './spreadsheet-editor-model.js';
import { fieldForSpreadsheetHeader, spreadsheetField, spreadsheetValueMatches, suggestSpreadsheetField } from './spreadsheet-fields-model.js';

export function spreadsheetHeaderRow(sheet: EditableSheet): number {
  const row = sheet.headerRow ?? 1;
  if (!Number.isSafeInteger(row) || row < 1 || row > sheet.rows.length) throw new Error('SPREADSHEET_HEADER_ROW_INVALID');
  return row;
}
export function setSpreadsheetHeaderRow(sheet: EditableSheet, row: number): EditableSheet {
  if (!Number.isSafeInteger(row) || row < 1 || row > sheet.rows.length) throw new Error('SPREADSHEET_HEADER_ROW_INVALID');
  return { ...sheet, headerRow: row, sourceHeaderRow: sheet.sourceHeaderRow === undefined ? undefined : sheet.sourceHeaderRow + row - spreadsheetHeaderRow(sheet), columnBindings: Array.from({ length: sheet.width }, (_, column) => {
    const header = cellText(sheet.rows[row - 1].cells[column]).trim();
    const samples = sheet.rows.slice(row, row + 25).map(entry => cellText(entry.cells[column]));
    const previous = sheet.columnBindings?.[column];
    return { id: previous?.id ?? `${sheet.id}:column:${column}`, sourceColumn: previous ? previous.sourceColumn : column, sourceHeader: header, ...suggestSpreadsheetField(header, samples) };
  }) };
}
export function prepareSpreadsheetColumns(document: EditableWorkbook): EditableWorkbook {
  return { ...document, sheets: document.sheets.map(sheet => {
    let header = 1, best = 0;
    sheet.rows.slice(0, 50).forEach((row, index) => {
      const fields = new Set(row.cells.flatMap(cell => { const field = fieldForSpreadsheetHeader(cellText(cell)); return field ? [field.id] : []; }));
      if (fields.size > best) { best = fields.size; header = index + 1; }
    });
    return setSpreadsheetHeaderRow({ ...sheet, hidden: [], columnBindings: undefined }, header);
  }) };
}
export function setSpreadsheetColumnField(sheet: EditableSheet, column: number, fieldId: string | null): EditableSheet {
  if (fieldId !== null) spreadsheetField(fieldId);
  if (!sheet.columnBindings || column < 0 || column >= sheet.width) throw new Error('SPREADSHEET_COLUMN_BINDING_UNAVAILABLE');
  return { ...sheet, columnBindings: sheet.columnBindings.map((binding, index) => index === column ? { ...binding, fieldId, basis: fieldId === null ? 'unmapped' : 'manual' } : binding) };
}
export function spreadsheetColumnValueErrors(sheet: EditableSheet, column: number): number {
  const binding = sheet.columnBindings?.[column];
  if (!binding?.fieldId) return 0;
  return sheet.rows.slice(spreadsheetHeaderRow(sheet)).filter(row => !spreadsheetValueMatches(binding.fieldId!, cellText(row.cells[column]))).length;
}
export function spreadsheetColumnErrors(document: EditableWorkbook): readonly string[] {
  const errors: string[] = [];
  let selected = 0;
  for (const sheet of document.sheets) {
    spreadsheetHeaderRow(sheet);
    const fields = new Set<string>(), hidden = new Set(sheet.hidden);
    for (let column = 0; column < sheet.width; column++) {
      if (hidden.has(column)) continue;
      selected++;
      const binding = sheet.columnBindings?.[column];
      if (!binding?.fieldId) continue;
      const field = spreadsheetField(binding.fieldId);
      if (fields.has(field.id)) errors.push(`${sheet.name}: ${field.label} is mapped more than once.`);
      fields.add(field.id);
    }
  }
  if (!selected) errors.push('Select at least one column to import.');
  return errors;
}
export function spreadsheetColumnValueIssues(document: EditableWorkbook): readonly string[] {
  return document.sheets.flatMap(sheet => sheet.columnBindings?.flatMap((binding, column) => {
    if (sheet.hidden.includes(column) || !binding.fieldId) return [];
    const field = spreadsheetField(binding.fieldId);
    return sheet.rows.slice(spreadsheetHeaderRow(sheet)).flatMap((row, index) => spreadsheetValueMatches(field.id, cellText(row.cells[column])) ? []
      : [`${sheet.name}, row ${(sheet.sourceHeaderRow ?? spreadsheetHeaderRow(sheet)) + index + 1}, column ${columnName(binding.sourceColumn ?? column)}: does not match ${field.label}.`]);
  }) ?? []);
}
export function selectSpreadsheetColumns(document: EditableWorkbook): EditableWorkbook {
  const errors = spreadsheetColumnErrors(document);
  if (errors.length) throw new Error(`SPREADSHEET_COLUMNS_INVALID: ${errors.join(' ')}`);
  return { ...document, sheets: document.sheets.flatMap(sheet => {
    const hidden = new Set(sheet.hidden);
    const selected = Array.from({ length: sheet.width }, (_, column) => column).filter(column => !hidden.has(column));
    if (!selected.length) return [];
    const header = spreadsheetHeaderRow(sheet);
    return [{ ...sheet, width: selected.length, hidden: [], headerRow: 1, sourceHeaderRow: sheet.sourceHeaderRow ?? header,
      columnBindings: selected.map(column => sheet.columnBindings![column]),
      rows: sheet.rows.slice(header - 1).map(row => ({ ...row, cells: selected.map(column => row.cells[column]) })),
    }];
  }) };
}
