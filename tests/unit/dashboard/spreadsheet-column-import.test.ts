// @vitest-environment jsdom
import assert from 'node:assert/strict';
import { act, createElement, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, it } from 'vitest';
import { SpreadsheetColumnImport } from '../../../src/dashboard/surfaces/spreadsheets/spreadsheet-column-import.js';
import { prepareSpreadsheetColumns, selectSpreadsheetColumns, spreadsheetColumnErrors, setSpreadsheetColumnField } from '../../../src/dashboard/surfaces/spreadsheets/spreadsheet-column-import-model.js';
import { newEditableWorkbook, type EditableWorkbook } from '../../../src/dashboard/surfaces/spreadsheets/spreadsheet-editor-model.js';
import { registerLocalSpreadsheet, registeredSpreadsheetWorkbook, resetSpreadsheetMocks, searchMockSpreadsheet } from '../../../src/dashboard/surfaces/spreadsheets/spreadsheet-mock-model.js';

Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
let root: Root | undefined;
afterEach(async () => { await act(async () => root?.unmount()); document.body.replaceChildren(); resetSpreadsheetMocks(); });
const fixture = (): EditableWorkbook => {
  const book = newEditableWorkbook();
  return { ...book, sheets: [{ ...book.sheets[0], width: 4, rows: [
    { id: 'header', cells: [{ value: 'Name' }, { value: 'Private note' }, { value: 'Start date' }, { value: 'Hired' }] },
    { id: 'subject', cells: [{ value: 'Jordan', background: '#ff0000', fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFF0000' } } }, { value: 'excluded-secret' }, { value: new Date('2026-10-05T00:00:00Z') }, { value: true }] },
    { id: 'number', cells: [{ value: 10000001 }, { value: 'excluded-second' }, { value: null }, { value: false }] },
  ] }, { ...book.sheets[0], id: 'omitted', name: 'Other sheet', hidden: [0, 1, 2] }] };
};
describe('selected spreadsheet import', () => {
  it('physically removes excluded columns and sheets, preserving typed values, fills and row identities', () => {
    const source = fixture();
    const prepared = prepareSpreadsheetColumns(source);
    const pending = { ...prepared, sheets: [{ ...prepared.sheets[0], hidden: [1] }, { ...prepared.sheets[1], hidden: [0, 1, 2] }] };
    const selected = selectSpreadsheetColumns(pending);
    assert.equal(selected.sheets.length, 1); assert.equal(selected.sheets[0].width, 3);
    assert.deepEqual(selected.sheets[0].rows[0].cells.map(cell => cell.value), ['Name', 'Start date', 'Hired']);
    assert.equal(selected.sheets[0].rows[1].id, 'subject'); assert.equal(selected.sheets[0].rows[1].cells[0], source.sheets[0].rows[1].cells[0]);
    assert(selected.sheets[0].rows[1].cells[1].value instanceof Date); assert.equal(selected.sheets[0].rows[1].cells[2].value, true);
    assert.equal(selected.sheets[0].rows[2].cells[0].value, 10000001);
    assert.equal(source.sheets[0].width, 4); assert.equal(source.sheets[0].rows[0].cells[0].value, 'Name');
    const registered = registerLocalSpreadsheet(selected);
    assert.equal(registered.sheets[0].mapping.length, 3);
    assert(!JSON.stringify(registeredSpreadsheetWorkbook(registered)).includes('excluded-secret'));
    assert.equal(searchMockSpreadsheet(registered, selected.sheets[0].name, 'excluded-secret').length, 0);
  });
  it('requires mapped fields and rejects duplicate field IDs without rewriting source headers', () => {
    const book = newEditableWorkbook();
    const sheet = setSpreadsheetColumnField(setSpreadsheetColumnField(book.sheets[0], 1, 'fullName'), 2, null);
    const duplicate = { ...book, sheets: [sheet] };
    assert.equal(spreadsheetColumnErrors(duplicate).length, 2); assert.throws(() => selectSpreadsheetColumns(duplicate), /SPREADSHEET_COLUMNS_INVALID/);
    assert.throws(() => selectSpreadsheetColumns({ ...book, sheets: [{ ...book.sheets[0], hidden: [0, 1, 2] }] }), /Select at least one/);
    const prepared = prepareSpreadsheetColumns(duplicate);
    assert.equal(prepared.sheets[0].rows[0].cells[2].value, 'Notes');
    assert.equal(duplicate.sheets[0].columnBindings![2].fieldId, null);
    assert.equal(spreadsheetColumnErrors(prepared).length, 0);
  });
  it('mounts a bounded dropdown mapping editor and searches columns outside the first page', async () => {
    const book = newEditableWorkbook();
    const wide = { ...book, sheets: [{ ...book.sheets[0], width: 99, rows: Array.from({ length: 2 }, (_, row) => ({ id: `r-${row}`, cells: Array.from({ length: 99 }, (_, column) => ({ value: row ? `sample-${column}` : `Field ${column}` })) })) }] };
    let confirmed: EditableWorkbook | undefined;
    function Harness() {
      const [document, change] = useState<EditableWorkbook>(prepareSpreadsheetColumns(wide)); const trigger = useRef<HTMLButtonElement>(null);
      return createElement(SpreadsheetColumnImport, { open: true, document, onChange: change, onOpenChange: () => undefined, onCancel: () => undefined, onConfirm: () => { confirmed = selectSpreadsheetColumns(document); }, returnFocus: trigger });
    }
    const host = document.createElement('div'); document.body.append(host); root = createRoot(host); await act(async () => root?.render(createElement(Harness)));
    const labels = () => document.querySelectorAll('button[aria-label^="Dashboard field for"]'); assert.equal(labels().length, 20);
    const check = document.querySelector('[role="checkbox"][aria-labelledby]'); assert(check instanceof HTMLElement);
    await act(async () => check.click());
    assert([...document.querySelectorAll('button')].find(node => node.textContent === 'Import selected columns')?.disabled);
    const column = [...document.querySelectorAll('[role="checkbox"]')].find(node => document.getElementById(node.getAttribute('aria-labelledby')!)?.textContent === 'A · Field 0'); assert(column instanceof HTMLElement);
    await act(async () => column.click());
    const input = document.querySelector('button[aria-label="Dashboard field for A"]'); assert(input instanceof HTMLButtonElement);
    await act(async () => input.click());
    const option = document.querySelector('[role="option"][data-value="fullName"]'); assert(option instanceof HTMLElement);
    await act(async () => option.click());
    const search = document.querySelector('input[aria-label="Find import column"]'); assert(search instanceof HTMLInputElement);
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(search, 'Field 98'); search.dispatchEvent(new Event('input', { bubbles: true })); });
    assert.equal(labels().length, 1); assert(document.querySelector('button[aria-label="Dashboard field for CU"]'));
    await act(async () => [...document.querySelectorAll('button')].find(node => node.textContent === 'Import selected columns')?.click());
    assert(confirmed); assert.equal(confirmed.sheets[0].width, 1); assert.equal(confirmed.sheets[0].columnBindings![0].fieldId, 'fullName'); assert.equal(confirmed.sheets[0].rows[0].cells[0].value, 'Field 0');
  });
});
