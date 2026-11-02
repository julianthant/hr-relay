import type { Fill } from "exceljs";
import type { SaxesTagNS } from "saxes";
import { parse } from "csv-parse/browser/esm/sync";
import { ERROR_CATALOG } from "../failures/error-catalog.js";
import type { EditableWorkbook } from "./workbooks.js";
type SheetCell = EditableWorkbook["sheets"][number]["rows"][number]["cells"][number];
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
async function spreadsheetValueInput(data: ArrayBuffer): Promise<{ data: ArrayBuffer; dimensions: ReadonlyMap<string, { width: number; height: number }> }> {
  const [{ default: JSZip }, { SaxesParser }] = await Promise.all([import('jszip'), import('saxes')]);
  const archive = await JSZip.loadAsync(data);
  const mainNamespace = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const relationshipNamespace = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const sheets: { name: string; relationship: string }[] = [];
  const targets = new Map<string, string>();
  const dimensions = new Map<string, { width: number; height: number }>();
  const scan = async (path: string, onTag: (tag: SaxesTagNS) => void): Promise<void> => {
    const entry = archive.file(path);
    if (!entry) throw new Error(`SPREADSHEET_WORKSHEET_REFERENCE_INVALID: ${ERROR_CATALOG.SPREADSHEET_WORKSHEET_REFERENCE_INVALID.text}`);
    const parser = new SaxesParser({ xmlns: true });
    parser.on('opentag', onTag);
    parser.on('error', cause => { throw new Error(`SPREADSHEET_WORKBOOK_XML_INVALID: ${ERROR_CATALOG.SPREADSHEET_WORKBOOK_XML_INVALID.text}`, { cause }); });
    parser.write(await entry.async('string')).close();
  };
  await scan('xl/workbook.xml', tag => {
    if (tag.local !== 'sheet' || tag.uri !== mainNamespace) return;
    const name = tag.attributes.name?.value;
    const relationship = Object.values(tag.attributes).find(attribute => attribute.local === 'id' && attribute.uri === relationshipNamespace)?.value;
    if (!name || !relationship || sheets.some(sheet => sheet.name === name)) throw new Error(`SPREADSHEET_WORKSHEET_REFERENCE_INVALID: ${ERROR_CATALOG.SPREADSHEET_WORKSHEET_REFERENCE_INVALID.text}`);
    sheets.push({ name, relationship });
  });
  await scan('xl/_rels/workbook.xml.rels', tag => {
    if (tag.local !== 'Relationship' || tag.uri !== 'http://schemas.openxmlformats.org/package/2006/relationships' || tag.attributes.Type?.value !== `${relationshipNamespace}/worksheet`) return;
    const id = tag.attributes.Id?.value, target = tag.attributes.Target?.value;
    if (!id || !target || targets.has(id) || tag.attributes.TargetMode?.value === 'External'
      || /^[a-z][a-z\d+.-]*:/iu.test(target) || target.startsWith('//') || target.includes('\\')) throw new Error(`SPREADSHEET_WORKSHEET_REFERENCE_INVALID: ${ERROR_CATALOG.SPREADSHEET_WORKSHEET_REFERENCE_INVALID.text}`);
    let url: URL, path: string;
    try { url = new URL(target, 'https://relay.invalid/xl/workbook.xml'); path = decodeURIComponent(url.pathname).slice(1); }
    catch (cause) { throw new Error(`SPREADSHEET_WORKSHEET_REFERENCE_INVALID: ${ERROR_CATALOG.SPREADSHEET_WORKSHEET_REFERENCE_INVALID.text}`, { cause }); }
    if (url.origin !== 'https://relay.invalid' || url.search || url.hash || path.includes('\\')
      || path.split('/').some(part => !part || part === '.' || part === '..')) throw new Error(`SPREADSHEET_WORKSHEET_REFERENCE_INVALID: ${ERROR_CATALOG.SPREADSHEET_WORKSHEET_REFERENCE_INVALID.text}`);
    targets.set(id, path);
  });
  let declaredCells = 0;
  for (const sheet of sheets) {
    const target = targets.get(sheet.relationship);
    if (!target) throw new Error(`SPREADSHEET_WORKSHEET_REFERENCE_INVALID: ${ERROR_CATALOG.SPREADSHEET_WORKSHEET_REFERENCE_INVALID.text}`);
    await scan(target, tag => {
      if (tag.local !== 'dimension' || tag.uri !== mainNamespace) return;
      const match = /^\$?([A-Z]{1,3})\$?([1-9]\d*)(?::\$?([A-Z]{1,3})\$?([1-9]\d*))?$/iu.exec(tag.attributes.ref?.value ?? '');
      if (!match || dimensions.has(sheet.name)) throw new Error(`SPREADSHEET_DIMENSIONS_INVALID: ${ERROR_CATALOG.SPREADSHEET_DIMENSIONS_INVALID.text}`);
      const column = (letters: string) => [...letters.toUpperCase()].reduce((value, letter) => value * 26 + letter.charCodeAt(0) - 64, 0);
      const left = column(match[1]), top = Number(match[2]), width = column(match[3] ?? match[1]), height = Number(match[4] ?? match[2]);
      if (left > width || top > height || width > 16_384 || height > 1_048_576) throw new Error(`SPREADSHEET_DIMENSIONS_INVALID: ${ERROR_CATALOG.SPREADSHEET_DIMENSIONS_INVALID.text}`);
      dimensions.set(sheet.name, { width, height });
      declaredCells += width * height;
    });
  }
  if (declaredCells > MAX_CELLS) throw new Error('SPREADSHEET_SIZE_UNSUPPORTED: maximum workbook size is 100,000 cells.');
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
  return { data: changed ? await archive.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' }) : data, dimensions };
}
export async function importSpreadsheet(name: string, data: ArrayBuffer): Promise<EditableWorkbook> {
  if (data.byteLength > 20 * 1024 * 1024) throw new Error('SPREADSHEET_TOO_LARGE: maximum file size is 20 MB.');
  if (/\.csv$/i.test(name)) {
    const values = parse(new TextDecoder().decode(data), { bom: true, relax_column_count: true, skip_empty_lines: false });
    const width = values.reduce((max, row) => Math.max(max, row.length), 1);
    if (!values.length || values.length * width > MAX_CELLS) throw new Error('SPREADSHEET_SIZE_UNSUPPORTED: use a nonempty file with at most 100,000 cells.');
    return { name, themes: [], hasFormulas: false, sheets: [{ id: 'csv', name: 'Sheet 1', width, hidden: [], rows: values.map((row, index) => ({ id: `row-${index}`, sourceRow: index + 1, cells: Array.from({ length: width }, (_, column) => ({ value: row[column] ?? '' })) })) }] };
  }
  if (!/\.xlsx$/i.test(name)) throw new Error('SPREADSHEET_FORMAT_UNSUPPORTED: choose XLSX or CSV.');
  const Excel = (await import('exceljs')).default;
  const workbook = new Excel.Workbook();
  const input = await spreadsheetValueInput(data);
  await workbook.xlsx.load(input.data, { ignoreNodes: ['autoFilter'] });
  const themes = workbook.model.themes;
  let hasFormulas = false, total = 0;
  const sheets = workbook.worksheets.map(sheet => {
    const dimension = input.dimensions.get(sheet.name);
    const width = Math.max(1, sheet.columnCount, dimension?.width ?? 0), height = Math.max(1, sheet.rowCount, dimension?.height ?? 0);
    total += width * height;
    if (total > MAX_CELLS) throw new Error('SPREADSHEET_SIZE_UNSUPPORTED: maximum workbook size is 100,000 cells.');
    const rows = Array.from({ length: height }, (_, rowIndex) => ({ id: `${sheet.id}-${rowIndex}`, sourceRow: rowIndex + 1, cells: Array.from({ length: width }, (_, columnIndex): SheetCell => {
      const cell = sheet.getCell(rowIndex + 1, columnIndex + 1);
      let value = cell.value;
      const richText = value && typeof value === 'object' && 'richText' in value ? structuredClone(value.richText) : undefined;
      const link = value && typeof value === 'object' && 'hyperlink' in value ? value : undefined;
      if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
        if ('formula' in value || 'sharedFormula' in value) { hasFormulas = true; value = value.result ?? null; }
        else if ('richText' in value) value = value.richText.map(part => part.text).join('');
        else if ('text' in value) value = value.text;
        else if ('error' in value) value = value.error;
      }
      const fill = cell.fill ? structuredClone(cell.fill) : undefined;
      return { value: value as SheetCell['value'], fill, background: fillBackground(fill, themes), numFmt: cell.numFmt, ...(richText === undefined ? {} : { richText }), ...(link === undefined ? {} : { hyperlink: link.hyperlink, ...(link.tooltip === undefined ? {} : { tooltip: link.tooltip }) }) };
    }) }));
    return { id: String(sheet.id), name: sheet.name, rows, width, hidden: [] };
  });
  if (!sheets.length) throw new Error('SPREADSHEET_HAS_NO_SHEETS');
  return { name, sheets, themes, hasFormulas };
}
