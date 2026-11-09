// Design lane (never merged): synthetic fixtures and pure helpers for the Spreadsheets page mock.
export type FieldKey = 'eid' | 'name' | 'email';
export interface Field { readonly key: FieldKey; readonly label: string; readonly usedBy: readonly string[] }
export interface VersionEntry { readonly n: number; readonly at: string; readonly note: string }
export type DatasetKey = 'roster' | 'i9' | 'terminated' | 'notes';
export interface Worksheet { readonly name: string; readonly data: DatasetKey }
export interface Sheet {
  readonly id: string; readonly name: string; readonly tags: readonly string[]; readonly pinned: boolean;
  readonly sharePoint: string | null; readonly from: { readonly id: string; readonly version: number } | null;
  readonly workflow?: string; readonly run?: string;
  readonly createdAt: string; readonly updatedAt: string; readonly versions: readonly VersionEntry[];
  readonly mapping: Readonly<Record<FieldKey, string | null>>;
  /** The worksheets in the workbook; runs read `runsSheet`, the mapping maps that sheet, the others are view-only. */
  readonly worksheets: readonly Worksheet[]; readonly runsSheet: string;
}

// Fields come from the workflows' own declarations: the Emergency Contact and Person Lookup roster fields (eid, fullName) and Onboarding's email input.
export const FIELDS: readonly Field[] = [
  { key: 'eid', label: 'Employee ID', usedBy: ['Emergency Contact', 'Person Lookup'] },
  { key: 'name', label: 'Legal name', usedBy: ['Emergency Contact', 'Person Lookup'] },
  { key: 'email', label: 'Email', usedBy: ['Onboarding'] },
];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "2026-11-08T14:32" → "Nov 8, 14:32" without a time zone, so frames are identical on every machine. */
export const stamp = (iso: string): string => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}, ${iso.slice(11, 16)}`;
export const NOW = '2026-11-08T15:40';

const v = (n: number, at: string, note: string): VersionEntry => ({ n, at, note });
const sync = (n: number, at: string) => v(n, at, 'Synced from SharePoint');
const ROSTER_MAP = { eid: 'Employee ID', name: 'Full name', email: 'Work email' } as const;

const base = (id: string, name: string, extra: Partial<Sheet> & { data?: DatasetKey } = {}): Sheet => {
  const { data = 'roster', ...rest } = extra;
  return { id, name, tags: [], pinned: false, sharePoint: null, from: null, createdAt: '2026-10-20T09:00', updatedAt: '2026-10-20T09:00',
    versions: [v(1, '2026-10-20T09:00', 'Imported')], mapping: ROSTER_MAP, worksheets: [{ name: 'Sheet1', data }], runsSheet: 'Sheet1', ...rest };
};

const PINNED: readonly Sheet[] = [
  base('roster', 'Contact roster', { tags: ['HR', 'Fall'], pinned: true, sharePoint: 'https://example.sharepoint.com/sites/hr/contact-roster.xlsx', createdAt: '2026-10-01T09:12', updatedAt: '2026-11-08T14:32', worksheets: [{ name: 'Roster', data: 'roster' }, { name: 'Terminated', data: 'terminated' }, { name: 'Notes', data: 'notes' }], runsSheet: 'Roster',
    versions: [sync(6, '2026-11-08T14:32'), v(5, '2026-11-06T08:05', 'Rolled back to v3'), sync(4, '2026-11-03T09:12'), sync(3, '2026-10-20T09:12'), sync(2, '2026-10-12T09:12'), sync(1, '2026-10-01T09:12')] }),
  base('i9', 'I-9 tracker', { tags: ['I-9'], pinned: true, createdAt: '2026-10-05T11:00', updatedAt: '2026-11-07T09:10', data: 'i9', mapping: { eid: 'EID', name: 'Employee', email: null },
    versions: [v(3, '2026-11-07T09:10', 'Edited'), v(2, '2026-10-21T13:40', 'Merged from I-9 intake'), v(1, '2026-10-05T11:00', 'Imported')] }),
];
const SHAREPOINT: readonly Sheet[] = [
  base('hires', 'Onboarding hires', { tags: ['HR', 'Fall'], sharePoint: 'https://example.sharepoint.com/sites/hr/hires.xlsx', createdAt: '2026-10-10T10:00', updatedAt: '2026-11-06T18:05', mapping: { eid: 'Employee ID', name: 'Full name', email: 'Work email' },
    versions: [sync(4, '2026-11-06T18:05'), sync(3, '2026-10-30T18:05'), sync(2, '2026-10-17T18:05'), sync(1, '2026-10-10T10:00')] }),
  base('parking', 'Parking permits', { tags: ['Facilities'], sharePoint: 'https://example.sharepoint.com/sites/ops/parking.xlsx', createdAt: '2026-09-22T10:00', updatedAt: '2026-10-22T17:00', mapping: { eid: 'Employee ID', name: null, email: null },
    versions: [sync(2, '2026-10-22T17:00'), sync(1, '2026-09-22T10:00')] }),
];
// A run's spreadsheet is named by its queue code, exactly as the queue card shows it.
const WORKFLOW_BY_PREFIX: Readonly<Record<string, string>> = { EC: 'Emergency Contact', PL: 'Person Lookup', SP: 'Separations', OB: 'Onboarding' };
const run = (code: string, from: Sheet, at: string, tags: readonly string[]): Sheet =>
  base(`run-${code}`, code, { workflow: WORKFLOW_BY_PREFIX[code.slice(0, 2)], run: code, tags, from: { id: from.id, version: from.versions[0].n }, createdAt: at, updatedAt: at, versions: [v(1, at, 'Created by a run')] });
const [ROSTER, I9] = PINNED;
const CREATED_ALL: readonly Sheet[] = [
  run('EC51820377', ROSTER, '2026-11-08T14:40', ['HR', 'Fall', '2026', 'Student', 'Payroll']),
  run('PL33065442', I9, '2026-11-07T19:31', ['I-9']),
  base('applicants', 'Student applicants', { tags: ['Fall'], createdAt: '2026-11-01T17:00', updatedAt: '2026-11-01T17:00' }),
];
const CREATED_MORE: readonly Sheet[] = [
  run('SP20481136', ROSTER, '2026-11-07T00:22', ['HR']), run('EC51773902', ROSTER, '2026-11-05T22:40', ['HR']),
  run('OB41920655', SHAREPOINT[0], '2026-11-04T23:50', ['HR', 'Fall']), run('SP20466871', ROSTER, '2026-11-04T18:02', ['HR']),
  base('badges', 'Badge requests', { createdAt: '2026-10-30T12:00', updatedAt: '2026-10-30T12:00' }), run('EC51690418', ROSTER, '2026-11-02T19:05', ['HR']),
  base('keys', 'Office keys', { tags: ['Facilities'], createdAt: '2026-09-30T17:00', updatedAt: '2026-10-02T15:10', versions: [v(2, '2026-10-02T15:10', 'Edited'), v(1, '2026-09-30T17:00', 'Imported')] }),
  run('SP20391254', ROSTER, '2026-10-27T15:48', ['HR']), run('SP20437760', ROSTER, '2026-10-30T20:15', ['HR']),
  base('codes', 'Department codes', { createdAt: '2026-10-18T17:00', updatedAt: '2026-10-18T17:00' }), run('PL33071904', I9, '2026-10-25T16:00', ['I-9']), run('EC51655230', ROSTER, '2026-10-24T14:20', ['HR']),
];

export type Scenario = 'all' | 'many' | 'empty';
export const initialSheets = (scenario: Scenario): readonly Sheet[] =>
  scenario === 'empty' ? [] : [...PINNED, ...SHAREPOINT, ...CREATED_ALL, ...(scenario === 'many' ? CREATED_MORE : [])];

export const tableOf = (sheet: Sheet): 'Pinned' | 'SharePoint' | 'Created' => sheet.pinned ? 'Pinned' : sheet.sharePoint ? 'SharePoint' : 'Created';
export const newestFirst = (sheets: readonly Sheet[]): readonly Sheet[] => sheets.toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt));
/** A run's workflow is an automatic tag, always first. */
export const tagsOf = (sheet: Sheet): readonly string[] => sheet.workflow ? [sheet.workflow, ...sheet.tags] : sheet.tags;
export const allTags = (sheets: readonly Sheet[]): readonly string[] => [...new Set(sheets.flatMap(tagsOf))].toSorted();

/** Merge preview: Employee ID decides which rows exist; the numbers are fixed fixtures. */
export const mergePreview = (): { added: number; updated: number } => ({ added: 12, updated: 3 });
/** A run-made copy merges back only into the spreadsheet it was made from, and only when that one has no SharePoint link. */
export const mergeOriginal = (sheet: Sheet, sheets: readonly Sheet[]): Sheet | undefined => sheet.run ? sheets.find(item => item.id === sheet.from?.id && !item.sharePoint) : undefined;

export interface Cell { readonly text: string; readonly bold?: boolean; readonly fill?: string; readonly align?: 'right' }
export interface Dataset { readonly headers: readonly string[]; readonly rows: readonly (readonly Cell[])[] }
const eid = (i: number) => String(10482917 + i * 13);
const person = (i: number) => `Example, Person ${String.fromCharCode(65 + (i % 26))}${i > 25 ? i : ''}`;
const dept = ['Example Dept', 'Sample Office', 'Test Unit'];
const date = (i: number) => `11/${String(1 + (i % 28)).padStart(2, '0')}/2026`;
export const DATASETS: Readonly<Record<DatasetKey, Dataset>> = {
  terminated: { headers: ['Employee ID', 'Full name', 'Separation date', 'Reason'], rows: Array.from({ length: 9 }, (_, i): Cell[] => [{ text: eid(40 + i) }, { text: person(10 + i) }, { text: date(i + 3) }, { text: i % 3 ? 'Resigned' : 'End of term' }]) },
  notes: { headers: ['Note', 'Added'], rows: ['Roster comes from HR each Monday.', 'Fall hires are added after orientation.', 'Do not edit the Terminated sheet.', 'Ask Facilities for badge status.', 'Phone numbers are work lines only.'].map((text, i): Cell[] => [{ text }, { text: date(i + 1) }]) },
  roster: { headers: ['Employee ID', 'Full name', 'Work email', 'Department', 'Work phone', 'Emergency phone', 'Start date', 'Hourly rate'],
    rows: Array.from({ length: 28 }, (_, i): Cell[] => [{ text: eid(i), bold: i === 3 }, { text: person(i), bold: i === 3, fill: i === 3 ? '#fff2cc' : undefined }, { text: `person${i}@example.org` }, { text: dept[i % 3] }, { text: `555-01${String(i).padStart(2, '0')}` }, { text: i % 4 ? `555-02${String(i).padStart(2, '0')}` : '', fill: i % 4 ? undefined : '#f4cccc' }, { text: date(i) }, { text: `$${(22 + i * 0.5).toFixed(2)}`, align: 'right' }]) },
  i9: { headers: ['EID', 'Employee', 'Notify address', 'Action', 'Action date', 'Completed by'],
    rows: Array.from({ length: 24 }, (_, i): Cell[] => [{ text: eid(i) }, { text: person(i) }, { text: `notify${i}@example.org` }, { text: i % 2 ? 'Section 2 done' : 'Reverify', fill: i % 2 ? '#d9ead3' : '#fce5cd' }, { text: date(i) }, { text: 'Example, Reviewer' }]) },
};
export const samplesOf = (dataset: Dataset, header: string): string => { const column = dataset.headers.indexOf(header); return column < 0 ? '' : dataset.rows.map(row => row[column].text).filter(Boolean).slice(0, 2).join(', '); };

/** Relay's guess for a field from header names, then sample values. */
export const guessColumn = (key: FieldKey, headers: readonly string[]): string | null => {
  const pattern = { eid: /(employee id|^eid$|empl id)/i, name: /(full name|legal name|^name$|employee$)/i, email: /e-?mail/i }[key];
  return headers.find(header => pattern.test(header)) ?? null;
};

export const IMPORT_FILE = { name: 'Contacts export.xlsx', suggested: 'Contacts export', rows: 398, size: '42 KB' };
export const IMPORT_DATASET: Dataset = { headers: ['Employee ID', 'Full name', 'Contact address', 'Department', 'Work phone'],
  rows: Array.from({ length: 8 }, (_, i): Cell[] => [{ text: eid(i) }, { text: person(i) }, { text: `contact${i}@example.org` }, { text: dept[i % 3] }, { text: `555-01${String(i).padStart(2, '0')}` }]) };

const NOTES_IMPORT: Dataset = { headers: ['Read me'], rows: ['Contacts export from the HR system.', 'Sheet Archive holds old records.'].map((text): Cell[] => [{ text }]) };
const ARCHIVE_IMPORT: Dataset = { headers: ['ID number', 'Name', 'Left on'], rows: Array.from({ length: 6 }, (_, i): Cell[] => [{ text: eid(60 + i) }, { text: person(i + 5) }, { text: date(i + 8) }]) };
export const IMPORT_SHEETS: readonly { readonly name: string; readonly dataset: Dataset; readonly data: DatasetKey }[] = [
  { name: 'Cover', dataset: NOTES_IMPORT, data: 'notes' }, { name: 'Contacts', dataset: IMPORT_DATASET, data: 'roster' }, { name: 'Archive', dataset: ARCHIVE_IMPORT, data: 'terminated' },
];
/** The sheet whose headers match the most fields. */
export const bestSheet = (): string => IMPORT_SHEETS.map(sheet => ({ name: sheet.name, score: FIELDS.filter(field => guessColumn(field.key, sheet.dataset.headers)).length })).sort((a, b) => b.score - a.score)[0].name;
/** Workflow tags first (A-Z), then the user's own tags (A-Z). */
export const tagGroups = (sheets: readonly Sheet[]): { workflows: readonly string[]; tags: readonly string[] } => ({
  workflows: [...new Set(sheets.flatMap(sheet => sheet.workflow ? [sheet.workflow] : []))].toSorted(),
  tags: [...new Set(sheets.flatMap(sheet => sheet.tags))].toSorted(),
});
