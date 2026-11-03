import { expect, it } from 'vitest';
import { launchWorkbookReferences } from '../../../../src/dashboard/surfaces/run-start/run-start-model.js';
import { WorkbookLibraryEntrySchema } from '../../../../src/models/dashboard/workbook-library.js';
const entry = WorkbookLibraryEntrySchema.parse({ libraryId: 'roster', version: 3, name: 'Roster.xlsx', rowCount: 1,
  worksheets: [{ id: 'people', name: 'People' }], metadata: { typeId: 'roster-type', sharePoint: null },
  type: { id: 'roster-type', name: 'Roster', keyFieldId: 'email', fields: ['email', 'fullName'], defaultWorkbookId: 'roster' },
  state: { libraryId: 'roster', revision: 4, selectedVersionId: 'current', removed: false, origin: { kind: 'local' },
    versions: ['earlier', 'current'].map((id, index) => ({ id, name: id, snapshotId: id, version: index + 1, savedAt: '2026-11-01T00:00:00Z', source: 'operator' })) } });
const selections = { 'roster-type': { libraryId: 'roster', versionId: 'earlier' } };
it('sends the exact named version, selection identity for each parsed input', () => {
  expect(launchWorkbookReferences(['roster-type'], [entry], selections, 2)).toEqual([
    { entry: 1, typeId: 'roster-type', libraryId: 'roster', versionId: 'earlier' },
    { entry: 2, typeId: 'roster-type', libraryId: 'roster', versionId: 'earlier' },
  ]);
});
it('refuses missing reference identities, unavailable named versions', () => {
  expect(() => launchWorkbookReferences(['missing'], [entry], selections, 1)).toThrow();
  expect(() => launchWorkbookReferences(['roster-type'], [entry], { 'roster-type': { libraryId: 'roster', versionId: 'deleted' } }, 1)).toThrow();
});
