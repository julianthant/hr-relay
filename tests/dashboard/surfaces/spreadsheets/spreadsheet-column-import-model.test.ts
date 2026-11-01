// @vitest-environment jsdom
import { default as assert_m0,default as assert_m1 } from 'node:assert/strict';
import { act as act_m0,createElement as createElement_m0,useRef as useRef_m0,useState as useState_m0 } from 'react';
import { createRoot as createRoot_m0,type Root as Root_m0 } from 'react-dom/client';
import { afterEach as afterEach_m0,afterEach as afterEach_m1,describe as describe_m0,describe as describe_m1,it as it_m0,it as it_m1 } from 'vitest';
import { prepareSpreadsheetColumns as prepareSpreadsheetColumns_m0,prepareSpreadsheetColumns as prepareSpreadsheetColumns_m1,selectSpreadsheetColumns as selectSpreadsheetColumns_m0,selectSpreadsheetColumns as selectSpreadsheetColumns_m1,setSpreadsheetColumnField as setSpreadsheetColumnField_m0,setSpreadsheetColumnField as setSpreadsheetColumnField_m1,setSpreadsheetHeaderRow as setSpreadsheetHeaderRow_m1,spreadsheetColumnErrors as spreadsheetColumnErrors_m0,spreadsheetColumnErrors as spreadsheetColumnErrors_m1,spreadsheetColumnValueIssues } from '../../../../src/dashboard/surfaces/spreadsheets/spreadsheet-column-import-model.js';
import { SpreadsheetColumnImport as SpreadsheetColumnImport_m0 } from '../../../../src/dashboard/surfaces/spreadsheets/spreadsheet-column-import.js';
import { newEditableWorkbook as newEditableWorkbook_m0,type EditableWorkbook as EditableWorkbook_m0,type EditableWorkbook as EditableWorkbook_m1 } from '../../../../src/dashboard/surfaces/spreadsheets/spreadsheet-editor-model.js';
import { registerLocalSpreadsheet as registerLocalSpreadsheet_m0,registeredSpreadsheetWorkbook as registeredSpreadsheetWorkbook_m0,resetSpreadsheetMocks as resetSpreadsheetMocks_m0,resetSpreadsheetMocks as resetSpreadsheetMocks_m1,searchMockSpreadsheet as searchMockSpreadsheet_m0 } from '../../../../src/dashboard/surfaces/spreadsheets/spreadsheet-mock-model.js';


{


Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
let root: Root_m0 | undefined;
const _afterEachFixture0 = async () => { await act_m0(async () => root?.unmount()); document.body.replaceChildren(); resetSpreadsheetMocks_m0(); };
const fixture = (): EditableWorkbook_m0 => {
  const book = newEditableWorkbook_m0();
  return { ...book, sheets: [{ ...book.sheets[0], width: 4, rows: [
    { id: 'header', cells: [{ value: 'Name' }, { value: 'Private note' }, { value: 'Start date' }, { value: 'Hired' }] },
    { id: 'subject', cells: [{ value: 'Jordan', background: '#ff0000', fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFF0000' } } }, { value: 'excluded-secret' }, { value: new Date('2026-10-05T00:00:00Z') }, { value: true }] },
    { id: 'number', cells: [{ value: 10000001 }, { value: 'excluded-second' }, { value: null }, { value: false }] },
  ] }, { ...book.sheets[0], id: 'omitted', name: 'Other sheet', hidden: [0, 1, 2] }] };
};
describe_m0('selected spreadsheet import', () => {
afterEach_m0(_afterEachFixture0);

  it_m0('physically removes excluded columns and sheets, preserving typed values, fills and row identities', () => {
    const source = fixture();
    const prepared = prepareSpreadsheetColumns_m0(source);
    const pending = { ...prepared, sheets: [{ ...prepared.sheets[0], hidden: [1] }, { ...prepared.sheets[1], hidden: [0, 1, 2] }] };
    const selected = selectSpreadsheetColumns_m0(pending);
    assert_m0.equal(selected.sheets.length, 1); assert_m0.equal(selected.sheets[0].width, 3);
    assert_m0.deepEqual(selected.sheets[0].rows[0].cells.map(cell => cell.value), ['Name', 'Start date', 'Hired']);
    assert_m0.equal(selected.sheets[0].rows[1].id, 'subject'); assert_m0.equal(selected.sheets[0].rows[1].cells[0], source.sheets[0].rows[1].cells[0]);
    assert_m0(selected.sheets[0].rows[1].cells[1].value instanceof Date); assert_m0.equal(selected.sheets[0].rows[1].cells[2].value, true);
    assert_m0.equal(selected.sheets[0].rows[2].cells[0].value, 10000001);
    assert_m0.equal(source.sheets[0].width, 4); assert_m0.equal(source.sheets[0].rows[0].cells[0].value, 'Name');
    const registered = registerLocalSpreadsheet_m0(selected);
    assert_m0.equal(registered.sheets[0].mapping.length, 3);
    assert_m0(!JSON.stringify(registeredSpreadsheetWorkbook_m0(registered)).includes('excluded-secret'));
    assert_m0.equal(searchMockSpreadsheet_m0(registered, selected.sheets[0].name, 'excluded-secret').length, 0);
  });
  it_m0('requires mapped fields and rejects duplicate field IDs without rewriting source headers', () => {
    const book = newEditableWorkbook_m0();
    const sheet = setSpreadsheetColumnField_m0(setSpreadsheetColumnField_m0(book.sheets[0], 1, 'fullName'), 2, null);
    const duplicate = { ...book, sheets: [sheet] };
    assert_m0.equal(spreadsheetColumnErrors_m0(duplicate).length, 1); assert_m0.throws(() => selectSpreadsheetColumns_m0(duplicate), /SPREADSHEET_COLUMNS_INVALID/);
    assert_m0.throws(() => selectSpreadsheetColumns_m0({ ...book, sheets: [{ ...book.sheets[0], hidden: [0, 1, 2] }] }), /Select at least one/);
    const prepared = prepareSpreadsheetColumns_m0(duplicate);
    assert_m0.equal(prepared.sheets[0].rows[0].cells[2].value, 'Notes');
    assert_m0.equal(duplicate.sheets[0].columnBindings![2].fieldId, null);
    assert_m0.equal(spreadsheetColumnErrors_m0(prepared).length, 0);
  });
  it_m0('mounts a bounded dropdown mapping editor and searches columns outside the first page', async () => {
    const book = newEditableWorkbook_m0();
    const wide = { ...book, sheets: [{ ...book.sheets[0], width: 99, rows: Array.from({ length: 2 }, (_, row) => ({ id: `r-${row}`, cells: Array.from({ length: 99 }, (_, column) => ({ value: row ? `sample-${column}` : `Field ${column}` })) })) }] };
    let confirmed: EditableWorkbook_m0 | undefined;
    function Harness() {
      const [document, change] = useState_m0<EditableWorkbook_m0>(prepareSpreadsheetColumns_m0(wide)); const trigger = useRef_m0<HTMLButtonElement>(null);
      return createElement_m0(SpreadsheetColumnImport_m0, { open: true, document, onChange: change, onOpenChange: () => undefined, onCancel: () => undefined, onConfirm: () => { confirmed = selectSpreadsheetColumns_m0(document); }, returnFocus: trigger });
    }
    const host = document.createElement('div'); document.body.append(host); root = createRoot_m0(host); await act_m0(async () => root?.render(createElement_m0(Harness)));
    const labels = () => document.querySelectorAll('button[aria-label^="Dashboard field for"]'); assert_m0.equal(labels().length, 20);
    const check = document.querySelector('[role="checkbox"][aria-labelledby]'); assert_m0(check instanceof HTMLElement);
    await act_m0(async () => check.click());
    assert_m0([...document.querySelectorAll('button')].find(node => node.textContent === 'Import selected columns')?.disabled);
    const column = [...document.querySelectorAll('[role="checkbox"]')].find(node => document.getElementById(node.getAttribute('aria-labelledby')!)?.textContent === 'A · Field 0'); assert_m0(column instanceof HTMLElement);
    await act_m0(async () => column.click());
    const input = document.querySelector('button[aria-label="Dashboard field for A"]'); assert_m0(input instanceof HTMLButtonElement);
    await act_m0(async () => input.click());
    const option = document.querySelector('[role="option"][data-value="fullName"]'); assert_m0(option instanceof HTMLElement);
    await act_m0(async () => option.click());
    const search = document.querySelector('input[aria-label="Find import column"]'); assert_m0(search instanceof HTMLInputElement);
    await act_m0(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(search, 'Field 98'); search.dispatchEvent(new Event('input', { bubbles: true })); });
    assert_m0.equal(labels().length, 1); assert_m0(document.querySelector('button[aria-label="Dashboard field for CU"]'));
    await act_m0(async () => [...document.querySelectorAll('button')].find(node => node.textContent === 'Import selected columns')?.click());
    assert_m0(confirmed); assert_m0.equal(confirmed.sheets[0].width, 1); assert_m0.equal(confirmed.sheets[0].columnBindings![0].fieldId, 'fullName'); assert_m0.equal(confirmed.sheets[0].rows[0].cells[0].value, 'Field 0');
  });
  it_m0('places the header-row control immediately before the column search', async () => {
    const book = newEditableWorkbook_m0();
    function Harness() {
      const [document, change] = useState_m0(prepareSpreadsheetColumns_m0(book)); const trigger = useRef_m0<HTMLButtonElement>(null);
      return createElement_m0(SpreadsheetColumnImport_m0, { open: true, document, onChange: change, onOpenChange: () => undefined, onCancel: () => undefined, onConfirm: () => undefined, returnFocus: trigger });
    }
    const host = document.createElement('div'); document.body.append(host); root = createRoot_m0(host); await act_m0(async () => root?.render(createElement_m0(Harness)));
    const header = document.querySelector('[aria-label="Header row"]');
    const search = document.querySelector('input[aria-label="Find import column"]');
    assert_m0(header instanceof HTMLElement && search instanceof HTMLElement);
    let group: HTMLElement | null = header;
    while (group && !group.contains(search)) group = group.parentElement;
    assert_m0(group instanceof HTMLElement && group !== header);
    const row = group.parentElement;
    assert_m0(row instanceof HTMLElement && row.childElementCount === 2 && row.lastElementChild === group);
    assert_m0(row.firstElementChild?.textContent?.includes('Keep all columns in this sheet'));
    assert_m0.equal(header.compareDocumentPosition(search) & Node.DOCUMENT_POSITION_FOLLOWING, Node.DOCUMENT_POSITION_FOLLOWING);
  });
});
}

{

const _afterEachFixture0 = resetSpreadsheetMocks_m1;
const book = (values: readonly (readonly string[])[]): EditableWorkbook_m1 => ({ name: 'Fictional.csv', themes: [], hasFormulas: false, sheets: [{ id: 'sheet', name: 'Roster', width: values[0].length, hidden: [], rows: values.map((cells, i) => ({ id: `row-${i}`, cells: cells.map(value => ({ value })) })) }] });
describe_m1('typed spreadsheet field contract', () => {
afterEach_m1(_afterEachFixture0);

  it_m1('detects headers below a preamble and retains original column and header-row provenance', () => {
    const source = book([['Student applicants', '', '', ''], ['Oct 5', '', '', ''], ['Legal Name', 'UCPath ID', 'Personal Email', 'Unneeded'], ['Jordan Lee', '10000001', 'jordan@example.com', 'discarded']]);
    const pending = prepareSpreadsheetColumns_m1(source), sheet = pending.sheets[0];
    assert_m1.equal(sheet.headerRow, 3); assert_m1.equal(sheet.columnBindings![1].fieldId, 'eid');
    assert_m1.deepEqual(spreadsheetColumnErrors_m1(pending), []);
    const selected = selectSpreadsheetColumns_m1({ ...pending, sheets: [{ ...sheet, hidden: [3] }] });
    assert_m1.equal(selected.sheets[0].sourceHeaderRow, 3); assert_m1.equal(selected.sheets[0].headerRow, 1);
    assert_m1.deepEqual(selected.sheets[0].rows.map(row => row.id), ['row-2', 'row-3']);
    assert_m1.equal(selected.sheets[0].columnBindings![1].sourceColumn, 1);
    assert_m1.equal(selected.sheets[0].columnBindings![1].sourceHeader, 'UCPath ID');
    const changedHeader = setSpreadsheetHeaderRow_m1(selected.sheets[0], 2);
    assert_m1.equal(changedHeader.sourceHeaderRow, 4);
    assert_m1.deepEqual(changedHeader.columnBindings!.map(binding => binding.id), selected.sheets[0].columnBindings!.map(binding => binding.id));
    assert_m1(!JSON.stringify(selected).includes('discarded'));
    const manual = setSpreadsheetColumnField_m1(sheet, 3, 'roster.notes');
    assert_m1.equal(setSpreadsheetHeaderRow_m1(manual, 2).columnBindings![3].fieldId, null);
    assert_m1.throws(() => setSpreadsheetHeaderRow_m1(sheet, 99), /SPREADSHEET_HEADER_ROW_INVALID/);
  });
  it_m1('checks all data rows and rejects duplicate mappings only among kept columns', () => {
    const pending = prepareSpreadsheetColumns_m1(book([['UCPath ID', 'Employee ID'], ...Array.from({ length: 30 }, () => ['10000001', '10000002']), ['99999999', '10000003']]));
    assert_m1.match(spreadsheetColumnErrors_m1(pending).join(), /mapped more than once/);
    assert_m1.match(spreadsheetColumnValueIssues(pending).join(), /row 32/);
    assert_m1.throws(() => selectSpreadsheetColumns_m1(pending), /SPREADSHEET_COLUMNS_INVALID/);
    assert_m1.equal(spreadsheetColumnErrors_m1({ ...pending, sheets: [{ ...pending.sheets[0], hidden: [0] }] }).length, 0);
  });
});
}

{
const book = (values: readonly (readonly string[])[]): EditableWorkbook_m1 => ({ name: 'Synthetic.csv', themes: [], hasFormulas: false, sheets: [{ id: 'sheet', name: 'Roster', width: values[0].length, hidden: [], rows: values.map((cells, i) => ({ id: `row-${i}`, cells: cells.map(value => ({ value })) })) }] });
describe_m1('arbitrary roster columns', () => {
  it_m1('imports trackers and unknown headers while locating and retaining invalid canonical values', () => {
    const source = book([['Roster', '', '', ''], ['', '', '', ''], ['', '', '', ''], ['', '', '', ''],
      ['UCPath ID', 'Entered in UCPath', 'Date background entered', 'Unfamiliar tracker'],
      ['10000001', 'JZ 05/29/26', '6.16.26 KM', '  untouched  ']]);
    const pending = prepareSpreadsheetColumns_m1(source);
    assert_m1.equal(pending.sheets[0].headerRow, 5);
    assert_m1.deepEqual(spreadsheetColumnErrors_m1(pending), []);
    const selected = selectSpreadsheetColumns_m1(pending);
    assert_m1.deepEqual(selected.sheets[0].rows[1].cells.map(cell => cell.value), source.sheets[0].rows[5].cells.map(cell => cell.value));
    const invalid = prepareSpreadsheetColumns_m1(book([['UCPath ID', 'Notes'], ['10000001', 'fine'], ['pending', 'retained']]));
    assert_m1.match(spreadsheetColumnValueIssues(invalid).join(), /row 3/);
    assert_m1.deepEqual(spreadsheetColumnErrors_m1(invalid), []);
    assert_m1.equal(selectSpreadsheetColumns_m1(invalid).sheets[0].rows[2].cells[0].value, 'pending');
  });
});
}
