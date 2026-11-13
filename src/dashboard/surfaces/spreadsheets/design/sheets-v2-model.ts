import type { WorkbookCompatibility, WorkbookLibraryEntry } from '../../../../models/dashboard/workbook-library.js';
import { spreadsheetField } from '../../../../models/fields/workbook-fields.js';
import { cellText, type EditableSheet } from '../../../../rules/spreadsheets/workbook-io.js';
import { columnName } from '../spreadsheet-editor-model.js';
import { setSpreadsheetColumnField, spreadsheetHeaderRow } from '../spreadsheet-column-import-model.js';

export interface Field { readonly key: string; readonly label: string }
export interface VersionEntry { readonly id: string; readonly n: number; readonly at: string; readonly note: string }
/** One library entry as the list and detail pages show it. */
export interface Sheet {
  readonly id: string; readonly name: string; readonly sharePoint: string | null;
  readonly pinned: boolean; readonly tags: readonly string[];
  readonly workflow?: string; readonly run?: { readonly id: string; readonly day: string };
  readonly updatedAt: string; readonly version: number; readonly currentVersionId: string; readonly versions: readonly VersionEntry[];
}
export type Mapping = Readonly<Record<string, string | null>>;
export interface Cell { readonly text: string; readonly fill?: string; readonly align?: 'right' }
export interface Dataset { readonly headers: readonly string[]; readonly rows: readonly (readonly Cell[])[] }

const stampFormat = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
/** "2026-11-08T14:32:00Z" → "Nov 8, 14:32" in the operator's time zone. */
export const stamp = (iso: string): string => stampFormat.format(new Date(iso)).replace(' at ', ', ');

export const sheetOf = (entry: WorkbookLibraryEntry): Sheet => ({
  id: entry.libraryId, name: entry.name, sharePoint: entry.metadata.sharePoint?.url ?? null, pinned: entry.state.pinned, tags: entry.state.tags,
  workflow: entry.state.origin.kind === 'workflow' ? entry.state.origin.workflowLabel : undefined,
  run: entry.state.origin.kind === 'workflow' ? { id: entry.state.origin.runId, day: entry.state.origin.partitionDay } : undefined,
  updatedAt: entry.updatedAt, version: entry.state.versions.find(version => version.id === entry.state.selectedVersionId)?.version ?? entry.version, currentVersionId: entry.state.selectedVersionId,
  versions: entry.state.versions.map(version => ({ id: version.id, n: version.version, at: version.savedAt, note: version.name })).toSorted((a, b) => b.n - a.n),
});

export const tableOf = (sheet: Sheet): 'Pinned' | 'SharePoint' | 'Created' => sheet.pinned ? 'Pinned' : sheet.sharePoint ? 'SharePoint' : 'Created';
export const newestFirst = (sheets: readonly Sheet[]): readonly Sheet[] => sheets.toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt));
/** A run's workflow is an automatic tag, always first; the operator's own tags follow. */
export const tagsOf = (sheet: Sheet): readonly string[] => sheet.workflow ? [sheet.workflow, ...sheet.tags] : sheet.tags;
export const workflowTags = (sheets: readonly Sheet[]): readonly string[] => [...new Set(sheets.flatMap(sheet => sheet.workflow ? [sheet.workflow] : []))].toSorted();
export const operatorTags = (sheets: readonly Sheet[]): readonly string[] => [...new Set(sheets.flatMap(sheet => sheet.tags))].toSorted();
export const MAX_TAGS = 20, MAX_TAG_LENGTH = 40;
/** The list with `text` added, or undefined when the library would refuse it: blank, too long, a duplicate (any case) or past 20 tags. */
export function addTag(tags: readonly string[], text: string): readonly string[] | undefined {
  const tag = text.trim();
  if (!tag || tag.length > MAX_TAG_LENGTH || tags.length >= MAX_TAGS || tags.some(item => item.toLowerCase() === tag.toLowerCase())) return undefined;
  return [...tags, tag];
}

/** The fields the workflows read from a spreadsheet, in the order the workflows declare them. */
export const fieldsOf = (compatibility: WorkbookCompatibility): readonly Field[] =>
  [...new Set(compatibility.workflows.flatMap(workflow => workflow.requiredWorkbookFields))].map(key => ({ key, label: spreadsheetField(key).label }));

/** Header labels are unique and never blank, so a label picks exactly one column. */
export function datasetOf(sheet: EditableSheet): Dataset {
  const header = spreadsheetHeaderRow(sheet), used = new Set<string>();
  const headers = Array.from({ length: sheet.width }, (_, column) => {
    const text = cellText(sheet.rows[header - 1].cells[column]).trim() || `Column ${columnName(column)}`;
    let label = text, count = 1;
    while (used.has(label)) label = `${text} (${++count})`;
    used.add(label);
    return label;
  });
  return { headers, rows: sheet.rows.slice(header).map(row => headers.map((_, column): Cell => {
    const cell = row.cells[column], value = cell?.value;
    return { text: cell ? cellText(cell) : '', fill: cell?.background, align: typeof value === 'number' ? 'right' : undefined };
  })) };
}
export const mappingOf = (sheet: EditableSheet, fields: readonly Field[]): Mapping => {
  const { headers } = datasetOf(sheet);
  return Object.fromEntries(fields.map(field => { const column = sheet.columnBindings?.findIndex(binding => binding.fieldId === field.key) ?? -1; return [field.key, column < 0 ? null : headers[column]]; }));
};
/** A field lives in one column: choosing a column moves the field there. */
export function withMapping(sheet: EditableSheet, patch: Readonly<Record<string, string | null>>): EditableSheet {
  const { headers } = datasetOf(sheet);
  return Object.entries(patch).reduce((current, [fieldId, header]) => {
    const cleared = current.columnBindings?.flatMap((binding, column) => binding.fieldId === fieldId ? [column] : []).reduce((next, column) => setSpreadsheetColumnField(next, column, null), current) ?? current;
    return header === null ? cleared : setSpreadsheetColumnField(cleared, headers.indexOf(header), fieldId);
  }, sheet);
}
export const samplesOf = (dataset: Dataset, header: string): string => { const column = dataset.headers.indexOf(header); return column < 0 ? '' : dataset.rows.map(row => row[column].text).filter(Boolean).slice(0, 2).join(', '); };
export const missingFields = (fields: readonly Field[], mapping: Mapping): readonly Field[] => fields.filter(field => !mapping[field.key]);
export const notMatchedNote = (missing: readonly Field[]): string => missing.length === 0 ? '' : missing.length > 2 ? `${missing.length} fields not matched` : `${missing.map(field => field.label).join(' and ')} not matched`;
