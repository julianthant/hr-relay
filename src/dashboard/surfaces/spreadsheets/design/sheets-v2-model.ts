import type { WorkbookCompatibility, WorkbookLibraryEntry, WorkbookLibrarySyncStatus } from '../../../../models/dashboard/workbook-library.js';
import { ERROR_CATALOG } from '../../../../models/failures/error-catalog.js';
import { spreadsheetField } from '../../../../models/fields/workbook-fields.js';
import { cellText } from '../../../../rules/spreadsheets/cell-text.js';
import type { EditableSheet, EditableWorkbook } from '../../../../rules/spreadsheets/workbook-io.js';
import { columnName } from '../spreadsheet-editor-model.js';
import { setSpreadsheetColumnField, spreadsheetHeaderRow } from '../spreadsheet-column-import-model.js';
import { formatDayTime } from '../../../lib/date-format.js';

export interface Field { readonly key: string; readonly label: string }
export interface VersionEntry { readonly id: string; readonly n: number; readonly at: string; readonly name: string; readonly inUse: boolean }
/** One library entry as the list and detail pages show it. */
export interface Sheet {
  readonly id: string; readonly name: string; readonly sharePoint: string | null;
  readonly pinned: boolean; readonly tags: readonly string[];
  readonly workflow?: string; readonly run?: { readonly id: string; readonly day: string };
  /** Served on SharePoint-linked entries only. */
  readonly sync?: WorkbookLibrarySyncStatus;
  readonly updatedAt: string; readonly version: number; readonly currentVersionId: string; readonly versionName: string; readonly versions: readonly VersionEntry[];
}
/** A picked file before it joins the library; `id` is unique to one pick for the session, and `document` is absent while the file is read. */
export interface ImportDraft { readonly id: string; readonly name: string; readonly tags: readonly string[]; readonly document?: EditableWorkbook }
export type Mapping = Readonly<Record<string, string | null>>;
export interface Cell { readonly text: string; readonly fill?: string; readonly align?: 'right' }
export interface Dataset { readonly headers: readonly string[]; readonly rows: readonly (readonly Cell[])[] }

/** "2026-11-08T14:32:00Z" → "Nov 8, 2:32 PM" in the operator's time zone. */
export const stamp = (iso: string): string => formatDayTime(iso);

export const sheetOf = (entry: WorkbookLibraryEntry): Sheet => {
  const versions = entry.state.versions.map(version => ({ id: version.id, n: version.version, at: version.savedAt, name: version.name,
    inUse: version.id === entry.state.selectedVersionId || (entry.heldVersionIds?.includes(version.id) ?? false),
  })).toSorted((a, b) => b.n - a.n);
  return {
  id: entry.libraryId, name: entry.name, sharePoint: entry.metadata.sharePoint?.url ?? null, pinned: entry.state.pinned, tags: entry.state.tags,
  workflow: entry.state.origin.kind === 'workflow' ? entry.state.origin.workflowLabel : undefined,
  run: entry.state.origin.kind === 'workflow' ? { id: entry.state.origin.runId, day: entry.state.origin.partitionDay } : undefined,
  sync: entry.sync, updatedAt: entry.updatedAt, version: entry.state.versions.find(version => version.id === entry.state.selectedVersionId)?.version ?? entry.version, currentVersionId: entry.state.selectedVersionId,
    versions, versionName: versions.find(version => version.id === entry.state.selectedVersionId)?.name ?? '',
  };
};

const SYNC_WHY = ['WORKBOOK_SYNC_FAILED', 'WORKBOOK_SYNC_NOT_APPLIED', 'WORKBOOK_VERSION_CONFLICT', 'WORKBOOK_METADATA_UNSUPPORTED'] as const;
/** The plain sentence for why the last sync failed, or undefined when it did not fail; a code outside the sync set gets the generic sync sentence. */
export function syncFailureWhy(sheet: Sheet): string | undefined {
  if (sheet.sync?.lastResult !== 'failed') return undefined;
  const code = SYNC_WHY.find(known => known === sheet.sync?.lastFailureCode) ?? 'WORKBOOK_SYNC_FAILED';
  return ERROR_CATALOG[code].text;
}

export const tableOf = (sheet: Sheet): 'Pinned' | 'Spreadsheets' => sheet.pinned ? 'Pinned' : 'Spreadsheets';
export const newestFirst = (sheets: readonly Sheet[]): readonly Sheet[] => sheets.toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt));
/** A run's workflow is an automatic tag, always first; the operator's own tags follow. */
export const tagsOf = (sheet: Sheet): readonly string[] => sheet.workflow ? [sheet.workflow, ...sheet.tags] : sheet.tags;
export const workflowTags = (sheets: readonly Sheet[]): readonly string[] => [...new Set(sheets.flatMap(sheet => sheet.workflow ? [sheet.workflow] : []))].toSorted();
/** The library's tag bank: every tag a spreadsheet carries, A-Z. */
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
/** How many of the fields have a column. */
export const matchedCount = (fields: readonly Field[], mapping: Mapping): number => fields.filter(field => mapping[field.key]).length;
