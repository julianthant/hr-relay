import { readXlsx, writeXlsx, Workbook, type Fill } from '@shbernal/ts-xlsx';
import type { SaxesTagNS } from 'saxes';
import { parse } from 'csv-parse/browser/esm/sync';
import { ERROR_CATALOG } from '../../models/failures/error-catalog.js';
import type { EditableWorkbook as LibraryWorkbook } from '../../models/dashboard/workbooks.js';
import { assertSpreadsheetWithinInflateLimit, SpreadsheetInflateLimitError } from './spreadsheet-inflate-limit.js';
import { MAX_WORKBOOK_GRID_CELLS, MAX_WORKBOOK_POPULATED_CELLS, populatedSpreadsheetValue, workbookSizeIssue } from './workbook-size.js';
export type SheetCell = Readonly<{ value: string | number | boolean | Date | null; fill?: LibraryWorkbook['sheets'][number]['rows'][number]['cells'][number]['fill']; background?: string; numFmt?: string; richText?: LibraryWorkbook['sheets'][number]['rows'][number]['cells'][number]['richText']; hyperlink?: string; tooltip?: string }>;
export type SheetRow = Readonly<{ id: string; sourceRow?: number; cells: readonly SheetCell[] }>;
export type EditableSheet = Readonly<{ id: string; name: string; rows: readonly SheetRow[]; width: number; hidden: readonly number[]; headerRow?: number; sourceHeaderRow?: number; columnBindings?: ReadonlyArray<NonNullable<LibraryWorkbook['sheets'][number]['columnBindings']>[number]> }>;
export type EditableWorkbook = Readonly<{ name: string; libraryId?: string; sheets: readonly EditableSheet[]; themes: LibraryWorkbook['themes']; hasFormulas: boolean; unsupportedMetadata?: boolean }>;
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
function fillBackground(fill: SheetCell['fill'], themes: EditableWorkbook['themes']): string | undefined {
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
function fromLibraryFill(fill: Fill | undefined): SheetCell['fill'] {
  if (!fill) return undefined;
  if (fill.type === 'pattern') {
    const { bgColor, ...pattern } = structuredClone(fill);
    return pattern.pattern === 'solid' && bgColor?.indexed === 64 && Object.keys(bgColor).length === 1
      ? pattern : { ...pattern, ...(bgColor === undefined ? {} : { bgColor }) };
  }
  return fill.gradient === 'linear'
    ? { type: 'gradient', gradient: 'angle', degree: fill.degree ?? 0, stops: fill.stops.map(stop => structuredClone(stop)) }
    : { type: 'gradient', gradient: 'path', center: { left: fill.left ?? 0, top: fill.top ?? 0 }, stops: fill.stops.map(stop => structuredClone(stop)) };
}
function toLibraryFill(fill: NonNullable<SheetCell['fill']>): Fill {
  if (fill.type === 'pattern') return structuredClone(fill);
  return fill.gradient === 'angle'
    ? { type: 'gradient', gradient: 'linear', degree: fill.degree, stops: structuredClone(fill.stops) }
    : { type: 'gradient', gradient: 'path', left: fill.center.left, top: fill.center.top, stops: structuredClone(fill.stops) };
}
function defaultCellFont(font: unknown): boolean {
  if (font === undefined) return true;
  if (!font || typeof font !== 'object') return false;
  const value = font as Record<string, unknown>;
  return Object.keys(value).every(key => ['name', 'size', 'family', 'scheme', 'color'].includes(key))
    && value.name === 'Calibri' && value.size === 11 && value.family === 2 && value.scheme === 'minor'
    && value.color !== null && typeof value.color === 'object'
    && Object.keys(value.color).length === 1 && (value.color as Record<string, unknown>).theme === 1;
}
export function cellText(cell: SheetCell): string {
  return cell.value instanceof Date ? cell.value.toISOString().slice(0, 10) : cell.value === null ? '' : String(cell.value);
}
/** Imports retain all records; Excel's table filter rules are presentation metadata. */
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
    });
  }
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
async function hasUnsupportedMetadata(data: ArrayBuffer): Promise<boolean> {
  const [{ default: JSZip }, { SaxesParser }] = await Promise.all([import('jszip'), import('saxes')]);
  const archive = await JSZip.loadAsync(data);
  const supportedPart = /^(?:\[Content_Types\]\.xml|_rels\/\.rels|docProps\/(?:app|core)\.xml|xl\/(?:workbook\.xml|_rels\/workbook\.xml\.rels|styles\.xml|sharedStrings\.xml|theme\/theme1\.xml|worksheets\/sheet\d+\.xml|worksheets\/_rels\/sheet\d+\.xml\.rels|tables\/table\d+\.xml))$/u;
  const unsupportedParts = Object.values(archive.files).some(entry => !entry.dir && !supportedPart.test(entry.name));
  if (unsupportedParts) return true;
  const workbookElements = new Set(['workbook', 'bookViews', 'workbookView', 'sheets', 'sheet']);
  const defaultWorkbookView: Readonly<Record<string, string>> = { activeTab: '0', xWindow: '-110', yWindow: '-110', windowWidth: '19420', windowHeight: '12220' };
  const sheetElements = new Set(['worksheet', 'dimension', 'sheetViews', 'sheetView', 'sheetFormatPr', 'cols', 'col', 'sheetData', 'row', 'c', 'v', 'is', 't', 'r', 'rPr', 'rFont', 'b', 'i', 'u', 'strike', 'sz', 'color', 'family', 'scheme', 'vertAlign', 'charset', 'f', 'hyperlinks', 'hyperlink']);
  const styleElements = new Set(['styleSheet', 'numFmts', 'numFmt', 'fonts', 'font', 'sz', 'color', 'name', 'family', 'scheme', 'b', 'i', 'u', 'strike', 'vertAlign', 'charset', 'fills', 'fill', 'patternFill', 'fgColor', 'bgColor', 'gradientFill', 'stop', 'borders', 'border', 'left', 'right', 'top', 'bottom', 'diagonal', 'cellStyleXfs', 'xf', 'cellXfs', 'cellStyles', 'cellStyle', 'dxfs']);
  const stringElements = new Set(['sst', 'si', 't', 'r', 'rPr', 'rFont', 'b', 'i', 'u', 'strike', 'sz', 'color', 'family', 'scheme', 'vertAlign', 'charset']);
  const elementAttributes: Record<string, readonly string[]> = {
    workbookView: ['activeTab', 'xWindow', 'yWindow', 'windowWidth', 'windowHeight'], sheet: ['name', 'sheetId'], dimension: ['ref'],
    sheetView: ['workbookViewId', 'tabSelected'], sheetFormatPr: ['defaultRowHeight'],
    col: ['min', 'max', 'hidden'], row: ['r', 'spans'], c: ['r', 's', 't'],
    hyperlink: ['ref', 'location', 'tooltip'], sst: ['count', 'uniqueCount'],
    numFmts: ['count'], numFmt: ['numFmtId', 'formatCode'], fonts: ['count'],
    sz: ['val'], color: ['rgb', 'theme', 'indexed', 'tint'], name: ['val'], rFont: ['val'],
    family: ['val'], scheme: ['val'], b: ['val'], i: ['val'], u: ['val'], strike: ['val'],
    vertAlign: ['val'], charset: ['val'], fills: ['count'], patternFill: ['patternType'],
    fgColor: ['rgb', 'theme', 'indexed', 'tint'], bgColor: ['rgb', 'theme', 'indexed', 'tint'],
    gradientFill: ['type', 'degree', 'left', 'right', 'top', 'bottom'], stop: ['position'],
    borders: ['count'], cellStyleXfs: ['count'], cellXfs: ['count'],
    xf: ['numFmtId', 'fontId', 'fillId', 'borderId', 'xfId', 'quotePrefix', 'applyNumberFormat', 'applyFont', 'applyFill', 'applyBorder'],
    cellStyles: ['count'], cellStyle: ['name', 'xfId', 'builtinId'], dxfs: ['count'],
  };
  for (const entry of Object.values(archive.files)) {
    const isWorkbook = entry.name === 'xl/workbook.xml';
    const isSheet = /^xl\/worksheets\/sheet\d+\.xml$/u.test(entry.name);
    const isStyles = entry.name === 'xl/styles.xml', isStrings = entry.name === 'xl/sharedStrings.xml';
    const isCore = entry.name === 'docProps/core.xml', isApp = entry.name === 'docProps/app.xml';
    if (!isWorkbook && !isSheet && !isStyles && !isStrings && !isCore && !isApp) continue;
    let unsupported = false;
    let fontOpen = false;
    const fontParts: string[] = [];
    const parents: string[] = [];
    let propertyText = '';
    const parser = new SaxesParser({ xmlns: true });
    parser.on('opentag', tag => {
      const parent = parents.at(-1);
      parents.push(tag.local);
      if (unsupported) return;
      const contentAttributes = Object.values(tag.attributes).filter(attribute => attribute.uri !== 'http://www.w3.org/2000/xmlns/');
      if (isCore) {
        const root = parent === undefined && tag.local === 'coreProperties' && tag.uri === 'http://schemas.openxmlformats.org/package/2006/metadata/core-properties';
        const stamp = parent === 'coreProperties' && parents.length === 2 && ['created', 'modified'].includes(tag.local) && tag.uri === 'http://purl.org/dc/terms/';
        if (!root && !stamp) unsupported = true;
        if (root && contentAttributes.length > 0) unsupported = true;
        if (stamp) {
          propertyText = '';
          if (contentAttributes.length !== 1 || contentAttributes[0].uri !== 'http://www.w3.org/2001/XMLSchema-instance' || contentAttributes[0].local !== 'type') unsupported = true;
          const [prefix, local] = (contentAttributes[0]?.value ?? '').split(':');
          if (local !== 'W3CDTF' || parser.resolve(prefix) !== 'http://purl.org/dc/terms/') unsupported = true;
        }
        return;
      }
      if (isApp) {
        if (tag.uri !== 'http://schemas.openxmlformats.org/officeDocument/2006/extended-properties'
          || !(parent === undefined && tag.local === 'Properties' || parent === 'Properties' && parents.length === 2 && tag.local === 'Application')
          || contentAttributes.length > 0) unsupported = true;
        return;
      }
      if (tag.uri !== 'http://schemas.openxmlformats.org/spreadsheetml/2006/main' || !(isWorkbook ? workbookElements : isSheet ? sheetElements : isStyles ? styleElements : stringElements).has(tag.local)) { unsupported = true; return; }
      if (contentAttributes.some(attribute => attribute.uri === ''
        ? !(elementAttributes[tag.local] ?? []).includes(attribute.local)
        : !(attribute.uri === 'http://schemas.openxmlformats.org/officeDocument/2006/relationships' && attribute.local === 'id' && ['sheet', 'hyperlink'].includes(tag.local))
          && !(attribute.uri === 'http://www.w3.org/XML/1998/namespace' && attribute.local === 'space' && tag.local === 't'))) unsupported = true;
      const attributes = Object.values(tag.attributes).filter(attribute => attribute.uri === '' || attribute.uri === 'http://schemas.openxmlformats.org/officeDocument/2006/relationships');
      const attribute = (name: string) => attributes.find(value => value.local === name)?.value;
      if (isStyles) {
        if (tag.local === 'font') fontOpen = true;
        else if (fontOpen) fontParts.push(`${tag.local}:${attribute('val') ?? attribute('theme') ?? ''}`);
        if (['fonts', 'borders', 'cellStyleXfs', 'cellStyles'].includes(tag.local) && Number(attribute('count')) > 1) unsupported = true;
        if (tag.local === 'dxfs' && Number(attribute('count')) !== 0) unsupported = true;
        if (tag.local === 'xf' && ((attribute('quotePrefix') !== undefined && attribute('quotePrefix') !== '0') || (attribute('xfId') !== undefined && attribute('xfId') !== '0'))) unsupported = true;
        if (tag.local === 'cellStyle' && (attribute('name') !== 'Normal' || attribute('xfId') !== '0' || attribute('builtinId') !== undefined && attribute('builtinId') !== '0')) unsupported = true;
        return;
      }
      if (isStrings) return;
      if (isWorkbook) {
        if (tag.local === 'workbookView' && attributes.some(value => value.value !== defaultWorkbookView[value.local])) unsupported = true;
        if (tag.local === 'sheet' && attributes.some(value => !['name', 'sheetId', 'id'].includes(value.local))) unsupported = true;
      } else {
        if (tag.local === 'sheetView' && attributes.some(value => !(value.local === 'workbookViewId' && value.value === '0') && !(value.local === 'tabSelected' && value.value === '1'))) unsupported = true;
        if (tag.local === 'sheetFormatPr' && attributes.some(value => value.local !== 'defaultRowHeight' || value.value !== '15')) unsupported = true;
        if (tag.local === 'col' && attributes.some(value => !['min', 'max', 'hidden'].includes(value.local))) unsupported = true;
        if (tag.local === 'row' && attributes.some(value => !['r', 'spans'].includes(value.local))) unsupported = true;
        if (tag.local === 'c' && attributes.some(value => !['r', 's', 't'].includes(value.local))) unsupported = true;
        if (tag.local === 'hyperlink' && (attribute('ref') === undefined || attribute('ref')!.includes(':') || attributes.some(value => !['ref', 'id', 'location', 'tooltip'].includes(value.local)))) unsupported = true;
      }
    });
    parser.on('text', text => { if (isCore && parents.length === 2) propertyText += text; });
    parser.on('closetag', tag => {
      if (isStyles && tag.local === 'font') fontOpen = false;
      if (isCore && ['created', 'modified'].includes(tag.local) && (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u.test(propertyText) || !Number.isFinite(Date.parse(propertyText)))) unsupported = true;
      parents.pop();
    });
    parser.write(await entry.async('string')).close();
    if (isStyles && fontParts.length > 0 && fontParts.slice().sort().join('|') !== ['sz:11', 'color:1', 'name:Calibri', 'family:2', 'scheme:minor'].sort().join('|')) unsupported = true;
    if (unsupported) return true;
  }
  return false;
}
export async function importWorkbook(name: string, data: ArrayBuffer): Promise<EditableWorkbook> {
  if (data.byteLength > 20 * 1024 * 1024) throw new Error('SPREADSHEET_TOO_LARGE: maximum file size is 20 MB.');
  if (/\.csv$/i.test(name)) {
    const values: string[][] = parse(new TextDecoder().decode(data), { bom: true, relax_column_count: true, skip_empty_lines: false });
    const width = values.reduce((max, row) => Math.max(max, row.length), 1);
    if (!values.length) throw new Error(`SPREADSHEET_SIZE_UNSUPPORTED: This file has 0 populated cells (limit ${MAX_WORKBOOK_POPULATED_CELLS.toLocaleString('en-US')}). Choose a nonempty CSV file and try again.`);
    const populatedCells = values.reduce((count, row) => count + row.filter(populatedSpreadsheetValue).length, 0);
    const issue = workbookSizeIssue(populatedCells, values.length * width);
    if (issue) throw new Error(`SPREADSHEET_SIZE_UNSUPPORTED: ${issue}`);
    return { name, themes: [], hasFormulas: false, sheets: [{ id: 'csv', name: 'Sheet 1', width, hidden: [], rows: values.map((row, index) => ({ id: `row-${index}`, sourceRow: index + 1, cells: Array.from({ length: width }, (_, column) => ({ value: row[column] ?? '' })) })) }] };
  }
  if (!/\.xlsx$/i.test(name)) throw new Error('SPREADSHEET_FORMAT_UNSUPPORTED: choose XLSX or CSV.');
  try {
    await assertSpreadsheetWithinInflateLimit(data);
  } catch (cause) {
    if (cause instanceof SpreadsheetInflateLimitError) throw new Error('SPREADSHEET_TOO_LARGE: maximum file size is 20 MB.', { cause });
    throw cause;
  }
  const input = await spreadsheetValueInput(data);
  const workbook = readXlsx(new Uint8Array(input.data));
  const themes: EditableWorkbook['themes'] = workbook.themePart?.parts.reduce<Record<string, string>>((parts, part) => {
    if (part.path.endsWith('.xml') && part.path.includes('/theme/')) parts[part.path.split('/').at(-1)!.replace('.xml', '')] = new TextDecoder().decode(part.bytes);
    return parts;
  }, {}) ?? {};
  let populatedCells = 0;
  const extents = workbook.worksheets.map(sheet => {
    const dimension = input.dimensions.get(sheet.name);
    let width = Math.max(1, dimension?.width ?? 0), valueWidth = 1, valueHeight = 1;
    const height = Math.max(1, sheet.rowCount, dimension?.height ?? 0);
    for (const row of sheet.rows()) for (const cell of row.cells) {
      width = Math.max(width, cell.col);
      const value = cell.value;
      const populated = value !== null && typeof value === 'object' && 'richText' in value
        ? value.richText.some(run => run.text !== '') : populatedSpreadsheetValue(value);
      if (!populated) continue;
      populatedCells++;
      valueWidth = Math.max(valueWidth, cell.col);
      valueHeight = Math.max(valueHeight, cell.row);
    }
    return { width, height, valueWidth, valueHeight };
  });
  const trimPadding = extents.reduce((count, size) => count + size.width * size.height, 0) > MAX_WORKBOOK_GRID_CELLS;
  const sizes = extents.map(size => trimPadding ? { width: size.valueWidth, height: size.valueHeight } : size);
  const issue = workbookSizeIssue(populatedCells, sizes.reduce((count, size) => count + size.width * size.height, 0));
  if (issue) throw new Error(`SPREADSHEET_SIZE_UNSUPPORTED: ${issue}`);
  let hasFormulas = false, unsupportedCellMetadata = sizes.some((size, index) => size.width !== extents[index].width || size.height !== extents[index].height || workbook.worksheets[index].columnCount > size.width);
  const sheets = workbook.worksheets.map((sheet, index) => {
    const { width, height } = sizes[index];
    const rows = Array.from({ length: height }, (_, rowIndex) => ({ id: `${sheet.id}-${rowIndex}`, sourceRow: rowIndex + 1, cells: Array.from({ length: width }, (_, columnIndex): SheetCell => {
      const cell = sheet.getRow(rowIndex + 1).getCell(columnIndex + 1);
      if (!defaultCellFont(cell.style.font) || (cell.style.border && Object.keys(cell.style.border).length > 0)
        || (cell.style.alignment && Object.keys(cell.style.alignment).length > 0)
        || (cell.style.protection && Object.keys(cell.style.protection).length > 0)
        || (cell.fill?.type === 'gradient' && cell.fill.gradient === 'path' && (cell.fill.right !== undefined || cell.fill.bottom !== undefined))) unsupportedCellMetadata = true;
      let value = cell.value;
      const richText = value && typeof value === 'object' && 'richText' in value ? value.richText.map(part => structuredClone(part)) : undefined;
      const link = sheet.hyperlinkAt(cell.address);
      if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
        if ('formula' in value || 'sharedFormula' in value || 'shareType' in value) { hasFormulas = true; value = value.result ?? null; }
      }
      if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
        if ('richText' in value) value = value.richText.map(part => part.text).join('');
        else if ('error' in value) { unsupportedCellMetadata = true; value = value.error; }
      }
      const fill = fromLibraryFill(cell.fill);
      return { value: value, fill, background: fillBackground(fill, themes), numFmt: cell.numFmt, ...(richText === undefined ? {} : { richText }), ...(link === undefined ? {} : { hyperlink: link.target, ...(link.tooltip === undefined ? {} : { tooltip: link.tooltip }) }) };
    }) }));
    return { id: String(sheet.id), name: sheet.name, rows, width, hidden: Array.from({ length: width }, (_, column) => column).filter(column => sheet.getColumn(column + 1).hidden) };
  });
  if (!sheets.length) throw new Error('SPREADSHEET_HAS_NO_SHEETS');
  return { name, sheets, themes, hasFormulas, ...(unsupportedCellMetadata || await hasUnsupportedMetadata(data) ? { unsupportedMetadata: true } : {}) };
}
export function writeWorkbookCsv(sheet: EditableSheet): string {
  return sheet.rows.map(row => row.cells.filter((_, index) => !sheet.hidden.includes(index)).map(cell => {
    const text = cellText(cell);
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  }).join(',')).join('\r\n');
}
export async function writeWorkbookXlsx(document: EditableWorkbook, options: Readonly<{ columns: 'visible' | 'all'; createdAt?: string; modifiedAt?: string }> = { columns: 'visible' }): Promise<ArrayBuffer> {
  const workbook = new Workbook();
  for (const sheet of document.sheets) {
    const target = workbook.addWorksheet(sheet.name);
    sheet.rows.forEach((row, index) => {
      let column = 1;
      row.cells.forEach((cell, source) => {
        if (options.columns === 'visible' && sheet.hidden.includes(source)) return;
        const next = target.getRow(index + 1).getCell(column++);
        next.value = cell.richText ? { richText: structuredClone(cell.richText) } : cell.value;
        if (cell.hyperlink !== undefined) target.addHyperlink({ ref: next.address, target: cell.hyperlink, ...(cell.tooltip === undefined ? {} : { tooltip: cell.tooltip }) });
        if (cell.numFmt !== undefined) next.numFmt = cell.numFmt;
        if (cell.fill) next.fill = toLibraryFill(cell.fill);
      });
    });
    if (options.columns === 'all') for (const column of sheet.hidden) target.getColumn(column + 1).hidden = true;
  }
  if (options.createdAt) workbook.properties.created = new Date(options.createdAt);
  if (options.modifiedAt) workbook.properties.modified = new Date(options.modifiedAt);
  const themeXml = Object.values(document.themes).find(value => typeof value === 'string' && value.includes('clrScheme'));
  const { default: JSZip } = await import('jszip');
  const archive = await JSZip.loadAsync(writeXlsx(workbook));
  for (const [index, sheet] of document.sheets.entries()) {
    const width = options.columns === 'all' ? sheet.width : Array.from({ length: sheet.width }, (_, column) => column).filter(column => !sheet.hidden.includes(column)).length;
    const path = `xl/worksheets/sheet${index + 1}.xml`;
    const entry = archive.file(path);
    if (!entry) throw new Error('SPREADSHEET_WORKSHEET_REFERENCE_INVALID');
    const end = workbook.worksheets[index].getRow(Math.max(1, sheet.rows.length)).getCell(Math.max(1, width)).address;
    const xml = await entry.async('string');
    if (!/<dimension ref="[^"]*"\/>/u.test(xml)) throw new Error('SPREADSHEET_DIMENSIONS_INVALID');
    // Blank trailing rows and columns are part of the operator's selected grid.
    archive.file(path, xml.replace(/<dimension ref="[^"]*"\/>/u, `<dimension ref="A1:${end}"/>`));
  }
  if (themeXml) archive.file('xl/theme/theme1.xml', themeXml);
  if (options.modifiedAt) for (const entry of Object.values(archive.files)) entry.date = new Date(options.modifiedAt);
  return archive.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' });
}
