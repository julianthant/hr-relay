import type { ExplorerWorkflowWire } from "../../../models/dashboard/explorer.js";
import type { WorkflowCatalogEntry } from "../workflows/workflow-catalog-model.js";

export type ExplorerPickerEntry = Readonly<{ id: string; title: string; depth: number }>;

const startedBy = (workflow: ExplorerWorkflowWire): readonly string[] =>
  workflow.reviewSpec.steps.flatMap(step => step.blocks.flatMap(block => block.kind === "starts" ? [block.workflowId] : []));

/** The served main workflows in catalog order under their served names; sub-workflows are never listed. */
export function explorerPickerEntries(catalog: readonly WorkflowCatalogEntry[]): readonly ExplorerPickerEntry[] {
  return catalog.filter(entry => entry.source === "served").map(entry => ({ id: entry.id, title: entry.label, depth: 0 }));
}

/** The main workflow a choice shows: itself when listed, else the listed workflow that starts it (at any depth), else the first listed one. */
export function explorerMainWorkflowId(chosen: string, entries: readonly ExplorerPickerEntry[], wire: readonly ExplorerWorkflowWire[] | undefined): string | undefined {
  if (entries.some(entry => entry.id === chosen)) return chosen;
  const byId = new Map((wire ?? []).map(workflow => [String(workflow.id), workflow]));
  const reaches = (fromId: string, targetId: string, seen: Set<string>): boolean => {
    const workflow = byId.get(fromId);
    if (workflow === undefined || seen.has(fromId)) return false;
    seen.add(fromId);
    return startedBy(workflow).some(childId => childId === targetId || reaches(childId, targetId, seen));
  };
  return (chosen !== "" ? entries.find(entry => reaches(entry.id, chosen, new Set())) : undefined)?.id ?? entries[0]?.id;
}
