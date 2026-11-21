import type { FrontendBootstrapWire } from "../../../models/dashboard/bootstrap.js";
import { WORKFLOW_SOURCES, workflowSource, type WorkflowSourcePolicy } from "../../app/workflow-sources.js";
import type { RunStartWorkflow } from "../run-start/run-start.js";
import { workflowCategoryLabel } from "./workflow-category.js";
import { workflowNavigationGroups, type WorkflowNavigationEntry } from "../shell/workflow-rail-model.js";

export type WorkflowLaunchCapability = Readonly<{ state: "served" }>
  | Readonly<{ state: "unavailable"; label: string; reason: string }>;
export interface WorkflowCatalogEntry extends WorkflowNavigationEntry {
  readonly code?: string;
  readonly source: "served";
  readonly launch: WorkflowLaunchCapability;
  readonly served?: RunStartWorkflow;
}

/** The catalog lists the served workflows the sources policy marks "served"; nothing else is shown. */
export function buildWorkflowCatalog(served: readonly RunStartWorkflow[], sources: WorkflowSourcePolicy = WORKFLOW_SOURCES, features: FrontendBootstrapWire["featureAvailability"] = []): readonly WorkflowCatalogEntry[] {
  const seen = new Set<string>();
  const entries: WorkflowCatalogEntry[] = served.filter(flow => workflowSource(flow.workflowId, sources) === "served").map(flow => {
    if (seen.has(flow.workflowId)) throw new Error(`WORKFLOW_CATALOG_DUPLICATE: ${flow.workflowId}`);
    seen.add(flow.workflowId);
    return { id: flow.workflowId, label: flow.label, categoryId: workflowCategoryLabel(flow.categoryId), role: flow.role, icon: flow.icon,
      code: flow.code, source: "served", served: flow,
      launch: flow.inputRun.state === "present" || flow.uploadRun?.pdfInput !== undefined ? { state: "served" }
        : { state: "unavailable", label: "No direct start", reason: `This served workflow has no standalone launch input. ${flow.inputRun.reason}` } };
  });
  const restrictions = workflowStartRestrictions(features);
  const guarded = entries.map(entry => {
    const restriction = restrictions.get(entry.id);
    return restriction ? { ...entry, launch: { state: 'unavailable' as const, label: 'Unavailable', reason: restriction } } : entry;
  });
  return workflowNavigationGroups(guarded).flatMap(group => group.entries.flatMap(node => [node.entry, ...node.members.map(member => member.entry)]));
}

export function servedLaunchWorkflows(catalog: readonly WorkflowCatalogEntry[]): readonly RunStartWorkflow[] {
  return catalog.flatMap(entry => entry.served ? [entry.served] : []);
}

export function workflowStartRestrictions(features: FrontendBootstrapWire['featureAvailability']): ReadonlyMap<string, string> {
  return new Map(features.flatMap(feature => feature.feature.startsWith('workflow-start:') && feature.availability.state === 'unavailable'
    ? [[feature.feature.slice('workflow-start:'.length), feature.availability.reason] as const] : []));
}
