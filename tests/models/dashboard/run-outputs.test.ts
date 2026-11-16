import { expect, it } from 'vitest';
import { PlannedRunOutputSchema } from '../../../src/models/dashboard/run-outputs.js';
it('distinguishes an unknown workbook population from captured worksheet archive membership', () => {
  expect(PlannedRunOutputSchema.parse({ kind: 'workbook', name: 'I-9 results.xlsx', rowSubject: 'person', rows: { state: 'after-review' } }).kind).toBe('workbook');
  expect(PlannedRunOutputSchema.parse({ kind: 'worksheet-archives', state: 'after-row-choice' })).toEqual({ kind: 'worksheet-archives', state: 'after-row-choice' });
  const archive = { kind: 'worksheet-archive', sheetId: 'july', worksheetName: 'July 6', folderName: 'July 6', archiveName: 'July 6.zip', people: [{ rowId: 'person-1', label: 'Example, Person · EID 10000001' }] };
  expect(PlannedRunOutputSchema.parse(archive)).toEqual(archive);
  expect(PlannedRunOutputSchema.safeParse({ ...archive, people: [...archive.people, ...archive.people] }).success).toBe(false);
  expect(PlannedRunOutputSchema.safeParse({ ...archive, people: [] }).success).toBe(false);
  expect(PlannedRunOutputSchema.safeParse({ kind: 'workbook', name: 'Results.xlsx', rowSubject: 'person', rows: { state: 'after-review', count: 1 } }).success).toBe(false);
});
