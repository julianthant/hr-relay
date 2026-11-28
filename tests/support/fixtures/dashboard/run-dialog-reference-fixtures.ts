/** The reference spreadsheet a Run dialog story serves so the Spreadsheets field works. Browser-safe. */
import type { DashboardClient } from "../../../../src/dashboard/client/index.js";
import { WorkbookLibraryEntrySchema, WorkbookLibraryVersionViewSchema, projectWorkbookCompatibility } from "../../../../src/models/dashboard/workbook-library.js";
import { CRM_DOCUMENT_ROSTER_FIELDS } from "../../../../src/models/workflows/crm-doc-download/documents.js";
import { RUN_DIALOG_CRM, RUN_DIALOG_TYPED, RUN_DIALOG_WORKFLOW } from "./run-dialog-story-fixtures.js";

/** What the library serves when one saved spreadsheet is bound to the reference workflow's key field: the Spreadsheets field works. */
export interface ReferenceShape { readonly workflowId: string; readonly label: string; readonly keyFieldId: string; readonly fields: readonly string[]; readonly row: readonly (string | null)[]; readonly writableFields?: readonly string[] }
const PERSON_LOOKUP: ReferenceShape = { workflowId: RUN_DIALOG_WORKFLOW, label: "Person Lookup", keyFieldId: "eid", fields: ["eid"], row: [RUN_DIALOG_TYPED] };
export function runDialogReferenceReads(names: readonly string[] = ["First"], typeId = "roster-type", shape: ReferenceShape = PERSON_LOOKUP, libraryName = "Roster", earlierVersion = false): Partial<DashboardClient> {
  const entry = WorkbookLibraryEntrySchema.parse({ libraryId: "roster", name: libraryName, version: earlierVersion ? 2 : 1, updatedAt: "2026-11-01T00:00:00Z", rowCount: 2,
    worksheets: names.map((name, index) => ({ id: index === 0 ? "first" : `sheet-${index}`, name })), metadata: { typeId, sharePoint: null },
    type: { id: typeId, name: "Roster", keyFieldId: shape.keyFieldId, fields: [...shape.fields], defaultWorkbookId: "roster" },
    state: { libraryId: "roster", revision: 1, selectedVersionId: "version", removed: false, pinned: false, tags: [], origin: { kind: "local" },
      versions: [...earlierVersion ? [{ id: "earlier", name: "Before audit", snapshotId: "earlier-snapshot", version: 1, savedAt: "2026-10-01T00:00:00Z", source: "operator" }] : [],
        { id: "version", name: "Reviewed", snapshotId: "snapshot", version: earlierVersion ? 2 : 1, savedAt: "2026-11-01T00:00:00Z", source: "operator" }] } });
  const viewOf = (versionId: string) => WorkbookLibraryVersionViewSchema.parse({ libraryId: "roster", version: entry.state.versions.find(version => version.id === versionId), workbook: {
    name: "Roster", libraryId: "roster", themes: [], hasFormulas: false,
    sheets: entry.worksheets.map(sheet => ({ ...sheet, width: shape.fields.length, hidden: [],
      columnBindings: shape.fields.map((field, column) => ({ id: `column-${column}`, sourceColumn: column, sourceHeader: field, fieldId: field, basis: "manual" as const })),
      rows: [{ id: "header", cells: shape.fields.map(value => ({ value })) }, { id: "row-1", cells: shape.row.map(value => ({ value })) }] })),
  } });
  return {
    workbookList: async () => [], workbookCatalog: async () => [entry], workbookTypes: async () => [entry.type], workbookLibraryVersion: async (_libraryId: string, versionId: string) => viewOf(versionId),
    workbookCompatibility: async () => projectWorkbookCompatibility([{ id: shape.workflowId, label: shape.label, requiredWorkbookFields: [...shape.fields],
      workbookReference: { id: typeId, keyFieldId: shape.keyFieldId, mode: "keys", writableFields: shape.writableFields ?? [] } }],
    [{ libraryId: "roster", versionId: "version", origin: { kind: "local" }, removed: false,
      sheets: entry.worksheets.map(sheet => ({ ...sheet, mappings: shape.fields.map((fieldId, column) => ({ fieldId, column, basis: "manual" as const })) })) }]),
  };
}
export const RUN_DIALOG_REFERENCE_READS = runDialogReferenceReads();
/** A roster the CRM descriptor can read: its required fields, one person's row on every worksheet. */
export const RUN_DIALOG_CRM_SHAPE: ReferenceShape = { workflowId: RUN_DIALOG_CRM, label: "CRM Document Download", keyFieldId: "email", fields: CRM_DOCUMENT_ROSTER_FIELDS,
  row: ["fixture@example.test", "Ada", "Lovelace", null, "Ada", "Lovelace", null] };
