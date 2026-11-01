import Excel_m1 from 'exceljs';
import { default as assert_m0,default as assert_m1,default as assert_m2,default as assert_m3 } from 'node:assert/strict';
import { readFileSync as readFileSync_m1 } from 'node:fs';
import { afterEach as afterEach_m2,describe as describe_m1,describe as describe_m2,it as it_m0,it as it_m1,it as it_m2,it as it_m3 } from 'vitest';
import { prepareSpreadsheetColumns as prepareSpreadsheetColumns_m2,selectSpreadsheetColumns as selectSpreadsheetColumns_m2,setSpreadsheetColumnField as setSpreadsheetColumnField_m2 } from '../../../../src/dashboard/surfaces/spreadsheets/spreadsheet-column-import-model.js';
import { addSpreadsheetColumn as addSpreadsheetColumn_m2,cellDisplayText as cellDisplayText_m0,cellText as cellText_m0,cellText as cellText_m1,editSpreadsheetCell as editSpreadsheetCell_m1,editSpreadsheetCell as editSpreadsheetCell_m2,importSpreadsheet as importSpreadsheet_m1,newEditableWorkbook as newEditableWorkbook_m1,newEditableWorkbook as newEditableWorkbook_m2,readSpreadsheetField as readSpreadsheetField_m2,sortSpreadsheet as sortSpreadsheet_m1,spreadsheetCellProblem as spreadsheetCellProblem_m2,spreadsheetColor as spreadsheetColor_m1,spreadsheetCsv as spreadsheetCsv_m1,spreadsheetForeground as spreadsheetForeground_m3,spreadsheetXlsx as spreadsheetXlsx_m1,updateSpreadsheetFields as updateSpreadsheetFields_m2,type EditableWorkbook as EditableWorkbook_m2 } from '../../../../src/dashboard/surfaces/spreadsheets/spreadsheet-editor-model.js';
import { registeredSpreadsheetWorkbook as registeredSpreadsheetWorkbook_m2,registerLocalSpreadsheet as registerLocalSpreadsheet_m2,resetSpreadsheetMocks as resetSpreadsheetMocks_m2,resetSpreadsheetMocks as resetSpreadsheetMocks_m3,retainSpreadsheetCopy as retainSpreadsheetCopy_m2,searchMockSpreadsheet as searchMockSpreadsheet_m2 } from '../../../../src/dashboard/surfaces/spreadsheets/spreadsheet-mock-model.js';


{

it_m0('formats typed spreadsheet dates while preserving raw and unmapped cell values', () => {
  const cell = { value: '2026-08-03' };
  assert_m0.equal(cellDisplayText_m0(cell, 'hireDate'), '08/03/2026');
  assert_m0.equal(cellDisplayText_m0(cell), '2026-08-03');
  assert_m0.equal(cellText_m0(cell), '2026-08-03');
  assert_m0.equal(cellDisplayText_m0({ value: new Date('2026-08-03T00:00:00Z') }), '08/03/2026');
});
}

{


function bytes(value: Uint8Array): ArrayBuffer { return new Uint8Array(value).buffer; }

describe_m1('XLSX / CSV editor round trips', () => {
  it_m1('copies only visible pooled bytes independently of surrounding storage', () => {
    const allocation = Buffer.allocUnsafe(32).fill(7);
    const visible = allocation.subarray(8, 12);
    const source = bytes(visible);
    assert_m1.equal(source.byteLength, 4);
    const original = new Uint8Array(source).slice();
    allocation[0] = 99;
    assert_m1.deepEqual([...visible], [7, 7, 7, 7]);
    assert_m1.deepEqual(new Uint8Array(source), original);
    visible[0] = 8;
    assert_m1.notDeepEqual([...visible], [...original]);
    assert_m1.deepEqual(new Uint8Array(source), original);
  });
  it_m1('imports color-filtered Excel tables with all records, fills and other sheets intact', async () => {
    const source = bytes(readFileSync_m1(new URL('../../../support/fixtures/spreadsheet/color-filtered-roster.xlsx', import.meta.url)));
    const original = new Uint8Array(source).slice();
    await assert_m1.rejects(new Excel_m1.Workbook().xlsx.load(source), /Unexpected xml node in parseOpen.*colorFilter/u);
    const document = await importSpreadsheet_m1('color-filtered-roster.xlsx', source);
    assert_m1.deepEqual(document.sheets.map(sheet => sheet.name), ['Roster', 'Notes']);
    const roster = document.sheets[0];
    assert_m1.deepEqual(roster.rows.map(row => row.cells.map(cell => cell.value)), [
      ['Legal Name', 'Employee ID', 'Personal Email'],
      ['Jordan Lee', '10000001', 'jordan@example.com'],
      ['Taylor Chen', '10000002', 'taylor@example.com'],
    ]);
    assert_m1.equal(roster.rows[1].cells[1].background, '#ffff00');
    assert_m1.equal(roster.rows[2].cells[1].background, '#00ff00');
    assert_m1.equal(document.sheets[1].rows[0].cells[0].value, 'Keep literal <autoFilter> text');
    assert_m1.deepEqual(new Uint8Array(source), original);
    const copy = await importSpreadsheet_m1('copy.xlsx', await spreadsheetXlsx_m1(document));
    assert_m1.deepEqual(copy.sheets, document.sheets);
  });
  it_m1('refuses malformed table XML rather than silently dropping invalid metadata', async () => {
    const { default: JSZip } = await import('jszip');
    const archive = await JSZip.loadAsync(readFileSync_m1(new URL('../../../support/fixtures/spreadsheet/color-filtered-roster.xlsx', import.meta.url)));
    const table = archive.file('xl/tables/table1.xml');
    assert_m1(table);
    archive.file(table.name, (await table.async('string')).replace('</autoFilter>', ''));
    const data = await archive.generateAsync({ type: 'arraybuffer' });
    await assert_m1.rejects(importSpreadsheet_m1('malformed.xlsx', data), /SPREADSHEET_TABLE_XML_INVALID/u);
  });
  it_m1('preserves CSV leading zeros, quoted commas, newlines and edited values', async () => {
    const source = 'Name,ID,Notes\r\n"Doe, Alex",00123,"Line one\nLine two"\r\nNguyen,00005,plain';
    const document = await importSpreadsheet_m1('people.csv', new TextEncoder().encode(source).buffer);
    assert_m1.equal(cellText_m1(document.sheets[0].rows[1].cells[1]), '00123');
    assert_m1.equal(spreadsheetCsv_m1(document.sheets[0]), source);
    const next = editSpreadsheetCell_m1(document.sheets[0], 'row-1', 2, 'New, "quoted" note');
    const copy = await importSpreadsheet_m1('copy.csv', new TextEncoder().encode(spreadsheetCsv_m1(next)).buffer);
    assert_m1.equal(copy.sheets[0].rows[1].cells[2].value, 'New, "quoted" note');
    assert_m1.equal(document.sheets[0].rows[1].cells[2].value, 'Line one\nLine two');
  });
  it_m1('retains RGB, theme and indexed fills after sort/edit/XLSX export, across sheets', async () => {
    const original = new Excel_m1.Workbook(), sheet = original.addWorksheet('People');
    sheet.addRows([['Name', 'ID', 'Notes'], ['Zoe', '00002', 'last'], ['Alex', '00001', 'first']]);
    sheet.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFB7D7F0' } };
    sheet.getCell('A2').fill = { type: 'pattern', pattern: 'solid', fgColor: { theme: 4, tint: 0.4 } as Partial<Excel_m1.Color> };
    sheet.getCell('A3').fill = { type: 'pattern', pattern: 'solid', fgColor: { indexed: 3 } as Partial<Excel_m1.Color> };
    original.addWorksheet('Other').getCell('B2').value = 'Keep';
    const source = bytes(await original.xlsx.writeBuffer() as unknown as Uint8Array);
    const document = await importSpreadsheet_m1('source.xlsx', source);
    assert_m1.equal(document.sheets[0].rows[0].cells[0].background, '#b7d7f0');
    assert_m1.equal(document.sheets[0].rows[2].cells[0].background, '#00ff00');
    const sorted = sortSpreadsheet_m1(document.sheets[0], 0, 'asc');
    assert_m1.equal(sorted.rows[0].cells[0].value, 'Name');
    assert_m1.equal(sorted.rows[1].cells[0].value, 'Alex');
    const next = editSpreadsheetCell_m1(sorted, sorted.rows[1].id, 0, 'Alex edited');
    const data = await spreadsheetXlsx_m1({ ...document, sheets: [next, document.sheets[1]] });
    const reloaded = await importSpreadsheet_m1('edited.xlsx', data);
    assert_m1.equal(reloaded.sheets.length, 2);
    assert_m1.equal(reloaded.sheets[0].rows[1].cells[0].value, 'Alex edited');
    assert_m1.deepEqual(reloaded.sheets[0].rows[1].cells[0].fill, document.sheets[0].rows[2].cells[0].fill);
    assert_m1.equal(reloaded.sheets[0].rows[2].cells[0].background, document.sheets[0].rows[1].cells[0].background);
    assert_m1.equal(reloaded.sheets[1].rows[1].cells[1].value, 'Keep');
    assert_m1.equal((await importSpreadsheet_m1('source.xlsx', source)).sheets[0].rows[1].cells[0].value, 'Zoe');
  });
  it_m1('exports selected columns while keeping every data row', async () => {
    const document = newEditableWorkbook_m1();
    const sheet = { ...document.sheets[0], hidden: [1] };
    assert_m1.equal(spreadsheetCsv_m1(sheet), 'Name,Notes\r\n,');
    const exported = await importSpreadsheet_m1('copy.xlsx', await spreadsheetXlsx_m1({ ...document, sheets: [sheet] }));
    assert_m1.equal(exported.sheets[0].width, 2); assert_m1.equal(exported.sheets[0].rows.length, 2);
  });
  it_m1('shows stored formula results and emits value copies, never formula recalculation', async () => {
    const original = new Excel_m1.Workbook(), sheet = original.addWorksheet('Values');
    sheet.getCell('A1').value = 'Total'; sheet.getCell('A2').value = { formula: '1+2', result: 3 };
    const document = await importSpreadsheet_m1('formula.xlsx', bytes(await original.xlsx.writeBuffer() as unknown as Uint8Array));
    assert_m1.equal(document.hasFormulas, true); assert_m1.equal(document.sheets[0].rows[1].cells[0].value, 3);
    const exported = await importSpreadsheet_m1('copy.xlsx', await spreadsheetXlsx_m1(document));
    assert_m1.equal(exported.hasFormulas, false); assert_m1.equal(exported.sheets[0].rows[1].cells[0].value, 3);
  });
  it_m1('refuses malformed files and unsupported colors explicitly', async () => {
    await assert_m1.rejects(importSpreadsheet_m1('bad.xlsx', new TextEncoder().encode('not a zip').buffer));
    await assert_m1.rejects(importSpreadsheet_m1('bad.txt', new ArrayBuffer(0)), /FORMAT_UNSUPPORTED/);
    assert_m1.throws(() => spreadsheetColor_m1({ theme: 100 }, []), /FILL_COLOR_UNSUPPORTED/);
  });
});
}

{

const _afterEachFixture0 = resetSpreadsheetMocks_m2;
const book = (values: readonly (readonly string[])[]): EditableWorkbook_m2 => ({ name: 'Fictional.csv', themes: [], hasFormulas: false, sheets: [{ id: 'sheet', name: 'Roster', width: values[0].length, hidden: [], rows: values.map((cells, i) => ({ id: `row-${i}`, cells: cells.map(value => ({ value })) })) }] });
describe_m2('typed spreadsheet field contract', () => {
afterEach_m2(_afterEachFixture0);

  it_m2('reads and updates by field regardless of header text, retaining cell formatting and atomic refusal', () => {
    const source = newEditableWorkbook_m2().sheets[0];
    const edited = editSpreadsheetCell_m2(source, 'header', 1, 'Custom header');
    const filled = { ...edited, rows: edited.rows.map(row => row.id === 'row-1' ? { ...row, cells: row.cells.map((cell, i) => i === 1 ? { ...cell, background: '#ff0000' } : cell) } : row) };
    const result = updateSpreadsheetFields_m2(filled, 'row-1', { eid: '10000001', 'roster.notes': 'Onboarding finished' });
    assert_m2.equal(readSpreadsheetField_m2(result, 'row-1', 'eid'), '10000001');
    assert_m2.equal(result.rows[0].cells[1].value, 'Custom header'); assert_m2.equal(result.rows[1].cells[1].background, '#ff0000');
    assert_m2.throws(() => updateSpreadsheetFields_m2(result, 'row-1', { 'roster.notes': 'changed', eid: 'invalid' }), /SPREADSHEET_FIELD_VALUE_INVALID/);
    assert_m2.equal(readSpreadsheetField_m2(result, 'row-1', 'roster.notes'), 'Onboarding finished');
    assert_m2.throws(() => readSpreadsheetField_m2(result, 'header', 'eid'), /SPREADSHEET_DATA_ROW_UNAVAILABLE/);
    assert_m2.throws(() => readSpreadsheetField_m2(result, 'row-1', 'personalEmail'), /SPREADSHEET_FIELD_BINDING_UNAVAILABLE/);
    const inserted = addSpreadsheetColumn_m2(result, 'Extra');
    assert_m2.equal(inserted.columnBindings!.length, inserted.width); assert_m2.equal(inserted.columnBindings!.at(-1)!.fieldId, null);
    assert_m2.notEqual(inserted.columnBindings!.at(-1)!.id, inserted.columnBindings![0].id);
  });
  it_m2('retains mappings and real imported search values under the same library identity', () => {
    const source = selectSpreadsheetColumns_m2(prepareSpreadsheetColumns_m2(book([['Legal Name', 'UCPath ID'], ['Jordan Lee', '10000001']])));
    const file = registerLocalSpreadsheet_m2(source);
    assert_m2.equal(searchMockSpreadsheet_m2(file, 'Roster', '10000001')[0]['Legal name'], 'Jordan Lee');
    const edited = { ...source, sheets: [editSpreadsheetCell_m2(source.sheets[0], 'row-1', 1, '10000002')] };
    retainSpreadsheetCopy_m2(file.id, edited);
    assert_m2.equal(registeredSpreadsheetWorkbook_m2(file).sheets[0].columnBindings![1].fieldId, 'eid');
    assert_m2.equal(searchMockSpreadsheet_m2(file, 'Roster', '10000002').length, 1);
    const remapped = { ...edited, sheets: [setSpreadsheetColumnField_m2(edited.sheets[0], 1, 'roster.notes')] };
    const updated = registerLocalSpreadsheet_m2(remapped, file.id);
    assert_m2.equal(updated.id, file.id); assert_m2.equal(updated.addedAt, file.addedAt);
    assert_m2.equal(updated.sheets[0].bindings![1].fieldId, 'roster.notes');
    assert_m2.throws(() => retainSpreadsheetCopy_m2('unknown', source), /SPREADSHEET_NOT_FOUND/);
  });
});

describe_m2('editor typed-cell problems', () => {
afterEach_m2(_afterEachFixture0);

  it_m2('names the bound field for a value import would refuse and stays silent otherwise', () => {
    const base = book([['Employee ID', 'Notes'], ['12345', 'x']]).sheets[0];
    const sheet = { ...base, columnBindings: [
      { id: 'eid', sourceColumn: 0, sourceHeader: 'Employee ID', fieldId: 'eid', basis: 'header' as const },
      { id: 'notes', sourceColumn: 1, sourceHeader: 'Notes', fieldId: null, basis: 'unmapped' as const },
    ] };
    assert_m2.equal(spreadsheetCellProblem_m2(sheet, 0, '12345'), 'Does not match Employee ID (8 digits, starting with 10).');
    assert_m2.equal(spreadsheetCellProblem_m2(sheet, 0, '10000001'), undefined);
    assert_m2.equal(spreadsheetCellProblem_m2(sheet, 0, ''), undefined);
    assert_m2.equal(spreadsheetCellProblem_m2(sheet, 1, 'anything'), undefined);
    assert_m2.equal(spreadsheetCellProblem_m2(base, 0, '12345'), undefined);
  });
});
}

{

const _afterEachFixture0 = resetSpreadsheetMocks_m3;

// Imported fills choose contrast independently of the dashboard theme.
it_m3("chooses readable imported-fill text at the exact luminance boundary", async () => {
try {


  for (const background of ["#000000", "#8b8b8b", "linear-gradient(#000000, #ffffff)", "#0000FF"]) {
    assert_m3.equal(spreadsheetForeground_m3(background), "var(--ds-sheet-contrast-light)", background);
  }
  for (const background of ["#ffffff", "#8c8c8c", "#FFFFFF", "#00ff00"]) {
    assert_m3.equal(spreadsheetForeground_m3(background), "var(--ds-sheet-contrast-dark)", background);
  }
  for (const background of [undefined, "transparent", "rgb(0, 0, 0)", "#000"]) assert_m3.equal(spreadsheetForeground_m3(background), undefined);

} finally {
_afterEachFixture0();
}
});
}
