import { expect, it } from 'vitest';
import JSZip from 'jszip';
import { Workbook, writeXlsx } from '@shbernal/ts-xlsx';
import { importWorkbook } from '../../../src/rules/spreadsheets/workbook-io.js';
import { decodeEditableWorkbook, encodeEditableWorkbook } from '../../../src/models/dashboard/workbooks.js';
import { xlsxWithInflatedWorkbookXml } from '../../support/helpers/spreadsheets/inflated-workbook.js';

async function xlsx(sheetData: string, dimension = 'A1:XFD1048576'): Promise<ArrayBuffer> {
  const book = new Workbook();
  book.addWorksheet('Synthetic');
  const archive = await JSZip.loadAsync(writeXlsx(book));
  archive.file('xl/worksheets/sheet1.xml', `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${dimension ? `<dimension ref="${dimension}"/>` : ''}<sheetData>${sheetData}</sheetData></worksheet>`);
  return archive.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' });
}
function populatedRows(count: number): string {
  return Array.from({ length: Math.ceil(count / 10) }, (_, row) => `<row r="${row + 1}">${Array.from({ length: Math.min(10, count - row * 10) }, (_, column) => `<c r="${String.fromCharCode(65 + column)}${row + 1}"><v>${row * 10 + column}</v></c>`).join('')}</row>`).join('');
}

it.each(['declared', 'formatted', 'without dimension'])('imports %s range padding without counting blank cells or changing source bytes', async mode => {
  const source = await xlsx('<row r="1"><c r="A1" t="inlineStr"><is><t>Header</t></is></c></row><row r="3"><c r="B3"><v>0</v></c></row>'
    + (mode === 'declared' ? '' : '<row r="1048576"><c r="XFD1048576" s="0"/></row>'), mode === 'without dimension' ? '' : undefined);
  const original = new Uint8Array(source).slice();
  const imported = await importWorkbook('padding.xlsx', source);
  const sheet = imported.sheets[0];
  expect(sheet.width).toBe(2);
  expect(sheet.rows).toHaveLength(3);
  expect(sheet.rows.map(row => row.sourceRow)).toEqual([1, 2, 3]);
  expect(sheet.rows.map(row => row.cells.map(cell => cell.value))).toEqual([['Header', null], [null, null], [null, 0]]);
  expect(imported.unsupportedMetadata).toBe(true);
  expect(new Uint8Array(source)).toEqual(original);
  expect(decodeEditableWorkbook(encodeEditableWorkbook(imported)).sheets).toEqual(imported.sheets);
});

it('keeps small selected blank grids', async () => {
  const imported = await importWorkbook('selected.xlsx', await xlsx('<row r="1"><c r="A1"><v>1</v></c></row>', 'A1:C4'));
  expect(imported.sheets[0].width).toBe(3);
  expect(imported.sheets[0].rows).toHaveLength(4);
});

it('ignores column-style ranges through XFD when sizing a sheet with merged headings', async () => {
  const archive = await JSZip.loadAsync(await xlsx('<row r="1"><c r="A1" t="inlineStr"><is><t>Synthetic heading</t></is></c></row><row r="17"><c r="AE17"><v>42</v></c></row>', 'A1:AE17'));
  const entry = archive.file('xl/worksheets/sheet1.xml')!;
  archive.file(entry.name, (await entry.async('string')).replace('<sheetData>', '<cols><col min="32" max="16384" style="0"/></cols><sheetData>')
    .replace('</worksheet>', '<mergeCells count="2"><mergeCell ref="A1:D1"/><mergeCell ref="E1:H1"/></mergeCells></worksheet>'));
  const imported = await importWorkbook('column-style.xlsx', await archive.generateAsync({ type: 'arraybuffer' }));
  expect(imported.sheets[0].width).toBe(31);
  expect(imported.sheets[0].rows).toHaveLength(17);
  expect(imported.sheets[0].rows[16].cells[30].value).toBe(42);
  expect(imported.unsupportedMetadata).toBe(true);
});

it('retains false, zero, rich text, errors and formulas without cached results at the last populated coordinates', async () => {
  const imported = await importWorkbook('values.xlsx', await xlsx('<row r="1"><c r="A1" t="b"><v>0</v></c><c r="B1"><v>0</v></c><c r="C1" t="inlineStr"><is><r><t>Text</t></r></is></c><c r="D1" t="e"><v>#N/A</v></c></row><row r="4"><c r="E4"><f>1+1</f></c></row>'));
  expect(imported.sheets[0].width).toBe(5);
  expect(imported.sheets[0].rows).toHaveLength(4);
  expect(imported.sheets[0].rows[0].cells.slice(0, 4).map(cell => cell.value)).toEqual([false, 0, 'Text', '#N/A']);
  expect(imported.sheets[0].rows[3].cells[4].value).toBeNull();
  expect(imported.hasFormulas).toBe(true);
  expect(imported.unsupportedMetadata).toBe(true);
});

it.each([99_999, 100_001, 250_000])('imports and encodes all %i populated cells', async count => {
  const imported = await importWorkbook('populated.xlsx', await xlsx(populatedRows(count), `A1:J${Math.ceil(count / 10)}`));
  expect(imported.sheets[0].rows.at(-1)?.cells[(count - 1) % 10].value).toBe(count - 1);
  expect(imported.sheets[0].rows.flatMap(row => row.cells).filter(cell => cell.value !== null)).toHaveLength(count);
  expect(encodeEditableWorkbook(imported).sheets[0].rows).toHaveLength(Math.ceil(count / 10));
});

it('rejects an oversized populated workbook with its exact count and limit', async () => {
  await expect(importWorkbook('too-many.xlsx', await xlsx(populatedRows(250_001), 'A1:J25001')))
    .rejects.toThrow(/250,001 populated cells.*250,000/su);
});

it('does not charge empty rich-text runs against the populated limit', async () => {
  const source = populatedRows(250_000) + '<row r="25001"><c r="A25001" t="inlineStr"><is><r><rPr><b/></rPr><t></t></r></is></c></row>';
  const imported = await importWorkbook('empty-rich-text.xlsx', await xlsx(source, 'A1:J25001'));
  expect(imported.sheets[0].rows[25000].cells[0].value).toBe('');
  expect(encodeEditableWorkbook(imported).sheets[0].rows).toHaveLength(25001);
});

it('counts CSV values rather than padded columns and retains empty internal positions', async () => {
  const csv = Array.from({ length: 1001 }, (_, row) => `${row},${','.repeat(99)}`).join('\n');
  const imported = await importWorkbook('sparse.csv', new TextEncoder().encode(csv).buffer);
  expect(imported.sheets[0].width).toBe(101);
  expect(imported.sheets[0].rows).toHaveLength(1001);
  expect(imported.sheets[0].rows[1000].cells[0].value).toBe('1000');
  expect(encodeEditableWorkbook(imported).sheets[0].rows).toHaveLength(1001);
});

it('counts every worksheet toward the populated limit', async () => {
  const book = new Workbook();
  book.addWorksheet('First'); book.addWorksheet('Second');
  const archive = await JSZip.loadAsync(writeXlsx(book));
  const source = await JSZip.loadAsync(await xlsx(populatedRows(125_001), 'A1:J12501'));
  const sheet = await source.file('xl/worksheets/sheet1.xml')!.async('string');
  archive.file('xl/worksheets/sheet1.xml', sheet);
  archive.file('xl/worksheets/sheet2.xml', sheet);
  await expect(importWorkbook('two-sheets.xlsx', await archive.generateAsync({ type: 'arraybuffer' })))
    .rejects.toThrow(/250,002 populated cells.*250,000/su);
});

it('reports CSV populated counts and limits without truncating the file', async () => {
  const csv = Array.from({ length: 250_001 }, () => 'value').join(',');
  await expect(importWorkbook('too-many.csv', new TextEncoder().encode(csv).buffer))
    .rejects.toThrow(/250,001 populated cells.*250,000/su);
});

it('refuses a distant populated cell rather than deleting it or allocating an enormous grid', async () => {
  await expect(importWorkbook('distant.xlsx', await xlsx('<row r="1"><c r="A1"><v>1</v></c></row><row r="20000"><c r="Z20000"><v>2</v></c></row>')))
    .rejects.toThrow(/2 populated cells.*250,000.*520,000.*500,000/su);
});

it('still refuses invalid declared dimensions', async () => {
  await expect(importWorkbook('invalid.xlsx', await xlsx('<row r="1"><c r="A1"><v>1</v></c></row>', 'XFE1')))
    .rejects.toThrow('SPREADSHEET_DIMENSIONS_INVALID');
});

it('refuses an xlsx whose workbook XML inflates past the limit when the zip header declares a tiny size', async () => {
  const inflated = await xlsxWithInflatedWorkbookXml(232 * 1024 * 1024, 64);
  await expect(importWorkbook('inflated.xlsx', inflated))
    .rejects.toThrow('SPREADSHEET_TOO_LARGE: maximum file size is 20 MB.');
});
