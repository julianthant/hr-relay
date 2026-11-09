import { WorkbookLibraryEntrySchema, type WorkbookLibraryEntry } from '../../../../models/dashboard/workbook-library.js';
import type { SheetsScenario } from './sheets-design-mode.js';

export interface ColumnMatch { readonly label: string; readonly header: string | null }
export interface SheetFile { readonly id: string; readonly name: string; readonly rows: number; readonly updatedAt: string; readonly sharePoint?: boolean; readonly eid?: ColumnMatch; readonly person?: ColumnMatch }
export interface Reference { readonly id: string; readonly title: string; readonly workflow: string; readonly note: string; readonly file: SheetFile | null }
export interface ResultFile { readonly id: string; readonly name: string; readonly run: string; readonly createdAt: string }
export interface ResultGroup { readonly workflow: string; readonly files: readonly ResultFile[] }

const match = (label: string, header: string | null): ColumnMatch => ({ label, header });
const file = (id: string, name: string, rows: number, updatedAt: string, extra: Partial<SheetFile> = {}): SheetFile => ({ id, name, rows, updatedAt, ...extra });
const reference = (id: string, title: string, workflow: string, note: string, current: SheetFile | null): Reference => ({ id, title, workflow, note, file: current });

const OCR_ROSTER = file('ocr-roster', 'Example contact roster.xlsx', 412, '2026-11-03T16:20:00Z', { sharePoint: true, eid: match('EID column', 'Employee ID'), person: match('Name column', 'Full name') });
const ONBOARDING_ROSTER = file('onboarding-roster', 'Example onboarding hires.xlsx', 38, '2026-11-06T18:05:00Z', { eid: match('EID column', 'EID'), person: match('Name column', 'Hire name') });
const I9_HISTORY = file('i9-history', 'Example I-9 actions.csv', 1204, '2026-10-29T15:00:00Z', { eid: match('EID column', 'Employee ID'), person: match('Name column', null) });

export function sheetsReferences(scenario: SheetsScenario): readonly Reference[] {
  const empty = scenario === 'empty';
  return [
    reference('ocr-roster', 'OCR roster', 'Emergency Contact', 'Emergency Contact looks people up here.', empty ? null : OCR_ROSTER),
    reference('onboarding-roster', 'Onboarding roster', 'Onboarding', 'Onboarding looks new hires up here.', empty || scenario === 'missing' ? null : ONBOARDING_ROSTER),
    reference('i9-history', 'I-9 action history', 'I-9 Check', 'I-9 Check looks up earlier actions here.', empty ? null : I9_HISTORY),
  ];
}

const result = (run: string, name: string, createdAt: string): ResultFile => ({ id: `result-${run}`, name, run: `Run ${run}`, createdAt });
const ALL_RESULTS: readonly ResultGroup[] = [
  { workflow: 'Emergency Contact', files: [result('0412', 'Emergency contacts 0412.xlsx', '2026-11-07T17:14:00Z'), result('0398', 'Emergency contacts 0398.xlsx', '2026-11-05T22:40:00Z'), result('0371', 'Emergency contacts 0371.xlsx', '2026-11-02T19:05:00Z')] },
  { workflow: 'Separations', files: [result('0409', 'Separations 0409.xlsx', '2026-11-07T00:22:00Z'), result('0385', 'Separations 0385.xlsx', '2026-11-04T18:02:00Z'), result('0360', 'Separations 0360.xlsx', '2026-10-30T20:15:00Z'), result('0344', 'Separations 0344.xlsx', '2026-10-27T15:48:00Z')] },
  { workflow: 'Person Lookup', files: [result('0415', 'Person lookup 0415.xlsx', '2026-11-07T19:31:00Z'), result('0401', 'Person lookup 0401.xlsx', '2026-11-05T17:09:00Z')] },
  { workflow: 'Onboarding', files: [result('0390', 'Onboarding 0390.xlsx', '2026-11-04T23:50:00Z')] },
];
export function sheetsResults(scenario: SheetsScenario): readonly ResultGroup[] {
  if (scenario === 'empty') return [];
  if (scenario === 'many') return ALL_RESULTS;
  return ALL_RESULTS.slice(0, 2).map(group => ({ ...group, files: group.files.slice(0, 2) }));
}

const OTHER: readonly SheetFile[] = [
  file('o1', 'Example student applicants.xlsx', 86, '2026-11-01T17:00:00Z'), file('o2', 'Example parking permits.csv', 214, '2026-10-22T17:00:00Z', { sharePoint: true }),
  file('o3', 'Example department codes.xlsx', 57, '2026-10-18T17:00:00Z'), file('o4', 'Example badge requests.xlsx', 31, '2026-10-12T17:00:00Z'),
  file('o5', 'Example training sign-ins.csv', 640, '2026-10-05T17:00:00Z'), file('o6', 'Example office keys.xlsx', 19, '2026-09-30T17:00:00Z'),
];
export const sheetsOther = (scenario: SheetsScenario): readonly SheetFile[] => scenario === 'empty' ? [] : scenario === 'many' ? OTHER : OTHER.slice(0, 2);

const version = (id: string, name: string, savedAt: string, source: 'import' | 'operator' | 'sharepoint', n: number) => ({ id, name, version: n, snapshotId: `${id}-snap`, savedAt, source });
export function libraryEntry(item: SheetFile, kind: 'reference' | 'other'): WorkbookLibraryEntry {
  const versions = [version('v1', 'Original', '2026-09-15T17:00:00Z', 'import', 1), version('v2', 'Fall hires added', '2026-10-10T17:00:00Z', 'operator', 2), version('v3', item.sharePoint ? 'Synced from SharePoint' : 'Reviewed', item.updatedAt, item.sharePoint ? 'sharepoint' : 'operator', 3)];
  return WorkbookLibraryEntrySchema.parse({ libraryId: item.id, version: 3, name: item.name, worksheets: [{ id: 's1', name: 'Sheet1' }], rowCount: item.rows,
    metadata: { typeId: kind, sharePoint: item.sharePoint ? { url: 'https://example.sharepoint.com/sites/hr/example.xlsx', verifiedAt: item.updatedAt } : null },
    type: { id: kind, name: kind === 'reference' ? 'Workflow reference' : 'Other spreadsheet', fields: [], keyFieldId: null, defaultWorkbookId: null },
    state: { libraryId: item.id, revision: 3, selectedVersionId: 'v3', origin: { kind: 'local' }, removed: false, versions } });
}

export interface PreviewSheet { readonly headers: readonly string[]; readonly rows: readonly (readonly string[])[] }
const sample = (count: number, cell: (index: number) => string[]) => Array.from({ length: count }, (_, index) => cell(index));
const eid = (index: number) => String(10482917 + index * 13);
const person = (index: number) => `Example, Person ${String.fromCharCode(65 + index)}`;
export const REFERENCE_SHEETS: Readonly<Record<string, PreviewSheet>> = {
  'ocr-roster': { headers: ['Employee ID', 'Full name', 'Department', 'Work phone'], rows: sample(8, index => [eid(index), person(index), 'Example Dept', `555-01${String(index).padStart(2, '0')}`]) },
  'onboarding-roster': { headers: ['EID', 'Hire name', 'Start date', 'Department'], rows: sample(8, index => [eid(index), person(index), `11/${String(10 + index).padStart(2, '0')}/2026`, 'Example Dept']) },
  'i9-history': { headers: ['Employee ID', 'Employee', 'Action', 'Action date', 'Completed by'], rows: sample(8, index => [eid(index), person(index), index % 2 ? 'Section 2 done' : 'Reverify', `10/${String(20 + index).padStart(2, '0')}/2026`, 'Example, Reviewer']) },
};
export const sheetSamples = (sheet: PreviewSheet, header: string): string => { const column = sheet.headers.indexOf(header); return column < 0 ? '' : sheet.rows.slice(0, 3).map(row => row[column]).join(' · '); };

export const IMPORT_FILE = { name: 'Example contacts export.xlsx', rows: 398, sheet: 'Contacts' };
export const IMPORT_COLUMNS = [
  { header: 'Employee ID', sample: '10482917 · 10482930 · 10482943', role: 'eid' }, { header: 'Full name', sample: 'Example, Person A · Example, Person B · Example, Person C', role: 'person' },
  { header: 'Department', sample: 'Example Dept', role: null }, { header: 'Work phone', sample: '555-0100', role: null }, { header: 'Emergency phone', sample: '555-0142', role: null },
] as const;
