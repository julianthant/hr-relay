/** The reference spreadsheet a Run dialog story serves so the Spreadsheets field works. Browser-safe. */
import type { DashboardClient } from "../../../../src/dashboard/client/index.js";
import { WorkbookLibraryEntrySchema, WorkbookLibraryVersionViewSchema, projectWorkbookCompatibility } from "../../../../src/models/dashboard/workbook-library.js";
import { RUN_DIALOG_TYPED, RUN_DIALOG_WORKFLOW } from "./run-dialog-story-fixtures.js";

/** What the library serves when one saved spreadsheet is bound to the reference workflow's key field: the Spreadsheets field works. */
export function runDialogReferenceReads(names: readonly string[] = ["First"]): Partial<DashboardClient> {
  const entry = WorkbookLibraryEntrySchema.parse({ libraryId: "roster", name: "Roster", version: 1, updatedAt: "2026-11-01T00:00:00Z", rowCount: 2,
    worksheets: names.map((name, index) => ({ id: index === 0 ? "first" : `sheet-${index}`, name })), metadata: { typeId: "roster-type", sharePoint: null },
    type: { id: "roster-type", name: "Roster", keyFieldId: "eid", fields: ["eid"], defaultWorkbookId: "roster" },
    state: { libraryId: "roster", revision: 1, selectedVersionId: "version", removed: false, pinned: false, tags: [], origin: { kind: "local" },
      versions: [{ id: "version", name: "Reviewed", snapshotId: "snapshot", version: 1, savedAt: "2026-11-01T00:00:00Z", source: "operator" }] } });
  const view = WorkbookLibraryVersionViewSchema.parse({ libraryId: "roster", version: entry.state.versions[0], workbook: {
    name: "Roster", libraryId: "roster", themes: [], hasFormulas: false,
    sheets: entry.worksheets.map(sheet => ({ ...sheet, width: 1, hidden: [],
      columnBindings: [{ id: "column-0", sourceColumn: 0, sourceHeader: "eid", fieldId: "eid", basis: "manual" }],
      rows: [{ id: "header", cells: [{ value: "eid" }] }, ...[RUN_DIALOG_TYPED].map(value => ({ id: `row-${value}`, cells: [{ value }] }))] })),
  } });
  return {
    workbookList: async () => [], workbookCatalog: async () => [entry], workbookTypes: async () => [entry.type], workbookLibraryVersion: async () => view,
    workbookCompatibility: async () => projectWorkbookCompatibility([{ id: RUN_DIALOG_WORKFLOW, label: "Person Lookup", requiredWorkbookFields: ["eid"],
      workbookReference: { id: "roster-type", keyFieldId: "eid", mode: "keys", writableFields: [] } }],
    [{ libraryId: "roster", versionId: "version", origin: { kind: "local" }, removed: false,
      sheets: entry.worksheets.map(sheet => ({ ...sheet, mappings: [{ fieldId: "eid", column: 0, basis: "manual" as const }] })) }]),
  };
}
export const RUN_DIALOG_REFERENCE_READS = runDialogReferenceReads();
