import { WORKFLOW_SOURCES, type DashboardHarness, type WorkflowComposition, type WorkflowSourcePolicy } from "../../../../../src/dashboard/app/workflow-sources.js";
import { sessionsSampleHarness } from "../../../fixtures/dashboard/sessions-sample.js";
import { useActivitySampleReport } from "../../../fixtures/dashboard/activity-sample.js";
import { useNotificationsSampleInbox, resolveSampleRun } from "../../../fixtures/dashboard/notifications-preview.js";
import { useWorkspaceSearchData } from "../../../fixtures/dashboard/search-sample.js";
import { LogPreview } from "../../../fixtures/dashboard/log-preview/log-preview.js";
import { StatusMockHost } from "./status-mock/status-mock.js";
import { statusMockHarness } from "./status-mock/status-mock-model.js";
import type { RunStartWorkflow } from "../../../../../src/dashboard/surfaces/run-start/run-start.js";

/** The given workflows are served; every other declared workflow is hidden, so the catalog lists only them. */
export function servedFixtureSources(workflows: readonly RunStartWorkflow[]): WorkflowSourcePolicy {
  return Object.freeze({ ...Object.fromEntries(Object.keys(WORKFLOW_SOURCES).map(id => [id, "hidden" as const])), ...Object.fromEntries(workflows.map(flow => [flow.workflowId, "served" as const])) });
}

function harnessFor(): DashboardHarness {
  return { ...statusMockHarness(StatusMockHost), LogPreview, useInbox: useNotificationsSampleInbox, useSearch: useWorkspaceSearchData, resolveRun: resolveSampleRun };
}

export function MOCK_WORKFLOW_COMPOSITION(workflows: readonly RunStartWorkflow[]): WorkflowComposition {
  const sources = servedFixtureSources(workflows);
  return Object.freeze({ sources, harness: harnessFor(), sessionsHarness: sessionsSampleHarness, useActivityReport: useActivitySampleReport, dataSources: Object.freeze({ ...sources, "person-lookup": "served" as const }) });
}

/** The mock composition with the served Logs panel: the harness keeps its other sample ports and drops the Logs preview. */
export function servedLogsComposition(workflows: readonly RunStartWorkflow[]): WorkflowComposition {
  const composition = MOCK_WORKFLOW_COMPOSITION(workflows);
  const { LogPreview: _preview, ...harness } = composition.harness ?? {};
  return Object.freeze({ ...composition, harness });
}
