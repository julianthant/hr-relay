import type { ExplorerWorkflowWire } from "../../../models/dashboard/explorer.js";
import type { WorkflowCatalogEntry } from "../workflows/workflow-catalog-model.js";

export type ExplorerPickerEntry = Readonly<{ id: string; title: string; depth: number }>;

const startedBy = (workflow: ExplorerWorkflowWire): readonly string[] =>
  workflow.reviewSpec.steps.flatMap(step => step.blocks.flatMap(block => block.kind === "starts" ? [block.workflowId] : []));

/**
 * The served workflows in catalog order under their served names, each followed by the workflows it starts, depth first.
 * A workflow appears once; before the wire arrives only the served workflows are listed.
 */
export function explorerPickerEntries(catalog: readonly WorkflowCatalogEntry[], wire: readonly ExplorerWorkflowWire[] | undefined): readonly ExplorerPickerEntry[] {
  const roots = catalog.filter(entry => entry.source === "served");
  const byId = new Map((wire ?? []).map(workflow => [String(workflow.id), workflow]));
  const listed = new Set(roots.map(entry => entry.id));
  const entries: ExplorerPickerEntry[] = [];
  const descend = (id: string, depth: number) => {
    const workflow = byId.get(id);
    if (workflow === undefined) return;
    for (const childId of startedBy(workflow)) {
      const child = byId.get(childId);
      if (child === undefined || listed.has(childId)) continue;
      listed.add(childId);
      entries.push({ id: childId, title: child.label, depth });
      descend(childId, depth + 1);
    }
  };
  for (const root of roots) { entries.push({ id: root.id, title: root.label, depth: 0 }); descend(root.id, 1); }
  return entries;
}
