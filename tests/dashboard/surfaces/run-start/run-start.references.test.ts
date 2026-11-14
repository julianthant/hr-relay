import { createRunLaunchService } from '../../../../src/dashboard/surfaces/run-start/run-launch-model.js';
import { StartPlanRequestSchema, StartPlanWireSchema } from '../../../../src/models/dashboard/start-plan.js';
import { expect, it } from 'vitest';
import { workbookRowChoices } from '../../../../src/dashboard/surfaces/run-start/run-workbook-rows-model.js';
import { EditableWorkbookWireSchema } from '../../../../src/models/dashboard/workbooks.js';
import { launchWorkbookReferences } from '../../../../src/dashboard/surfaces/run-start/run-start-model.js';
import { WorkbookLibraryEntrySchema } from '../../../../src/models/dashboard/workbook-library.js';
const entry = WorkbookLibraryEntrySchema.parse({ libraryId: 'roster', version: 3, name: 'Roster.xlsx', updatedAt: '2026-11-01T00:00:00Z', rowCount: 1,
  worksheets: [{ id: 'people', name: 'People' }], metadata: { typeId: 'roster-type', sharePoint: null },
  type: { id: 'roster-type', name: 'Roster', keyFieldId: 'email', fields: ['email', 'fullName'], defaultWorkbookId: 'roster' },
  state: { libraryId: 'roster', revision: 4, selectedVersionId: 'current', removed: false, pinned: false, tags: [], origin: { kind: 'local' },
    versions: ['earlier', 'current'].map((id, index) => ({ id, name: id, snapshotId: id, version: index + 1, savedAt: '2026-11-01T00:00:00Z', source: 'operator' })) } });
const selections = { 'roster-type': { libraryId: 'roster', versionId: 'current', sheetId: 'people' } };
const sources = [{ libraryId: 'roster', versionId: 'current', sheetId: 'people' }];
it('sends the exact named version, selection identity for each parsed input', () => {
  expect(launchWorkbookReferences(['roster-type'], [entry], selections, 2, sources, false)).toEqual([
    { entry: 1, libraryId: 'roster', versionId: 'current', sheetId: 'people', expectedVersion: 3 },
    { entry: 2, libraryId: 'roster', versionId: 'current', sheetId: 'people', expectedVersion: 3 },
  ]);
});
it('refuses missing reference identities, unavailable named versions', () => {
  expect(() => launchWorkbookReferences(['missing'], [entry], selections, 1, sources, false)).toThrow();
  expect(() => launchWorkbookReferences(['roster-type'], [], selections, 1, sources, false)).toThrow();
  expect(() => launchWorkbookReferences(['roster-type'], [entry], { 'roster-type': { libraryId: 'roster', versionId: 'deleted', sheetId: 'people' } }, 1, sources, false)).toThrow();
  expect(() => launchWorkbookReferences(['roster-type'], [{ ...entry, state: { ...entry.state, origin: { kind: 'unavailable', code: 'WORKBOOK_OUTPUT_SOURCE_UNAVAILABLE' } } }], selections, 1, sources, false)).toThrow();
  expect(() => launchWorkbookReferences(['roster-type'], [entry], selections, 1, [], false)).toThrow();
});
it('pins an explicitly chosen historical worksheet even when its sheet ID differs from current', () => {
  const historical = { 'roster-type': { libraryId: 'roster', versionId: 'earlier', sheetId: 'former-people' } };
  const compatible = [{ libraryId: 'roster', versionId: 'earlier', sheetId: 'former-people' }];
  expect(launchWorkbookReferences(['roster-type'], [entry], historical, 1, compatible, false)).toEqual([
    { entry: 1, libraryId: 'roster', versionId: 'earlier', sheetId: 'former-people', expectedVersion: 3 },
  ]);
  expect(() => launchWorkbookReferences(['roster-type'], [entry], historical, 1, compatible, true)).toThrow();
});

it('pairs each selected physical row with its own ordinary entry and leaves single-source fresh references unselected', () => {
  const rows = [{ sheetId: 'people', rowId: 'first' }, { sheetId: 'people', rowId: 'second' }];
  expect(launchWorkbookReferences(['roster-type'], [entry], selections, 2, sources, false, { typeId: 'roster-type', rows })).toEqual(rows.map((selectedRow, index) => ({
    entry: index + 1, libraryId: 'roster', versionId: 'current', sheetId: 'people', expectedVersion: 3, selectedRow,
  })));
  expect(launchWorkbookReferences(['roster-type'], [entry], selections, 1, sources, false)[0]).not.toHaveProperty('selectedRow');
  expect(() => launchWorkbookReferences(['roster-type'], [entry], selections, 1, sources, false, { typeId: 'roster-type', rows })).toThrow();
});

it('projects full selected row choices into coordinate-only strict request references', () => {
  const workbook = EditableWorkbookWireSchema.parse({ name: 'Saved roster', libraryId: 'roster', themes: [], hasFormulas: false,
    sheets: ['people'].map(id => ({ id, name: id, width: 1, hidden: [],
      columnBindings: [{ id: 'email-column', sourceColumn: 0, sourceHeader: 'Email', fieldId: 'email', basis: 'manual' }],
      rows: [{ id: 'header', cells: [{ value: 'Email' }] }, { id: 'first', cells: [{ value: 'duplicate@example.test' }] }, { id: 'second', cells: [{ value: 'other@example.test' }] }],
    })),
  });
  const rows = workbookRowChoices(workbook, 'email', 'people');
  expect(rows[0]).toHaveProperty('sourceLabel'); expect(rows[0]).toHaveProperty('key');
  const references = launchWorkbookReferences(['roster-type'], [entry], selections, rows.length, sources, false, { typeId: 'roster-type', rows });
  const expected = ['first', 'second'].map((rowId, index) => ({ entry: index + 1, libraryId: 'roster', versionId: 'current', sheetId: 'people', expectedVersion: 3, selectedRow: { sheetId: 'people', rowId } }));
  expect(JSON.parse(JSON.stringify(references))).toEqual(expected);
  const parsed = StartPlanRequestSchema.parse({ workflowId: 'row-workflow', submissions: rows.map(() => ({ email: 'duplicate@example.test', mode: 'new-hire' })),
    dryRun: false, browserMode: 'headed', captureBrowserScreenshots: true, workbookReferences: references });
  expect(parsed.workbookReferences).toEqual(expected);
});

const request = StartPlanRequestSchema.parse({ workflowId: 'row-workflow', submissions: [{ email: 'one@example.test' }, { email: 'two@example.test' }, { email: 'three@example.test' }],
  dryRun: false, browserMode: 'headed', captureBrowserScreenshots: true,
  workbookReferences: [1, 2, 3].map(entry => ({ entry, libraryId: 'roster', versionId: 'current', sheetId: 'people', expectedVersion: 3, selectedRow: { sheetId: 'people', rowId: `row-${entry}` } })) });
const reference = (row: number) => ({ libraryId: 'roster', version: 3, versionId: 'current', versionName: 'Current', worksheets: entry.worksheets.map(sheet => ({ sheetId: sheet.id, name: sheet.name })), type: entry.type, selectedRow: { sheetId: 'people', rowId: `row-${row}` } });
const plan = StartPlanWireSchema.parse({ wireVersion: 1, startPlanId: '10000000-0000-4000-8000-000000000001', workflowId: request.workflowId, expectedVersion: 1,
  expiresAt: '2026-11-04T00:00:00Z', dryRun: false, priority: 'interactive', plannedBy: 'local-operator', configSnapshotId: '10000000-0000-4000-8000-000000000002',
  fingerprints: Object.fromEntries(['descriptorFingerprint', 'configFingerprint', 'ingressSchemaHash', 'canonicalInputSchemaHash', 'inputFingerprint'].map(key => [key, 'a'.repeat(64)])),
  planned: [1, 3].map(row => ({ logicalKey: `row-${row}`, title: `Row ${row}`, matchKey: `row-${row}`, workbookReferences: [reference(row)] })),
  refused: [{ entry: 2, code: 'input-invalid', message: 'Second row refused' }],
});
const unexpected = async (): Promise<never> => { throw new Error('Unexpected client call'); };
function launch(proposed: unknown) {
  return createRunLaunchService({ submitStartPlan: async () => StartPlanWireSchema.parse(proposed), rerunValues: unexpected, previewRerunWarnings: unexpected, dashboardDay: unexpected, itemAttemptHistory: unexpected }, 'local-operator');
}

it('matches each ordered accepted reference to its own entry after a partial refusal', async () => {
  expect(await launch(plan).preview(request)).toEqual(plan);
  expect(await launch({ ...plan, planned: [], refused: [1, 2, 3].map(entry => ({ entry, code: 'input-invalid', message: 'Refused' })) }).preview(request)).toMatchObject({ planned: [] });
});

it.each(['swapped', 'missing', 'foreign', 'wrong-version'] as const)('refuses a %s selected-row reference even when another entry could match it', async kind => {
  const proposed = structuredClone(plan);
  const refs = proposed.planned.map(entry => entry.workbookReferences);
  if (kind === 'swapped') { proposed.planned[0].workbookReferences = refs[1]; proposed.planned[1].workbookReferences = refs[0]; }
  else {
    const returned = proposed.planned[0].workbookReferences?.[0];
    expect(returned).toBeDefined();
    if (returned !== undefined) {
      if (kind === 'missing') delete returned.selectedRow;
      else if (kind === 'foreign') returned.selectedRow = { sheetId: 'foreign', rowId: 'row-1' };
      else returned.versionId = 'earlier';
    }
  }
  await expect(launch(proposed).preview(request)).rejects.toMatchObject({ name: 'RUN_LAUNCH_PLAN_IDENTITY_MISMATCH' });
});

it.each(['duplicate', 'out-of-range', 'incomplete'] as const)('refuses %s refusal coverage', async kind => {
  const proposed = structuredClone(plan);
  if (kind === 'duplicate') {
    proposed.planned = proposed.planned.slice(0, 1);
    proposed.refused = [proposed.refused[0], { ...proposed.refused[0] }];
  } else if (kind === 'out-of-range') {
    proposed.refused = [{ entry: 4, code: 'input-invalid', message: 'Foreign' }];
    proposed.planned[1].workbookReferences = [reference(2)];
  } else proposed.refused = [];
  await expect(launch(proposed).preview(request)).rejects.toMatchObject({ name: 'RUN_LAUNCH_PLAN_IDENTITY_MISMATCH' });
});

it('refuses missing returned references and selections outside the input vector', async () => {
  const proposed = structuredClone(plan);
  delete proposed.planned[0].workbookReferences;
  await expect(launch(proposed).preview(request)).rejects.toMatchObject({ name: 'RUN_LAUNCH_PLAN_IDENTITY_MISMATCH' });
  await expect(launch(plan).preview({ ...request, workbookReferences: [...(request.workbookReferences ?? []), { entry: 4, libraryId: 'roster', versionId: 'current', sheetId: 'people', expectedVersion: 3 }] })).rejects.toMatchObject({ name: 'RUN_LAUNCH_PLAN_IDENTITY_MISMATCH' });
});
