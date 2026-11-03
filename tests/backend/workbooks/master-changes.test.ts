import { expect, it } from 'vitest';
import { mergeMasterWorkbooks } from '../../../src/backend/workbooks/master-changes.js';
import { EditableWorkbookWireSchema, WorkbookTypeSchema } from '../../../src/models/dashboard/workbooks.js';

const type = WorkbookTypeSchema.parse({ id: 'roster', name: 'Roster', keyFieldId: 'eid', fields: ['eid', 'fullName'], defaultWorkbookId: null });
function source(libraryId: string, savedAt: string, people: string[][]) {
  return { libraryId, savedAt, workbook: EditableWorkbookWireSchema.parse({ name: `${libraryId}.xlsx`, libraryId, themes: [], hasFormulas: false,
    sheets: [{ id: 'sheet', name: 'People', width: 2, hidden: [], headerRow: 1,
      columnBindings: ['eid', 'fullName'].map((fieldId, index) => ({ id: `column-${index}`, sourceColumn: index, sourceHeader: fieldId, fieldId, basis: 'manual' })),
      rows: [['eid', 'fullName'], ...people].map((cells, index) => ({ id: `row-${index}`, cells: cells.map(value => ({ value })) })) }] }) };
}
const older = () => source('older', '2026-10-01T00:00:00Z', [['10000001', 'Earlier name'], ['', 'No key']]);
const newer = () => source('newer', '2026-10-02T00:00:00Z', [['10000001', 'Later name'], ['10000002', 'Other person']]);
it('merges by the declared key, retains blank keys, preserves source bytes and makes row identities unique', () => {
  const sources = [older(), newer()], before = structuredClone(sources);
  const result = mergeMasterWorkbooks(sources, type, 'Merged.xlsx', 'keep-newer')!;
  expect(result.libraryId).toBe('older');
  expect(result.sheets[0].rows.slice(1).map(row => row.cells.map(cell => cell.value))).toEqual([['', 'No key'], ['10000001', 'Later name'], ['10000002', 'Other person']]);
  expect(new Set(result.sheets[0].rows.map(row => row.id)).size).toBe(4);
  expect(sources).toEqual(before);
  expect(mergeMasterWorkbooks(sources, type, 'Both.xlsx', 'keep-both')!.sheets[0].rows).toHaveLength(5);
});
it('refuses tied or ambiguous newer rows, missing declared keys, unsupported metadata and incompatible layouts', () => {
  expect(mergeMasterWorkbooks([older(), { ...newer(), savedAt: older().savedAt }], type, 'Merged.xlsx', 'keep-newer')).toBeUndefined();
  expect(mergeMasterWorkbooks([older(), newer()], { ...type, keyFieldId: null }, 'Merged.xlsx', 'keep-newer')).toBeUndefined();
  const duplicate = newer(); duplicate.workbook.sheets[0].rows.push({ ...duplicate.workbook.sheets[0].rows[1], id: 'duplicate' });
  expect(mergeMasterWorkbooks([older(), duplicate], type, 'Merged.xlsx', 'keep-newer')).toBeUndefined();
  const incompatible = newer(); incompatible.workbook.sheets[0].rows[0].cells[1].value = 'Different header';
  expect(mergeMasterWorkbooks([older(), incompatible], type, 'Merged.xlsx', 'keep-both')).toBeUndefined();
  expect(mergeMasterWorkbooks([older(), { ...newer(), workbook: { ...newer().workbook, unsupportedMetadata: true } }], type, 'Merged.xlsx', 'keep-both')).toBeUndefined();
});
