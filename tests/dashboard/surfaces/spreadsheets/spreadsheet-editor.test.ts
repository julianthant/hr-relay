// @vitest-environment jsdom
import assert from 'node:assert/strict';
import { act,createElement,useState } from 'react';
import { createRoot,type Root } from 'react-dom/client';
import { afterEach,describe,it,vi } from 'vitest';
import { newEditableWorkbook } from '../../../../src/dashboard/surfaces/spreadsheets/spreadsheet-editor-model.js';
import { type EditableWorkbook } from '../../../../src/rules/spreadsheets/workbook-io.js';
import { SpreadsheetEditor } from '../../../../src/dashboard/surfaces/spreadsheets/spreadsheet-editor.js';

Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
let root: Root | undefined;
afterEach(async () => { await act(async () => root?.unmount()); document.body.replaceChildren(); vi.useRealTimers(); vi.unstubAllGlobals(); });
async function mount(element: ReturnType<typeof createElement>) { const host = document.createElement('div'); document.body.append(host); root = createRoot(host); await act(async () => root?.render(element)); return host; }
const button = (name: string) => { const found = [...document.querySelectorAll('button')].find(node => (node.getAttribute('aria-label') ?? node.textContent?.trim()) === name); assert(found, name); return found; };
const press = async (name: string) => act(async () => button(name).click());
function SheetHarness({ initial, onChange }: { initial: EditableWorkbook; onChange?: (book: EditableWorkbook) => void }) {
  const [book, setBook] = useState(initial), [dirty, setDirty] = useState(false);
  return createElement(SpreadsheetEditor, { document: book, dirty, onDocument: (next, changed) => { assert(next); setBook(next); setDirty(changed); onChange?.(next); } });
}
const menuItem = (name: string) => {
  const found = [...document.querySelectorAll<HTMLElement>('[role=menuitem]')].find(node => node.textContent?.trim() === name);
  assert(found, name); return found;
};
async function addColumn(title: string) {
  await press('Insert');
  assert.notEqual(menuItem('Add column').getAttribute('aria-disabled'), 'true');
  await act(async () => menuItem('Add column').click());
  const input = document.querySelector<HTMLInputElement>('input[aria-label="Column title"]'); assert(input);
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, title); input.dispatchEvent(new Event('input', { bubbles: true })); });
  await press('Add column');
}
function syntheticSheet(id: string, width: number, height: number, populated: number): EditableWorkbook['sheets'][number] {
  return { id, name: id, width, hidden: [], rows: Array.from({ length: height }, (_, row) => ({ id: `${id}-${row}`, cells: Array.from({ length: width }, (_, column) => ({ value: row * width + column < populated ? false : null })) })) };
}
describe('mounted frontend reliability contracts', () => {
  it('inserts rows and columns above the former 100,000-cell ceiling', async () => {
    const original = { ...newEditableWorkbook(), sheets: [syntheticSheet('Large', 100, 1001, 100_100)] };
    let current: EditableWorkbook = original;
    await mount(createElement(SheetHarness, { initial: original, onChange: book => { current = book; } }));
    await press('Insert');
    assert.notEqual(menuItem('Add row').getAttribute('aria-disabled'), 'true');
    await act(async () => menuItem('Add row').click());
    assert.equal(current.sheets[0].rows.length, 1002);
    assert(current.sheets[0].rows[1001].cells.every(cell => cell.value === ''));
    await addColumn('Added header');
    assert.equal(current.sheets[0].width, 101);
    assert.equal(current.sheets[0].rows[0].cells[100].value, 'Added header');
    assert(current.sheets[0].rows.slice(1).every(row => row.cells[100].value === ''));
    assert.equal(document.querySelectorAll('tbody input').length <= 1000, true);
  });
  it('charges a new header against the workbook population while blank rows remain insertable', async () => {
    const original = { ...newEditableWorkbook(), hasFormulas: true, unsupportedMetadata: true,
      sheets: [syntheticSheet('Selected', 1, 2, 1), syntheticSheet('Other', 1000, 250, 249_998)] };
    let current: EditableWorkbook = original;
    await mount(createElement(SheetHarness, { initial: original, onChange: book => { current = book; } }));
    await addColumn('Final populated cell');
    assert.equal(current.sheets[0].rows[0].cells[1].value, 'Final populated cell');
    await press('Insert');
    assert.equal(menuItem('Add column').getAttribute('aria-disabled'), 'true');
    const before = current;
    await act(async () => menuItem('Add column').click());
    assert.equal(current === before, true);
    assert.equal(document.querySelector('[role=dialog]'), null);
    assert.notEqual(menuItem('Add row').getAttribute('aria-disabled'), 'true');
    await act(async () => menuItem('Add row').click());
    assert.equal(current.sheets[0].rows.length, 3);
    assert.equal(current.sheets[1] === original.sheets[1], true);
    assert.equal(current.hasFormulas, true);
    assert.equal(current.unsupportedMetadata, true);
  });
  it('accounts for other sheets at the grid limit and preserves undo for valid insertions', async () => {
    const original = { ...newEditableWorkbook(), sheets: [syntheticSheet('Selected', 10, 1, 1), syntheticSheet('Other', 60, 8333, 0)] };
    let current: EditableWorkbook = original;
    await mount(createElement(SheetHarness, { initial: original, onChange: book => { current = book; } }));
    await addColumn('Fits in the grid');
    await press('Insert');
    assert.equal(menuItem('Add row').getAttribute('aria-disabled'), 'true');
    assert.notEqual(menuItem('Add column').getAttribute('aria-disabled'), 'true');
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    await press('Undo spreadsheet edit');
    assert.equal(current === original, true);
    await press('Insert');
    assert.notEqual(menuItem('Add row').getAttribute('aria-disabled'), 'true');
    await act(async () => menuItem('Add row').click());
    assert.equal(current.sheets[0].rows.length, 2);
    await press('Insert');
    assert.equal(menuItem('Add row').getAttribute('aria-disabled'), 'true');
    assert.equal(menuItem('Add column').getAttribute('aria-disabled'), 'true');
    const before = current;
    await act(async () => { menuItem('Add row').click(); menuItem('Add column').click(); });
    assert.equal(current === before, true);
    assert.equal(current.sheets[1] === original.sheets[1], true);
  });
  it('bounds 100,000 cells in both dimensions, pages and searches the full sheet', async () => {
    const original = newEditableWorkbook();
    const rows = Array.from({ length: 1001 }, (_, row) => ({ id: `row-${row}`, cells: Array.from({ length: 99 }, (_, column) => ({ value: row === 0 ? `Column ${column}` : `record-${row}-${column}` })) }));
    const host = await mount(createElement(SheetHarness, { initial: { ...original, sheets: [{ ...original.sheets[0], width: 99, rows }] } }));
    assert.equal(host.querySelectorAll('tbody tr').length, 50);
    assert.equal(host.querySelectorAll('tbody input').length, 1000);
    await press('Next spreadsheet columns');
    assert(host.querySelector('input[aria-label="U2"]'));
    await press('Next spreadsheet page');
    assert(host.querySelector('input[aria-label="U52"]'));
    const search = host.querySelector('input[aria-label="Search spreadsheet cells"]'); assert(search instanceof HTMLInputElement);
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(search, 'record-999-20'); search.dispatchEvent(new Event('input', { bubbles: true })); });
    assert.equal(host.querySelectorAll('tbody tr').length, 1);
    assert(host.querySelector('input[aria-label="U1000"]'));
  });
  it('undoes structural sorting separately from focused cell typing', async () => {
    const original = newEditableWorkbook();
    const sheet = original.sheets[0];
    const second = { id: 'second-row', cells: Array.from({ length: sheet.width }, (_, column) => ({ value: column === 0 ? 'Aaron' : '' })) };
    const host = await mount(createElement(SheetHarness, { initial: { ...original, sheets: [{ ...sheet, rows: [...sheet.rows, second] }] } }));
    const cell = host.querySelector('input[aria-label="A2"]'); assert(cell instanceof HTMLInputElement);
    for (const value of ['A', 'Alice']) await act(async () => {
      cell.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(cell, value);
      cell.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await press('Sort column A');
    assert.equal(host.querySelector<HTMLInputElement>('input[aria-label="A2"]')?.value, 'Aaron');
    await press('Undo spreadsheet edit');
    assert.equal(host.querySelector<HTMLInputElement>('input[aria-label="A2"]')?.value, 'Alice');
    await press('Undo spreadsheet edit');
    assert.equal(host.querySelector<HTMLInputElement>('input[aria-label="A2"]')?.value, '');
    await press('Redo spreadsheet edit');
    assert.equal(host.querySelector<HTMLInputElement>('input[aria-label="A2"]')?.value, 'Alice');
  });
  it('supports reversible controlled cell edits and keeps unrelated text-field shortcuts native', async () => {
    const host = await mount(createElement(SheetHarness, { initial: newEditableWorkbook() }));
    const cell = host.querySelector('input[aria-label="A2"]'); assert(cell instanceof HTMLInputElement);
    await act(async () => { cell.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(cell, 'Changed'); cell.dispatchEvent(new Event('input', { bubbles: true })); });
    assert.equal(cell.value, 'Changed');
    await act(async () => cell.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true })));
    assert.equal(cell.value, '');
    await press('Redo spreadsheet edit'); assert.equal(cell.value, 'Changed');
    const search = host.querySelector('input[aria-label="Search spreadsheet cells"]'); assert(search);
    const shortcut = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true });
    await act(async () => search.dispatchEvent(shortcut)); assert.equal(shortcut.defaultPrevented, false); assert.equal(cell.value, 'Changed');
  });
});
