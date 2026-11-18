import { WORKFLOW_SOURCES, type WorkflowComposition, type WorkflowSourcePolicy } from "../../../src/dashboard/app/workflow-sources.js";
import { sessionsSampleHarness } from "../../support/fixtures/dashboard/sessions-sample.js";
import { useActivitySampleReport } from "../../support/fixtures/dashboard/activity-sample.js";
import { prepareHubWorkflow } from "../workflows/hub-assistant-run.js";
import type { AssistantWorkflowRequest } from "../../../src/dashboard/surfaces/shell/assistant-panel-model.js";
import type { RunStartWorkflow } from "../../../src/dashboard/surfaces/run-start/run-start.js";

/** The given workflows are served; every other declared workflow is hidden, so the catalog lists only them. */
export function servedFixtureSources(workflows: readonly RunStartWorkflow[]): WorkflowSourcePolicy {
  return Object.freeze({ ...Object.fromEntries(Object.keys(WORKFLOW_SOURCES).map(id => [id, "hidden" as const])), ...Object.fromEntries(workflows.map(flow => [flow.workflowId, "served" as const])) });
}

export function MOCK_WORKFLOW_COMPOSITION(workflows: readonly RunStartWorkflow[]): WorkflowComposition {
  const sources = servedFixtureSources(workflows);
  const composition: WorkflowComposition = Object.freeze({ sources, assistant: "mock" as const, runAssistantSample: (request: AssistantWorkflowRequest) => prepareHubWorkflow(request, composition, 0).result, inbox: "mock" as const, search: "mock" as const, logs: "mock" as const, sessionsHarness: sessionsSampleHarness, useActivityReport: useActivitySampleReport, dataSources: Object.freeze({ ...sources, "person-lookup": "served" as const }) });
  return composition;
}
