import assert from 'node:assert/strict';
import { it } from 'vitest';
import { WorkbookCompatibilitySchema, projectWorkbookCompatibility } from '../../../src/models/dashboard/workbook-library.js';

it('evaluates each selected worksheet independently of type, name, blank values, and unrelated sheets', () => {
  const workflows = [
    { id: 'ocr', label: 'OCR', requiredWorkbookFields: ['eid', 'fullName'], workbookReference: { id: 'ocr-roster', keyFieldId: 'eid', mode: 'all', writableFields: [] } },
    { id: 'onboarding', label: 'Onboarding', requiredWorkbookFields: ['email', 'eid'], workbookReference: { id: 'onboarding-roster', keyFieldId: 'email', mode: 'keys', writableFields: ['eid'] } },
  ] as const;
  const library = [{ libraryId: 'general', versionId: 'v1', origin: { kind: 'local' as const }, removed: false,
    sheets: [{ id: 'mapped', name: 'Employees', mappings: [{ fieldId: 'eid', column: 0, basis: 'manual' as const }, { fieldId: 'fullName', column: 1, basis: 'manual' as const }, { fieldId: 'email', column: 2, basis: 'manual' as const }] },
      { id: 'unrelated', name: 'Notes', mappings: [] }] }];
  const report = projectWorkbookCompatibility(workflows, library);
  assert.deepEqual(report.workflows.map(workflow => workflow.sources.map(source => source.sheetId)), [['mapped'], ['mapped']]);
  assert.equal(report.libraries[0].sheets[0].workflows.every(workflow => workflow.status === 'compatible'), true);
  assert.deepEqual(report.libraries[0].sheets[1].workflows[0].missingFields, ['eid', 'fullName']);
  assert.deepEqual(report.libraries[0].sheets[1].workflows[1].missingFields, ['email', 'eid']);
});

it('reports missing and duplicate mappings exactly and excludes output origins', () => {
  const workflow = { id: 'ocr', label: 'OCR', requiredWorkbookFields: ['eid', 'fullName'], workbookReference: { id: 'ocr-roster', keyFieldId: 'eid', mode: 'all', writableFields: [] } } as const;
  const library = [
    { libraryId: 'local', versionId: 'v1', origin: { kind: 'local' as const }, removed: false,
      sheets: [{ id: 'sheet', name: 'Roster', mappings: [{ fieldId: 'eid', column: 0, basis: 'manual' as const }, { fieldId: 'eid', column: 1, basis: 'manual' as const }] }] },
    { libraryId: 'result', versionId: 'v1', origin: { kind: 'workflow' as const }, removed: false,
      sheets: [{ id: 'sheet', name: 'Roster', mappings: [{ fieldId: 'eid', column: 0, basis: 'manual' as const }, { fieldId: 'fullName', column: 1, basis: 'manual' as const }] }] },
  ];
  const report = projectWorkbookCompatibility([workflow], library);
  assert.deepEqual(report.workflows[0].sources, []);
  assert.deepEqual(report.libraries[0].sheets[0].workflows[0].missingFields, ['fullName']);
  assert.deepEqual(report.libraries[0].sheets[0].workflows[0].duplicateFields, ['eid']);
  assert.equal(report.libraries.some(entry => entry.libraryId === 'result'), false);
});

it('retains the whole ordered last-used set and marks any lost source stale', () => {
  const workflow = { id: 'ocr', label: 'OCR', requiredWorkbookFields: ['eid'],
    workbookReference: { id: 'ocr-roster', keyFieldId: 'eid', mode: 'all', writableFields: [] } } as const;
  const report = projectWorkbookCompatibility([workflow], [
    { libraryId: 'one', versionId: 'v1', origin: { kind: 'local' }, removed: false,
      sheets: [{ id: 'sheet', name: 'One', mappings: [{ fieldId: 'eid', column: 0, basis: 'manual' as const }] }] },
  ], [{ workflowId: 'ocr', revision: 1, acceptedCommandId: '10000000-0000-4000-8000-000000000001', usedAt: '2026-11-08T00:00:00.000Z',
    sources: [{ libraryId: 'one', sheetId: 'sheet' }, { libraryId: 'lost', sheetId: 'sheet' }] }]);
  assert.equal(report.workflows[0].selectionState, 'stale');
  assert.deepEqual(report.workflows[0].lastUsed?.sources.map(source => source.libraryId), ['one', 'lost']);
  assert.equal(WorkbookCompatibilitySchema.safeParse({ ...report, workflows: report.workflows.map(workflow => ({
    ...workflow, selectionState: 'available' })) }).success, false);
  assert.equal(WorkbookCompatibilitySchema.safeParse({ ...report, workflows: report.workflows.map(workflow => ({
    ...workflow, staleSources: [] })) }).success, false);
});
