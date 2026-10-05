import type { RunStartWorkflow } from "./run-start.js";
import { MOCK_WORKFLOWS } from "./workflow-mock-catalog.js";
import { workflowNavigationGroups, workflowRailCategory, type WorkflowNavigationEntry } from "./workflow-rail-model.js";

export interface RunPickerEntry extends WorkflowNavigationEntry { readonly runnable: boolean; readonly code?: string }

export function runPickerEntries(workflows: readonly RunStartWorkflow[], includePreviews: boolean): readonly RunPickerEntry[] {
  const servedIds = new Set(workflows.map(flow => flow.workflowId));
  return [
    ...workflows.map(flow => ({ id: flow.workflowId, label: flow.label, categoryId: workflowRailCategory(flow.workflowId, flow.categoryId), role: flow.role,
      runnable: flow.inputRun.state === "present", ...(flow.code === undefined ? {} : { code: flow.code }) })),
    ...(includePreviews ? MOCK_WORKFLOWS.filter(flow => !servedIds.has(flow.id)).map(flow => ({ id: flow.id, label: flow.label, categoryId: flow.category,
      role: { kind: "standalone" as const }, runnable: flow.runnable })) : []),
  ];
}

export function runPickerGroups(entries: readonly RunPickerEntry[], query: string) {
  const words = query.trim().toLowerCase().split(/\s+/u).filter(Boolean);
  return workflowNavigationGroups(entries.filter(flow => flow.runnable && words.every(word => `${flow.label} ${flow.categoryId} ${flow.code ?? ""}`.toLowerCase().includes(word))));
}
