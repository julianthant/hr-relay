import { WORKFLOW_SOURCES, workflowSource, type WorkflowComposition, type WorkflowSourcePolicy } from "../../../src/dashboard/app/workflow-sources.js";
import type { RunStartWorkflow } from "../../../src/dashboard/surfaces/run-start/run-start.js";

/** Explicit served inputs for backend capability tests, with the other mock scenes retained. */
export function servedFixtureSources(workflows: readonly RunStartWorkflow[]): WorkflowSourcePolicy {
  return Object.freeze({ ...WORKFLOW_SOURCES, ...Object.fromEntries(workflows.map(flow => [flow.workflowId, "served" as const])) });
}

export function PARITY_WORKFLOW_COMPOSITION(workflows: readonly RunStartWorkflow[]): WorkflowComposition {
  const sources = servedFixtureSources(workflows);
  const previewSources = Object.freeze({ ...sources, ...WORKFLOW_SOURCES });
  return Object.freeze({ sources, inbox: "mock" as const, search: "mock" as const, explorerSources: previewSources, logsSources: previewSources, sessions: "mock" as const, activity: "mock" as const, spreadsheets: "mock" as const, dataSources: Object.freeze({ ...sources, "person-lookup": "served" as const }),
    sourceForRoute: (id: string, requestedPreview: boolean) => requestedPreview && id in WORKFLOW_SOURCES ? "mock" : workflowSource(id, sources),
  });
}
