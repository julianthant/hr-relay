import { displayExtractedDate, formatInstantDate } from "../../lib/date-format.js";
import type { Fill, Workbook } from 'exceljs';
import { parse } from 'csv-parse/browser/esm/sync';
import type { SpreadsheetColumnBinding } from './spreadsheet-fields-model.js';
import { spreadsheetField, spreadsheetValueMatches } from './spreadsheet-fields-model.js';

export type SheetCell = Readonly<{ value: string | number | boolean | Date | null; fill?: Fill; background?: string }>;
export type SheetRow = Readonly<{ id: string; cells: readonly SheetCell[] }>;
export type EditableSheet = Readonly<{ id: string; name: string; rows: readonly SheetRow[]; width: number; hidden: readonly number[]; headerRow?: number; sourceHeaderRow?: number; columnBindings?: readonly SpreadsheetColumnBinding[] }>;
export type EditableWorkbook = Readonly<{ name: string; libraryId?: string; sheets: readonly EditableSheet[]; themes: Workbook['model']['themes']; hasFormulas: boolean }>;
const MAX_CELLS = 100_000;
const indexedColors = ['000000','FFFFFF','FF0000','00FF00','0000FF','FFFF00','FF00FF','00FFFF','000000','FFFFFF','FF0000','00FF00','0000FF','FFFF00','FF00FF','00FFFF','800000','008000','000080','808000','800080','008080','C0C0C0','808080','9999FF','993366','FFFFCC','CCFFFF','660066','FF8080','0066CC','CCCCFF','000080','FF00FF','FFFF00','00FFFF','800080','800000','008080','0000FF','00CCFF','CCFFFF','CCFFCC','FFFF99','99CCFF','FF99CC','CC99FF','FFCC99','3366FF','33CCCC','99CC00','FFCC00','FF9900','FF6600','666699','969696','003366','339966','003300','333300','993300','993366','333399','333333'];
const themeKeys = ['lt1','dk1','lt2','dk2','accent1','accent2','accent3','accent4','accent5','accent6','hlink','folHlink'];

type Color = { argb?: string; theme?: number; indexed?: number; tint?: number };
function themePalette(themes: EditableWorkbook['themes']): readonly string[] {
  const xml = Object.values(themes).find(value => typeof value === 'string' && value.includes('clrScheme'));
  if (!xml) return [];
  return themeKeys.map(key => {
    const block = new RegExp(`<a:${key}\\b[^>]*>([\\s\\S]*?)</a:${key}>`).exec(xml)?.[1];
    return block?.match(/(?:lastClr|val)="([0-9a-fA-F]{6})"/)?.[1] ?? '';
  });
}
export function spreadsheetColor(color: Color | undefined, themes: EditableWorkbook['themes']): string | undefined {
  if (!color || color.indexed === 64 || color.indexed === 65) return undefined;
  const source = color.argb?.slice(-6) ?? (color.theme !== undefined ? themePalette(themes)[color.theme] : color.indexed !== undefined ? indexedColors[color.indexed] : undefined);
  if (!source || !/^[0-9a-f]{6}$/i.test(source)) throw new Error('SPREADSHEET_FILL_COLOR_UNSUPPORTED');
  const tint = color.tint ?? 0;
  if (tint < -1 || tint > 1) throw new Error('SPREADSHEET_FILL_TINT_INVALID');
  const rgb = [0, 2, 4].map(index => parseInt(source.slice(index, index + 2), 16));
  // Excel tint adjusts HSL luminance, preserving hue and saturation.
  const [r, g, b] = rgb.map(value => value / 255) as [number, number, number];
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
  const lum = (max + min) / 2;
  const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lum - 1));
  let hue = delta === 0 ? 0 : max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  hue = (hue + 6) % 6;
  const nextLum = tint < 0 ? lum * (1 + tint) : lum * (1 - tint) + tint;
  const c = (1 - Math.abs(2 * nextLum - 1)) * saturation, x = c * (1 - Math.abs(hue % 2 - 1)), m = nextLum - c / 2;
  const channels = hue < 1 ? [c,x,0] : hue < 2 ? [x,c,0] : hue < 3 ? [0,c,x] : hue < 4 ? [0,x,c] : hue < 5 ? [x,0,c] : [c,0,x];
  return `#${channels.map(value => Math.round((value + m) * 255).toString(16).padStart(2, '0')).join('')}`;
}
function fillBackground(fill: Fill | undefined, themes: EditableWorkbook['themes']): string | undefined {
  if (!fill) return undefined;
  if (fill.type === 'pattern') {
    if (fill.pattern === 'none' || fill.pattern === 'gray125') return undefined;
    const fg = spreadsheetColor(fill.fgColor, themes), bg = spreadsheetColor(fill.bgColor, themes);
    if (fill.pattern === 'solid') return fg ?? bg;
    return fg && bg ? `repeating-linear-gradient(45deg, ${fg} 0 1px, ${bg} 1px 4px)` : fg ?? bg;
  }
  const stops = fill.stops.map(stop => `${spreadsheetColor(stop.color, themes)} ${stop.position * 100}%`);
  return fill.gradient === 'angle' ? `linear-gradient(${fill.degree + 90}deg, ${stops.join(',')})` : `radial-gradient(${stops.join(',')})`;
}
export function spreadsheetForeground(background: string | undefined): string | undefined {
  const hex = background?.match(/#[0-9a-f]{6}/i)?.[0];
  if (!hex) return undefined;
  const [r, g, b] = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 140 ? 'var(--ds-sheet-contrast-light)' : 'var(--ds-sheet-contrast-dark)';
}
export function cellText(cell: SheetCell): string {
  return cell.value instanceof Date ? cell.value.toISOString().slice(0, 10) : cell.value === null ? '' : String(cell.value);
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
    columnBindings: sheet.columnBindings ? [...sheet.columnBindings, { id: crypto.randomUUID(), sourceColumn: null, sourceHeader: title.trim(), fieldId: null, basis: 'unmapped' }] : undefined,
    rows: sheet.rows.map((row, index) => ({ ...row, cells: [...row.cells, { value: index === 0 ? title.trim() : '' }] })),
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
export function updateSpreadsheetFields(sheet: EditableSheet, rowId: string, values: Readonly<Record<string, SheetCell['value']>>): EditableSheet {
  spreadsheetDataRow(sheet, rowId);
  const updates = Object.entries(values).map(([fieldId, value]) => {
    const column = spreadsheetFieldColumn(sheet, fieldId);
    if (!spreadsheetValueMatches(fieldId, cellText({ value }))) throw new Error('SPREADSHEET_FIELD_VALUE_INVALID');
    return { column, value };
  });
  return { ...sheet, rows: sheet.rows.map(row => row.id !== rowId ? row : { ...row, cells: row.cells.map((cell, column) => {
    const update = updates.find(entry => entry.column === column);
    return update ? { ...cell, value: update.value } : cell;
  }) }) };
}
/** Imports retain all records; Excel's table filter rules are presentation metadata. */
async function spreadsheetValueInput(data: ArrayBuffer): Promise<ArrayBuffer> {
  const [{ default: JSZip }, { SaxesParser }] = await Promise.all([import('jszip'), import('saxes')]);
  const archive = await JSZip.loadAsync(data);
  let changed = false;
  for (const entry of Object.values(archive.files).filter(file => /^xl\/tables\/[^/]+\.xml$/u.test(file.name))) {
    const xml = await entry.async('string');
    const ranges: { start: number; end: number }[] = [];
    const parser = new SaxesParser({ xmlns: true });
    let depth = 0, tagStart = 0, filterStart = 0;
    let filterDepth: number | undefined;
    parser.on('opentagstart', () => { tagStart = xml.lastIndexOf('<', parser.position - 1); });
    parser.on('opentag', tag => {
      depth++;
      if (depth === 2 && tag.local === 'autoFilter' && tag.uri === 'http://schemas.openxmlformats.org/spreadsheetml/2006/main') {
        filterStart = tagStart;
        filterDepth = depth;
      }
    });
    parser.on('closetag', () => {
      if (depth === filterDepth) {
        ranges.push({ start: filterStart, end: parser.position });
        filterDepth = undefined;
      }
      depth--;
    });
    try { parser.write(xml).close(); }
    catch (cause) { throw new Error('SPREADSHEET_TABLE_XML_INVALID', { cause }); }
    if (!ranges.length) continue;
    let cursor = 0;
    const retained = ranges.map(range => {
      const content = xml.slice(cursor, range.start);
      cursor = range.end;
      return content;
    }).join('') + xml.slice(cursor);
    archive.file(entry.name, retained);
    changed = true;
  }
  return changed ? archive.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' }) : data;
}
export async function importSpreadsheet(name: string, data: ArrayBuffer): Promise<EditableWorkbook> {
  if (data.byteLength > 20 * 1024 * 1024) throw new Error('SPREADSHEET_TOO_LARGE: maximum file size is 20 MB.');
  if (/\.csv$/i.test(name)) {
    const values = parse(new TextDecoder().decode(data), { bom: true, relax_column_count: true, skip_empty_lines: false });
    const width = values.reduce((max, row) => Math.max(max, row.length), 1);
    if (!values.length || values.length * width > MAX_CELLS) throw new Error('SPREADSHEET_SIZE_UNSUPPORTED: use a nonempty file with at most 100,000 cells.');
    return { name, themes: [], hasFormulas: false, sheets: [{ id: 'csv', name: 'Sheet 1', width, hidden: [], rows: values.map((row, index) => ({ id: `row-${index}`, cells: Array.from({ length: width }, (_, column) => ({ value: row[column] ?? '' })) })) }] };
  }
  if (!/\.xlsx$/i.test(name)) throw new Error('SPREADSHEET_FORMAT_UNSUPPORTED: choose XLSX or CSV.');
  const Excel = (await import('exceljs')).default;
  const workbook = new Excel.Workbook();
  await workbook.xlsx.load(await spreadsheetValueInput(data), { ignoreNodes: ['autoFilter'] });
  const themes = workbook.model.themes;
  let hasFormulas = false, total = 0;
  const sheets = workbook.worksheets.map(sheet => {
    const width = Math.max(1, sheet.columnCount), height = Math.max(1, sheet.rowCount);
    total += width * height;
    if (total > MAX_CELLS) throw new Error('SPREADSHEET_SIZE_UNSUPPORTED: maximum workbook size is 100,000 cells.');
    const rows = Array.from({ length: height }, (_, rowIndex) => ({ id: `${sheet.id}-${rowIndex}`, cells: Array.from({ length: width }, (_, columnIndex): SheetCell => {
      const cell = sheet.getCell(rowIndex + 1, columnIndex + 1);
      let value = cell.value;
      if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
        if ('formula' in value || 'sharedFormula' in value) { hasFormulas = true; value = value.result ?? null; }
        else if ('richText' in value) value = value.richText.map(part => part.text).join('');
        else if ('text' in value) value = value.text;
        else if ('error' in value) value = value.error;
      }
      const fill = cell.fill ? structuredClone(cell.fill) : undefined;
      return { value: value as SheetCell['value'], fill, background: fillBackground(fill, themes) };
    }) }));
    return { id: String(sheet.id), name: sheet.name, rows, width, hidden: [] };
  });
  if (!sheets.length) throw new Error('SPREADSHEET_HAS_NO_SHEETS');
  return { name, sheets, themes, hasFormulas };
}
export function editSpreadsheetCell(sheet: EditableSheet, rowId: string, column: number, value: string): EditableSheet {
  if (!sheet.rows.some(row => row.id === rowId) || column < 0 || column >= sheet.width) throw new Error('SPREADSHEET_CELL_UNAVAILABLE');
  return { ...sheet, rows: sheet.rows.map(row => row.id !== rowId ? row : { ...row, cells: row.cells.map((cell, index) => index === column ? { ...cell, value } : cell) }) };
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
export function spreadsheetCsv(sheet: EditableSheet): string {
  return sheet.rows.map(row => row.cells.filter((_, index) => !sheet.hidden.includes(index)).map(cell => {
    const text = cellText(cell);
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  }).join(',')).join('\r\n');
}
export async function spreadsheetXlsx(document: EditableWorkbook): Promise<ArrayBuffer> {
  const Excel = (await import('exceljs')).default;
  const workbook = new Excel.Workbook();
  for (const sheet of document.sheets) {
    const target = workbook.addWorksheet(sheet.name);
    sheet.rows.forEach((row, index) => {
      let column = 1;
      row.cells.forEach((cell, source) => {
        if (sheet.hidden.includes(source)) return;
        const next = target.getCell(index + 1, column++);
        next.value = cell.value;
        if (cell.fill) next.fill = structuredClone(cell.fill);
      });
    });
  }
  const model = workbook.model;
  workbook.model = { ...model, themes: document.themes };
  const buffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buffer as unknown as Uint8Array).slice().buffer;
}
export function downloadSpreadsheet(data: ArrayBuffer | string, name: string, format: 'csv' | 'xlsx'): void {
  const blob = new Blob([data], { type: format === 'csv' ? 'text/csv;charset=utf-8' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = `${name.replace(/\.(xlsx|csv)$/i, '')}-edited.${format}`;
  document.body.append(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** A typed data cell that its column's field would refuse on import; typing remains a draft. */
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
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every(key => Object.hasOwn(right, key) && sameSpreadsheetValue(Reflect.get(left, key), Reflect.get(right, key)));
}

export function spreadsheetSaveMatches(draft: EditableWorkbook, result: SpreadsheetSaveResult): result is Extract<SpreadsheetSaveResult, { state: 'confirmed' }> {
  return result.state === 'confirmed' && Number.isSafeInteger(result.version) && result.version > 0
    && sameSpreadsheetValue(result.readback, draft);
}
