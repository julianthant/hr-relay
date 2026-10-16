// @vitest-environment jsdom
import assert from 'node:assert/strict';
import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, it, vi } from 'vitest';
import { SpreadsheetEditor } from '../../../../src/dashboard/surfaces/spreadsheets/spreadsheet-editor.js';
import { newEditableWorkbook, spreadsheetSaveMatches, type EditableWorkbook, type SpreadsheetSaveResult } from '../../../../src/dashboard/surfaces/spreadsheets/spreadsheet-editor-model.js';
import { registeredSpreadsheetWorkbook, resetSpreadsheetMocks, saveMockSpreadsheet, useSpreadsheetMocks } from '../../../../src/dashboard/surfaces/spreadsheets/spreadsheet-mock-model.js';
Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
let root: Root | undefined;
afterEach(async () => { await act(async () => root?.unmount()); document.body.replaceChildren(); resetSpreadsheetMocks(); vi.useRealTimers(); });
const button = (name: string) => { const node = [...document.querySelectorAll('button')].find(button => (button.getAttribute('aria-label') ?? button.textContent?.trim()) === name); assert(node, name); return node; };
async function mount(onSave?: (draft: EditableWorkbook) => Promise<SpreadsheetSaveResult>) {
  const original = newEditableWorkbook();
  const changes: { book: EditableWorkbook; dirty: boolean }[] = [];
  function Harness() {
    const [book, setBook] = useState(original), [dirty, setDirty] = useState(true);
    return createElement(SpreadsheetEditor, { document: book, dirty, onSave, onDocument(next, changed) { assert(next); changes.push({ book: next, dirty: changed }); setBook(next); setDirty(changed); } });
  }
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root?.render(createElement(Harness)));
  return { host, original, changes };
}
async function edit(value: string) {
  const cell = document.querySelector<HTMLInputElement>('input[aria-label="A2"]'); assert(cell);
  await act(async () => { cell.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(cell, value); cell.dispatchEvent(new Event('input', { bubbles: true })); });
  return cell;
}
describe('explicit workbook Save', () => {
  it('disables unavailable Save and keeps Export copy available', async () => {
    await mount(); assert(button('Save').disabled); assert(!button('Export copy').disabled);
  });
  it('keeps the exact draft pending and marks saved only after matching typed readback', async () => {
    let settle!: (result: SpreadsheetSaveResult) => void;
    const onSave = vi.fn(() => new Promise<SpreadsheetSaveResult>(resolve => { settle = resolve; }));
    const { original, changes } = await mount(onSave);
    await act(async () => button('Save').click());
    assert(button('Save').disabled); assert.match(document.body.textContent, /Saving… · Draft kept/); assert.equal(changes.length, 0);
    await act(async () => button('Save').click()); assert.equal(onSave.mock.calls.length, 1);
    await act(async () => settle({ state: 'confirmed', version: 4, readback: structuredClone(original) }));
    assert.match(document.body.textContent, /Saved · version 4/); assert.equal(changes[0].book, original); assert.equal(changes[0].dirty, false);
    await edit('Newer draft'); assert.doesNotMatch(document.body.textContent, /Saved · version 4/);
    await act(async () => button('Undo spreadsheet edit').click());
    assert.equal(changes.at(-1)?.dirty, false);
    await act(async () => button('Redo spreadsheet edit').click()); assert.equal(changes.at(-1)?.dirty, true);
  });
  for (const state of ['refused', 'conflict', 'uncertain'] as const) it(`retains the exact draft after ${state}`, async () => {
    const { original, changes } = await mount(async () => ({ state, reason: 'Library did not confirm this save.' }));
    await act(async () => button('Save').click());
    assert.match(document.body.textContent, /Library did not confirm this save. Draft kept./); assert.doesNotMatch(document.body.textContent, /Saved · version/); assert.equal(changes.length, 0);
    assert.equal(document.querySelector<HTMLInputElement>('input[aria-label="A2"]')?.value, String(original.sheets[0].rows[1].cells[0].value));
  });
  it('ignores a late confirmation for an older draft or replaced workbook', async () => {
    let settle!: (result: SpreadsheetSaveResult) => void;
    const { original, changes } = await mount(() => new Promise(resolve => { settle = resolve; }));
    await act(async () => button('Save').click()); await edit('Keep this edit');
    await act(async () => settle({ state: 'confirmed', version: 2, readback: original }));
    assert.equal(changes.length, 1); assert.equal(changes[0].dirty, true); assert.doesNotMatch(document.body.textContent, /Saved · version/);
    assert.equal(document.querySelector<HTMLInputElement>('input[aria-label="A2"]')?.value, 'Keep this edit');
  });
  it('treats thrown, mismatching and invalid-version readbacks as uncertain', async () => {
    for (const kind of ['throw', 'mismatch', 'version'] as const) {
      const { changes } = await mount(async draft => {
        if (kind === 'throw') throw new Error('lost response');
        return { state: 'confirmed', version: kind === 'version' ? 0 : 2, readback: kind === 'mismatch' ? { ...draft, name: 'other' } : draft };
      });
      await act(async () => button('Save').click()); assert.match(document.body.textContent, /Save uncertain/); assert.equal(changes.length, 0);
      await act(async () => root?.unmount()); document.body.replaceChildren();
    }
  });
  it('compares Date cells by type and accepts independent matching readback', () => {
    const original = newEditableWorkbook(); const date = new Date('2026-10-15T00:00:00Z');
    const draft = { ...original, sheets: [{ ...original.sheets[0], rows: [{ id: 'date', cells: [{ value: date }] }] }] };
    assert(spreadsheetSaveMatches(draft, { state: 'confirmed', version: 1, readback: structuredClone(draft) }));
    const readback = { ...draft, sheets: [{ ...draft.sheets[0], rows: [{ id: 'date', cells: [{ value: date.toISOString() }] }] }] };
    assert(!spreadsheetSaveMatches(draft, { state: 'confirmed', version: 1, readback }));
  });
  it('mock Save confirms the registered workbook readback and increments its version', async () => {
    vi.useFakeTimers(); let book!: EditableWorkbook;
    function Library() { const { files } = useSpreadsheetMocks(); book = registeredSpreadsheetWorkbook(files[0]); return null; }
    const host = document.createElement('div'); root = createRoot(host); await act(async () => root?.render(createElement(Library)));
    const first = saveMockSpreadsheet(book); await act(async () => vi.advanceTimersByTimeAsync(250)); const result = await first;
    assert(spreadsheetSaveMatches(book, result)); assert.equal(result.version, 1);
    const second = saveMockSpreadsheet(book); await act(async () => vi.advanceTimersByTimeAsync(250)); const next = await second; assert.equal(next.state, 'confirmed'); if (next.state === 'confirmed') assert.equal(next.version, 2);
  });
});
