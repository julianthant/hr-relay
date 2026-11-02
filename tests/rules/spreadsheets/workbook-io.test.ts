import { expect, it } from 'vitest';
import JSZip from 'jszip';
import { writeWorkbookXlsx, importWorkbook, writeWorkbookCsv, type EditableWorkbook } from '../../../src/rules/spreadsheets/workbook-io.js';
const workbook: EditableWorkbook = { name: 'Metadata.xlsx', themes: [], hasFormulas: false, sheets: [{ id: 'sheet', name: 'People', width: 3, hidden: [2], rows: [
  { id: 'one', cells: [{ value: 'Link', hyperlink: 'https://example.com/', tooltip: 'Open' }, { value: new Date('2026-01-01T00:00:00.000Z'), numFmt: 'yyyy-mm-dd' }, { value: '00123' }] },
  { id: 'two', cells: [{ value: 'Rich', richText: [{ text: 'Rich', font: { bold: true, color: { argb: 'FF123456' } } }] }, { value: 3, fill: { type: 'gradient', gradient: 'angle', degree: 45, stops: [{ position: 0, color: { argb: 'FFFFFFFF' } }, { position: 1, color: { argb: 'FF000000' } }] } }, { value: 'retained' }] },
] }] };
it('emits independent XLSX XML metadata, hidden intake columns and deterministic archive timestamps', async () => {
  const options = { columns: 'all', createdAt: '2026-11-02T00:00:00.000Z', modifiedAt: '2026-11-02T01:00:00.000Z' } as const;
  const first = await writeWorkbookXlsx(workbook, options), second = await writeWorkbookXlsx(workbook, options);
  expect(new Uint8Array(first)).toEqual(new Uint8Array(second));
  const archive = await JSZip.loadAsync(first), sheet = await archive.file('xl/worksheets/sheet1.xml')!.async('string');
  expect(sheet).toMatch(/hidden="1"/u); expect(sheet).toContain('tooltip="Open"');
  const styles = await archive.file('xl/styles.xml')!.async('string');
  expect(styles).toContain('gradientFill'); expect(styles).toContain('formatCode="yyyy-mm-dd"');
  const strings = await archive.file('xl/sharedStrings.xml')!.async('string');
  expect(strings).toContain('<b/>'); expect(strings).toContain('00123');
  expect((await archive.file('xl/worksheets/_rels/sheet1.xml.rels')!.async('string'))).toContain('https://example.com/');
  expect(Object.values(archive.files).every(entry => entry.date.toISOString() === options.modifiedAt)).toBe(true);
  const imported = await importWorkbook('read.xlsx', first);
  expect(imported.sheets[0].rows[0].cells[1].value).toEqual(new Date('2026-01-01T00:00:00.000Z'));
  expect(imported.sheets[0].rows[1].cells[0].richText).toEqual(workbook.sheets[0].rows[1].cells[0].richText);
  const visible = await importWorkbook('visible.xlsx', await writeWorkbookXlsx(workbook, { columns: 'visible' }));
  expect(visible.sheets[0].width).toBe(2); expect(writeWorkbookCsv(workbook.sheets[0])).not.toContain('00123');
});
it('marks prefixed worksheet metadata that the editable model cannot carry', async () => {
  const archive = await JSZip.loadAsync(await writeWorkbookXlsx(workbook));
  const entry = archive.file('xl/worksheets/sheet1.xml');
  expect(entry).toBeTruthy();
  archive.file('xl/worksheets/sheet1.xml', (await entry!.async('string')).replace('</worksheet>', '<x:mergeCells xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:mergeCell ref="A1:B1"/></x:mergeCells></worksheet>'));
  const imported = await importWorkbook('prefixed.xlsx', await archive.generateAsync({ type: 'arraybuffer' }));
  expect(imported.unsupportedMetadata).toBe(true);
});
it('marks prefixed core properties that an edited master would discard', async () => {
  const archive = await JSZip.loadAsync(await writeWorkbookXlsx(workbook));
  const entry = archive.file('docProps/core.xml');
  expect(entry).toBeTruthy();
  archive.file('docProps/core.xml', (await entry!.async('string')).replace('</cp:coreProperties>', '<meta:title xmlns:meta="http://purl.org/dc/elements/1.1/">Private title</meta:title></cp:coreProperties>'));
  const imported = await importWorkbook('core.xlsx', await archive.generateAsync({ type: 'arraybuffer' }));
  expect(imported.unsupportedMetadata).toBe(true);
});
it.each([
  ['foreign element', '<x:dimension xmlns:x="urn:foreign" ref="A1"/>'],
  ['foreign attribute', '<sheetViews xmlns:x="urn:foreign" x:retained="true"/>'],
])('marks worksheet metadata with a %s instead of ignoring its namespace', async (_, extra) => {
  const archive = await JSZip.loadAsync(await writeWorkbookXlsx({ ...workbook, sheets: [{ ...workbook.sheets[0], rows: [{ id: 'one', cells: [{ value: 'plain' }] }], width: 1, hidden: [] }] }));
  const entry = archive.file('xl/worksheets/sheet1.xml');
  expect(entry).toBeTruthy();
  archive.file('xl/worksheets/sheet1.xml', (await entry!.async('string')).replace('</worksheet>', `${extra}</worksheet>`));
  const imported = await importWorkbook('foreign.xlsx', await archive.generateAsync({ type: 'arraybuffer' }));
  expect(imported.unsupportedMetadata).toBe(true);
});
