import type { RunStartWorkflow } from "./run-start.js";
import { MOCK_WORKFLOWS, type MockWorkflow } from "./workflow-mock-catalog.js";
import { workflowNavigationGroups, workflowRailCategory, type WorkflowNavigationEntry } from "./workflow-rail-model.js";

export type WorkflowLaunchCapability = Readonly<{ state: "served" | "preview" }>
  | Readonly<{ state: "unavailable"; label: string; reason: string }>;
export interface WorkflowCatalogEntry extends WorkflowNavigationEntry {
  readonly code?: string;
  readonly source: "served" | "preview";
  readonly launch: WorkflowLaunchCapability;
  readonly served?: RunStartWorkflow;
  readonly preview?: MockWorkflow;
}

/** Compose once at the app boundary. Served declarations replace preview authority by ID. */
export function buildWorkflowCatalog(served: readonly RunStartWorkflow[], includePreviews = true): readonly WorkflowCatalogEntry[] {
  if (includePreviews && new Set(MOCK_WORKFLOWS.map(flow => flow.id)).size !== MOCK_WORKFLOWS.length) throw new Error("WORKFLOW_PREVIEW_REGISTRY_DUPLICATE");
  const seen = new Set<string>();
  const entries: WorkflowCatalogEntry[] = served.map(flow => {
    if (seen.has(flow.workflowId)) throw new Error(`WORKFLOW_CATALOG_DUPLICATE: ${flow.workflowId}`);
    seen.add(flow.workflowId);
    const preview = MOCK_WORKFLOWS.find(item => item.id === flow.workflowId);
    return { id: flow.workflowId, label: flow.label, categoryId: workflowRailCategory(flow.workflowId, flow.categoryId), role: flow.role,
      code: flow.code, source: "served", served: flow, preview,
      launch: flow.inputRun.state === "present" ? { state: "served" }
        : { state: "unavailable", label: "Unavailable", reason: flow.inputRun.reason } };
  });
  if (includePreviews) for (const preview of MOCK_WORKFLOWS) {
    if (seen.has(preview.id)) continue;
    seen.add(preview.id);
    entries.push({ id: preview.id, label: preview.label, categoryId: preview.category, role: { kind: "standalone" }, source: "preview", preview,
      launch: preview.runnable ? { state: "preview" }
        : { state: "unavailable", label: "Parent only", reason: "Started by a parent workflow." } });
  }
  return workflowNavigationGroups(entries).flatMap(group => group.entries.flatMap(node => [node.entry, ...node.members.map(member => member.entry)]));
}

export function servedLaunchWorkflows(catalog: readonly WorkflowCatalogEntry[]): readonly RunStartWorkflow[] {
  return catalog.flatMap(entry => entry.served ? [entry.served] : []);
}
