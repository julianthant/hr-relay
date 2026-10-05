import type { WorkflowCatalogEntry } from "./workflow-catalog-model.js";
import { workflowNavigationGroups } from "./workflow-rail-model.js";

export function runPickerGroups(entries: readonly WorkflowCatalogEntry[], query: string) {
  const words = query.trim().toLowerCase().split(/\s+/u).filter(Boolean);
  return workflowNavigationGroups(entries.filter(flow => words.every(word => `${flow.label} ${flow.categoryId} ${flow.code ?? ""}`.toLowerCase().includes(word))));
}
