import type { WorkflowCatalogEntry } from "../workflows/workflow-catalog-model.js";

/** The workflow the Explorer opens when its chosen one is unavailable: the first the catalog lists, or "" when it lists none. */
export function explorerRecoveryWorkflow(catalog: readonly WorkflowCatalogEntry[]): string {
  return catalog[0]?.id ?? "";
}

export function explorerWorkflowOptions(catalog: readonly WorkflowCatalogEntry[]) {
  return catalog.map(entry => ({ id: entry.id, title: entry.label, count: 0 }));
}
