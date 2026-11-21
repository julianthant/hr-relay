import { expect, it, vi } from 'vitest';
import { z } from 'zod';
import { applyMasterChange, WorkbookOwnershipSchema, type WorkbookOwnership } from '../../../src/backend/workbooks/master-changes.js';
import { WorkbookLibraryError } from '../../../src/backend/workbooks/workbook-library-error.js';
import { EditableWorkbookWireSchema, WorkbookOperationSchema } from '../../../src/models/dashboard/workbooks.js';
import { ERROR_CATALOG } from '../../../src/models/failures/error-catalog.js';

function syncInput(ownership: WorkbookOwnership = {}) {
  const workbook = EditableWorkbookWireSchema.parse({
    libraryId: 'synthetic-library', name: 'Synthetic.xlsx', themes: [], hasFormulas: false,
    sheets: [{ id: 'people', name: 'People', width: 2, hidden: [], headerRow: 1,
      columnBindings: [
        { id: 'key', sourceColumn: 0, sourceHeader: 'Key', fieldId: 'eid', basis: 'manual' },
        { id: 'notes', sourceColumn: 1, sourceHeader: 'Notes', fieldId: 'roster.notes', basis: 'manual' },
      ],
      rows: [
        { id: 'header', cells: [{ value: 'Key' }, { value: 'Notes' }] },
        { id: 'first', cells: [{ value: 'synthetic-a' }, { value: 'operator-note' }] },
        { id: 'second', cells: [{ value: 'synthetic-b' }, { value: null }] },
      ],
    }],
  });
  const incoming = structuredClone(workbook);
  delete incoming.sheets[0].columnBindings;
  incoming.sheets[0].rows.forEach((row, index) => { row.id = `incoming-${index}`; });
  incoming.sheets[0].rows[1].cells[1].value = 'remote-note';
  const operation = WorkbookOperationSchema.parse({
    operationId: 'synthetic-sync', source: { kind: 'sync', syncId: 'synthetic-sync' },
    at: '2026-11-02T00:00:00.000Z', change: { kind: 'sync', expectedVersion: 1, workbook: incoming },
  });
  return { workbook, version: 1, ownership: WorkbookOwnershipSchema.parse(ownership), type: undefined,
    operation, libraryId: 'synthetic-library', sequence: 1,
    context: { captured: true, witnesses: [{ sheetId: 'people', rowId: 'first', keyFieldId: 'eid', key: 'synthetic-a' }] },
  };
}

function corruption(input: ReturnType<typeof syncInput>) {
  const before = structuredClone(input);
  try {
    applyMasterChange(input);
  } catch (error) {
    expect(input).toEqual(before);
    expect(error).toBeInstanceOf(WorkbookLibraryError);
    if (!(error instanceof WorkbookLibraryError)) throw error;
    expect(error).toMatchObject({ name: 'WorkbookLibraryError', code: 'WORKBOOK_STORAGE_CORRUPT',
      message: ERROR_CATALOG.WORKBOOK_STORAGE_CORRUPT.text });
    return error;
  }
  throw new Error('Expected stored ownership corruption to throw');
}

it('throws structured corruption with the JSON parser cause for malformed stored ownership addresses without mutation', () => {
  const error = corruption(syncInput({ 'invalid-json-ownership': { owner: 'operator' } }));
  expect(error.cause).toBeInstanceOf(SyntaxError);
  expect(error.message).not.toContain('invalid-json-ownership');
});

it('throws structured corruption with the tuple validation cause for invalid stored ownership addresses without mutation', () => {
  const error = corruption(syncInput({ '["people","first",42]': { owner: 'operator' } }));
  expect(error.cause).toBeInstanceOf(z.ZodError);
  if (!(error.cause instanceof z.ZodError)) throw new Error('Expected ownership tuple validation cause');
  expect(error.cause.issues).toEqual([{ expected: 'string', code: 'invalid_type', path: [2],
    message: 'Invalid input: expected string, received number' }]);
});

it('syncs valid empty ownership and retains captured key witnesses without mutating inputs', () => {
  const input = syncInput(), before = structuredClone(input);
  const result = applyMasterChange(input);
  expect(result.receipt).toMatchObject({ state: 'applied', version: 2 });
  expect(result.ownership).toEqual({});
  expect(result.workbook.sheets[0].rows[1].cells[1].value).toBe('remote-note');
  expect(input.workbook).toEqual(before.workbook);
  expect(input.operation).toEqual(before.operation);
  expect(input.ownership).toEqual(before.ownership);
  expect(input.context).toEqual({ captured: true,
    witnesses: [{ sheetId: 'people', rowId: 'incoming-1', keyFieldId: 'eid', key: 'synthetic-a' }] });
});

it.each(['missing', 'duplicate'])('retains resolve-required Sync semantics for a %s captured key', kind => {
  const input = syncInput({ '["people","first","roster.notes"]': { owner: 'operator' } });
  if (input.operation.change.kind !== 'sync') throw new Error('Expected synthetic Sync operation');
  input.operation.change.workbook.sheets[0].rows[kind === 'missing' ? 1 : 2].cells[0].value = kind === 'missing' ? 'other-key' : 'synthetic-a';
  const before = structuredClone(input);
  const result = applyMasterChange(input);
  expect(result.receipt).toMatchObject({ state: 'resolve-required', reason: 'sync-ambiguous', version: 1 });
  expect(result.workbook).toEqual(before.workbook);
  expect(result.ownership).toEqual(before.ownership);
  expect(input).toEqual(before);
});

function largeWorkbook(rows: number) {
  return EditableWorkbookWireSchema.parse({
    libraryId: 'synthetic-library', name: 'Large.xlsx', themes: [], hasFormulas: false,
    sheets: [{ id: 'people', name: 'People', width: 2, hidden: [], headerRow: 1,
      columnBindings: [
        { id: 'key', sourceColumn: 0, sourceHeader: 'Key', fieldId: 'eid', basis: 'manual' },
        { id: 'notes', sourceColumn: 1, sourceHeader: 'Notes', fieldId: 'roster.notes', basis: 'manual' },
      ],
      rows: [{ id: 'header', cells: [{ value: 'Key' }, { value: 'Notes' }] },
        ...Array.from({ length: rows }, (_, index) => ({ id: `row-${index}`, cells: [{ value: `synthetic-${index}` }, { value: `note-${index}` }] }))],
    }],
  });
}

it('saves a large workbook without searching the incoming rows for every cell', () => {
  const rows = 2000, workbook = largeWorkbook(rows), edited = structuredClone(workbook);
  edited.sheets[0].rows[rows].cells[1].value = 'operator-edit';
  const operation = WorkbookOperationSchema.parse({ operationId: 'synthetic-save', source: { kind: 'operator' },
    at: '2026-11-02T00:00:00.000Z', change: { kind: 'save', expectedVersion: 1, workbook: edited } });
  if (operation.change.kind !== 'save') throw new Error('Expected a save');
  let idReads = 0;
  for (const row of operation.change.workbook.sheets[0].rows) {
    const id = row.id;
    Object.defineProperty(row, 'id', { enumerable: true, get() { idReads++; return id; } });
  }
  const result = applyMasterChange({ workbook, version: 1, ownership: {}, type: undefined, operation, libraryId: 'synthetic-library', sequence: 1 });
  expect(result.receipt.state).toBe('applied');
  expect(result.ownership).toEqual({ [JSON.stringify(['people', `row-${rows - 1}`, 'roster.notes'])]: { owner: 'operator' } });
  expect(result.receipt.changes).toEqual([expect.objectContaining({ rowId: `row-${rows - 1}`, oldValue: `note-${rows - 1}`, newValue: 'operator-edit' })]);
  expect(idReads).toBeLessThanOrEqual(4 * (rows + 1));
});

it('syncs operator-owned fields of a large keyed workbook with a bounded number of row scans', () => {
  const rows = 500, workbook = largeWorkbook(rows), incoming = structuredClone(workbook);
  delete incoming.sheets[0].columnBindings;
  incoming.sheets[0].rows.forEach((row, index) => { row.id = `incoming-${index}`; if (index > 0) row.cells[1].value = `remote-${index}`; });
  const ownership = WorkbookOwnershipSchema.parse(Object.fromEntries(Array.from({ length: rows }, (_, index) =>
    [JSON.stringify(['people', `row-${index}`, 'roster.notes']), { owner: 'operator' }])));
  const operation = WorkbookOperationSchema.parse({ operationId: 'synthetic-sync', source: { kind: 'sync', syncId: 'synthetic-sync' },
    at: '2026-11-02T00:00:00.000Z', change: { kind: 'sync', expectedVersion: 1, workbook: incoming } });
  const slice = Array.prototype.slice;
  let rowScans = 0;
  const spy = vi.spyOn(Array.prototype, 'slice').mockImplementation(function (this: unknown[], ...args: [number?, number?]) {
    if (this.length === rows + 1) rowScans++;
    return slice.apply(this, args);
  });
  let result: ReturnType<typeof applyMasterChange>;
  try {
    result = applyMasterChange({ workbook, version: 1, ownership, type: { keyFieldId: 'eid', fields: ['eid', 'roster.notes'] },
      operation, libraryId: 'synthetic-library', sequence: 1 });
  } finally { spy.mockRestore(); }
  expect(result.receipt.state).toBe('applied');
  expect(result.workbook.sheets[0].rows.slice(1).map(row => row.cells[1].value)).toEqual(Array.from({ length: rows }, (_, index) => `note-${index}`));
  expect(Object.keys(result.ownership)).toHaveLength(rows);
  expect(rowScans).toBeLessThanOrEqual(8);
});

it('refuses a keyed sync when an owned key repeats in either workbook', () => {
  const ownership = WorkbookOwnershipSchema.parse({ [JSON.stringify(['people', 'row-0', 'roster.notes'])]: { owner: 'operator' } });
  const sync = (currentDuplicate: boolean) => {
    const workbook = largeWorkbook(3), incoming = structuredClone(workbook);
    delete incoming.sheets[0].columnBindings;
    (currentDuplicate ? workbook : incoming).sheets[0].rows[3].cells[0].value = 'synthetic-0';
    const operation = WorkbookOperationSchema.parse({ operationId: 'synthetic-sync', source: { kind: 'sync', syncId: 'synthetic-sync' },
      at: '2026-11-02T00:00:00.000Z', change: { kind: 'sync', expectedVersion: 1, workbook: incoming } });
    return applyMasterChange({ workbook, version: 1, ownership, type: { keyFieldId: 'eid', fields: ['eid', 'roster.notes'] },
      operation, libraryId: 'synthetic-library', sequence: 1 }).receipt;
  };
  expect(sync(false)).toMatchObject({ state: 'resolve-required', reason: 'sync-ambiguous' });
  expect(sync(true)).toMatchObject({ state: 'resolve-required', reason: 'sync-ambiguous' });
});
