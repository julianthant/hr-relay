import { expect, it } from 'vitest';
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
