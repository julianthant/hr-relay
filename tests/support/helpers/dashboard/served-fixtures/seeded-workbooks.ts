import type { WorkbookLibraryService, WorkbookReferenceWorkflow } from "../../../../../src/backend/workbooks/workbook-library-service.js";

export function seedReferenceWorkbooks(library: WorkbookLibraryService, workflows: readonly WorkbookReferenceWorkflow[]) {
  for (const workflow of workflows) {
    const reference = workflow.workbookReference;
    if (reference === undefined) continue;
    const fields = [...new Set([reference.keyFieldId, ...workflow.requiredWorkbookFields])];
    library.create({
      name: `${workflow.label} reference.xlsx`,
      themes: [], hasFormulas: false,
      sheets: [{
        id: "reference", name: "Reference", width: fields.length, hidden: [], headerRow: 1,
        columnBindings: fields.map((fieldId, column) => ({
          id: `field-${column}`, sourceColumn: column, sourceHeader: fieldId, fieldId, basis: "manual",
        })),
        rows: [{ id: "header", cells: fields.map(value => ({ value })) }, {
          id: "sample", cells: fields.map(field => ({ value: field === "eid" ? "10000001" : field === "email" ? "sample@example.com" : null })),
        }],
      }],
    });
  }
}
