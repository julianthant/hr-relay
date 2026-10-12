// @vitest-environment jsdom
import assert from 'node:assert/strict';
import { act,createElement,useState } from 'react';
import { createRoot,type Root } from 'react-dom/client';
import { afterEach,describe,it,vi } from 'vitest';
import { newEditableWorkbook,type EditableWorkbook } from '../../../../src/dashboard/surfaces/spreadsheets/spreadsheet-editor-model.js';
import { SpreadsheetEditor } from '../../../../src/dashboard/surfaces/spreadsheets/spreadsheet-editor.js';

Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
let root: Root | undefined;
afterEach(async () => { await act(async () => root?.unmount()); document.body.replaceChildren(); vi.useRealTimers(); vi.unstubAllGlobals(); });
async function mount(element: ReturnType<typeof createElement>) { const host = document.createElement('div'); document.body.append(host); root = createRoot(host); await act(async () => root?.render(element)); return host; }
const button = (name: string) => { const found = [...document.querySelectorAll('button')].find(node => (node.getAttribute('aria-label') ?? node.textContent?.trim()) === name); assert(found, name); return found; };
const press = async (name: string) => act(async () => button(name).click());
function SheetHarness({ initial }: { initial: EditableWorkbook }) {
  const [book, setBook] = useState(initial), [dirty, setDirty] = useState(false);
  return createElement(SpreadsheetEditor, { document: book, dirty, onDocument: (next, changed) => { assert(next); setBook(next); setDirty(changed); } });
}
describe('mounted frontend reliability contracts', () => {
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
