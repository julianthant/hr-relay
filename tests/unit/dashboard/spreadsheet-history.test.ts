import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { EMPTY_WORKBOOK_HISTORY, recordWorkbookEdit, stepWorkbookHistory } from '../../../src/dashboard/surfaces/spreadsheets/spreadsheet-history-model.js';
import { editSpreadsheetCell, importSpreadsheet, sortSpreadsheet, spreadsheetXlsx, type EditableWorkbook } from '../../../src/dashboard/surfaces/spreadsheets/spreadsheet-editor-model.js';

function workbook(): EditableWorkbook {
  return { name: 'typed.xlsx', libraryId: 'fixture-one', themes: [], hasFormulas: false, sheets: [
    { id: 'one', name: 'One', width: 2, hidden: [], rows: [
      { id: 'header', cells: [{ value: 'Number' }, { value: 'Date' }] },
      { id: 'a', cells: [{ value: 42, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF00FF00' } } }, { value: new Date('2026-10-05T00:00:00Z') }] },
      { id: 'b', cells: [{ value: true }, { value: null }] },
    ] },
    { id: 'two', name: 'Two', width: 1, hidden: [], rows: [{ id: 'header-two', cells: [{ value: 'Other' }] }] },
  ] };
}
const edit = (book: EditableWorkbook, value: string) => ({ ...book, sheets: [editSpreadsheetCell(book.sheets[0], 'a', 0, value), book.sheets[1]] });
describe('workbook-scoped reversible editing', () => {
  it('coalesces one focused cell edit and restores types, fills and unchanged sheet identity', () => {
    const original = workbook(), first = edit(original, 'a'), second = edit(first, 'ab');
    const history = recordWorkbookEdit(recordWorkbookEdit(EMPTY_WORKBOOK_HISTORY, original, first, 'focus-1'), first, second, 'focus-1');
    assert.equal(history.undo.length, 1);
    const undone = stepWorkbookHistory(history, second, 'undo');
    assert.equal(undone.document, original);
    assert.equal(undone.document.sheets[0].rows[1].cells[0].value, 42);
    assert(undone.document.sheets[0].rows[1].cells[1].value instanceof Date);
    assert.equal(undone.document.sheets[1], second.sheets[1]);
    assert.deepEqual(second.sheets[0].rows[1].cells[0].fill, original.sheets[0].rows[1].cells[0].fill);
    assert.equal(stepWorkbookHistory(undone.history, undone.document, 'redo').document, second);
  });
  it('clears redo on a branching edit and rejects a different workbook with the same filename', () => {
    const original = workbook(), changed = edit(original, 'one');
    const undone = stepWorkbookHistory(recordWorkbookEdit(EMPTY_WORKBOOK_HISTORY, original, changed), changed, 'undo');
    const branch = recordWorkbookEdit(undone.history, original, edit(original, 'other'));
    assert.equal(branch.redo.length, 0);
    assert.throws(() => recordWorkbookEdit(branch, original, { ...original, libraryId: 'other' }), /IDENTITY_MISMATCH/);
    assert.equal(stepWorkbookHistory(EMPTY_WORKBOOK_HISTORY, original, 'undo').document, original);
  });
  it('restores sorting, visibility, additions and multiple sheets without mutating the original', () => {
    const original = workbook();
    const sorted = { ...original, sheets: [sortSpreadsheet(original.sheets[0], 0, 'desc'), original.sheets[1]] };
    const structural = { ...sorted, sheets: [{ ...sorted.sheets[0], hidden: [1], rows: [...sorted.sheets[0].rows, { id: 'new', cells: [{ value: '' }, { value: '' }] }] }, sorted.sheets[1]] };
    const history = recordWorkbookEdit(recordWorkbookEdit(EMPTY_WORKBOOK_HISTORY, original, sorted), sorted, structural);
    const last = stepWorkbookHistory(history, structural, 'undo');
    assert.equal(last.document, sorted);
    assert.equal(stepWorkbookHistory(last.history, last.document, 'undo').document, original);
    assert.equal(original.sheets[0].rows.length, 3); assert.deepEqual(original.sheets[0].hidden, []);
  });
  it('bounds history and preserves typed undo values through an XLSX export/import', async () => {
    const original = workbook(); let current = original, history = EMPTY_WORKBOOK_HISTORY;
    for (let index = 0; index < 60; index++) { const next = edit(current, String(index)); history = recordWorkbookEdit(history, current, next); current = next; }
    assert.equal(history.undo.length, 50);
    const changed = edit(original, 'new');
    const restored = stepWorkbookHistory(recordWorkbookEdit(EMPTY_WORKBOOK_HISTORY, original, changed), changed, 'undo').document;
    const exported = await importSpreadsheet('typed.xlsx', await spreadsheetXlsx(restored));
    assert.equal(exported.sheets[0].rows[1].cells[0].value, 42);
    assert.equal(exported.sheets[0].rows[2].cells[0].value, true);
    assert(exported.sheets[0].rows[1].cells[1].value instanceof Date);
    assert.deepEqual(exported.sheets[0].rows[1].cells[0].fill, original.sheets[0].rows[1].cells[0].fill);
  });
});
