import { buildWorkflowCatalog, workflowStartRestrictions } from "../../../src/dashboard/surfaces/workflows/workflow-catalog-model.js";
import { MOCK_WORKFLOW_CATALOG } from "../../../src/dashboard/surfaces/workflows/mocks/workflow-mock-catalog.js";
import { workflowNavigationGroups } from "../../../src/dashboard/surfaces/shell/workflow-rail-model.js";
import type { FrontendBootstrapWire } from "../../../src/models/dashboard/bootstrap.js";
import { WORKFLOW_SOURCES, type WorkflowComposition, type WorkflowSourcePolicy } from "../../../src/dashboard/app/workflow-sources.js";
import type { RunStartWorkflow } from "../../../src/dashboard/surfaces/run-start/run-start.js";

/** The given workflows are served; every other declared workflow is hidden, so the catalog lists only them. */
export function servedFixtureSources(workflows: readonly RunStartWorkflow[]): WorkflowSourcePolicy {
  return Object.freeze({ ...Object.fromEntries(Object.keys(WORKFLOW_SOURCES).map(id => [id, "hidden" as const])), ...Object.fromEntries(workflows.map(flow => [flow.workflowId, "served" as const])) });
}

export function MOCK_WORKFLOW_COMPOSITION(workflows: readonly RunStartWorkflow[]): WorkflowComposition {
  const sources = servedFixtureSources(workflows);
  const previewSources = Object.freeze({ ...sources, ...servedFixtureSources([]) });
  return Object.freeze({ sources, explorerCatalog: (served: readonly RunStartWorkflow[]) => buildPreviewCatalog(served, previewSources), assistant: "mock" as const, inbox: "mock" as const, search: "mock" as const, logs: "mock" as const, sessions: "mock" as const, activity: "mock" as const, dataSources: Object.freeze({ ...sources, "person-lookup": "served" as const }) });
}

/** Child workflows the design catalog never lists, as in the product. */
export const DESIGN_HIDDEN_WORKFLOWS: readonly string[] = ["i9-lookup", "ocr", "onbase"];

/** The design catalog the harness and fixture tests use: the served workflows plus a preview entry for every other design workflow. The product catalog never has preview entries. */
export function buildPreviewCatalog(served: readonly RunStartWorkflow[], sources: WorkflowSourcePolicy = servedFixtureSources(served), features: FrontendBootstrapWire["featureAvailability"] = []): readonly WorkflowCatalogEntry[] {
  const previews = MOCK_WORKFLOW_CATALOG.workflows.filter(preview => sources[preview.id] !== "served" && !DESIGN_HIDDEN_WORKFLOWS.includes(preview.id))
    .map((preview): WorkflowCatalogEntry => ({ id: preview.id, label: preview.label, categoryId: preview.category, role: { kind: "standalone" }, source: "preview", preview,
      launch: preview.runnable ? { state: "preview" } : { state: "unavailable", label: "Parent only", reason: "Started by a parent workflow." } }));
  const restrictions = workflowStartRestrictions(features);
  const guarded = [...buildWorkflowCatalog(served, sources, features), ...previews].map(entry => restrictions.has(entry.id) && entry.source === "preview"
    ? { ...entry, launch: { state: "unavailable" as const, label: "Unavailable", reason: restrictions.get(entry.id)! } } : entry);
  return workflowNavigationGroups(guarded).flatMap(group => group.entries.flatMap(node => [node.entry, ...node.members.map(member => member.entry)]));
}
