import { WORKFLOW_SOURCES, workflowSource, type WorkflowComposition, type WorkflowSourcePolicy } from "../../../src/dashboard/app/workflow-sources.js";
import type { RunStartWorkflow } from "../../../src/dashboard/surfaces/run-start/run-start.js";
import { seedMockRuns } from "../../../src/dashboard/surfaces/workflows/mocks/workflow-mock-model.js";

/** Explicit served inputs for backend capability tests, with the other mock scenes retained. */
export function servedFixtureSources(workflows: readonly RunStartWorkflow[]): WorkflowSourcePolicy {
  return Object.freeze({ ...Object.fromEntries(Object.entries(WORKFLOW_SOURCES).map(([id, source]) => [id, source === "hidden" ? source : "mock" as const])), ...Object.fromEntries(workflows.map(flow => [flow.workflowId, "served" as const])) });
}

export function MOCK_WORKFLOW_COMPOSITION(workflows: readonly RunStartWorkflow[]): WorkflowComposition {
  const sources = servedFixtureSources(workflows);
  const previewSources = Object.freeze({ ...sources, ...servedFixtureSources([]) });
  return Object.freeze({ sources, initialMockRuns: seedMockRuns, assistant: "mock" as const, inbox: "mock" as const, search: "mock" as const, explorerSources: previewSources, logsSources: previewSources, sessions: "mock" as const, activity: "mock" as const, dataSources: Object.freeze({ ...sources, "person-lookup": "served" as const }),
    sourceForRoute: (id: string, requestedPreview: boolean) => requestedPreview && id in WORKFLOW_SOURCES && WORKFLOW_SOURCES[id] !== "hidden" ? "mock" : workflowSource(id, sources),
  });
}
