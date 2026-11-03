import { expect, it } from 'vitest';
import { RunWorkbookReferenceSchema } from '../../../src/models/dashboard/workbooks.js';

const reference = {
  request: { typeId: 'roster', libraryId: 'library', versionId: 'fall-hires', keys: ['10000001'], fields: ['eid'] },
  snapshot: { libraryId: 'library', version: 3, versionId: 'fall-hires', versionName: 'Fall hires',
    worksheets: [{ sheetId: 'people', name: 'People' }],
    type: { id: 'roster', name: 'Roster', keyFieldId: 'eid', fields: ['eid'], defaultWorkbookId: 'library' },
    rows: [{ key: '10000001', state: 'matched', matches: [{ sheetId: 'people', rowId: 'person', values: { eid: '10000001' } }] }] },
};

it('retains a named version separately from the current workbook CAS revision', () => {
  expect(RunWorkbookReferenceSchema.parse(reference)).toEqual(reference);
  expect(RunWorkbookReferenceSchema.safeParse({ ...reference, snapshot: { ...reference.snapshot, versionId: 'another-version' } }).success).toBe(false);
  expect(RunWorkbookReferenceSchema.safeParse({ ...reference, snapshot: { ...reference.snapshot, versionName: undefined } }).success).toBe(false);
});

it('allows the default selection while retaining the server-selected named version', () => {
  const request = { ...reference.request, versionId: undefined };
  expect(RunWorkbookReferenceSchema.parse({ ...reference, request }).snapshot.versionId).toBe('fall-hires');
});
