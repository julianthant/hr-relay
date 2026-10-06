import { cellText, columnName, type EditableWorkbook } from './spreadsheet-editor-model.js';

export function prepareSpreadsheetColumns(document: EditableWorkbook): EditableWorkbook {
  return { ...document, sheets: document.sheets.map(sheet => ({ ...sheet, hidden: [], rows: sheet.rows.map((row, index) => index ? row : {
    ...row, cells: row.cells.map((cell, column) => ({ ...cell, value: cellText(cell).trim() || `Column ${columnName(column)}` })),
  }) })) };
}

export function spreadsheetColumnErrors(document: EditableWorkbook): readonly string[] {
  const errors: string[] = [];
  let selected = 0;
  for (const sheet of document.sheets) {
    const labels = new Set<string>();
    const hidden = new Set(sheet.hidden);
    for (let column = 0; column < sheet.width; column++) {
      if (hidden.has(column)) continue;
      selected++;
      const label = cellText(sheet.rows[0].cells[column]).trim();
      if (!label) errors.push(`${sheet.name}: give column ${columnName(column)} a label.`);
      else if (labels.has(label.toLowerCase())) errors.push(`${sheet.name}: use a different label for column ${columnName(column)}.`);
      labels.add(label.toLowerCase());
    }
  }
  if (!selected) errors.push('Select at least one column to import.');
  return errors;
}

export function selectSpreadsheetColumns(document: EditableWorkbook): EditableWorkbook {
  const errors = spreadsheetColumnErrors(document);
  if (errors.length) throw new Error(`SPREADSHEET_COLUMNS_INVALID: ${errors.join(' ')}`);
  return { ...document, sheets: document.sheets.flatMap(sheet => {
    const hidden = new Set(sheet.hidden);
    const selected = Array.from({ length: sheet.width }, (_, column) => column).filter(column => !hidden.has(column));
    if (!selected.length) return [];
    return [{ ...sheet, width: selected.length, hidden: [], rows: sheet.rows.map((row, index) => ({ ...row,
      cells: selected.map(column => index ? row.cells[column] : { ...row.cells[column], value: cellText(row.cells[column]).trim() }),
    })) }];
  }) };
}
