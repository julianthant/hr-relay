import { useViewState } from "../../app/navigation/view-route-model.js";
import type { WorkflowCatalogEntry } from "../workflows/workflow-catalog-model.js";
import { useMemo, useState } from "react";
import { Button, EmptyState, Notice } from "../../ds/ui.js";
import { LoadingRegion, SettingsRowsSkeleton } from "../shared/loading/loading.js";
import { ExplorerTimeline } from "./explorer-flow.js";
import { ExplorerPage, ExplorerSpecView } from "./explorer-spec-view.js";
import { buildExplorerPreview, previewFieldSource } from "./explorer-fixture.js";
import { blockedAfter, DEFAULT_SCENARIO, type PreviewScenario } from "./explorer-flow-model.js";
import { buildEmergencyContactMock, buildOnboardingMock, DEFAULT_MOCK_SCENARIO, mockFieldSource, updateMockScenario } from "./explorer-mock-fixtures.js";
import { buildWorkflowMock, explorerWorkflowOptions, explorerRecoveryWorkflow, initialWorkflowChoices, updateWorkflowChoice, workflowContractSource } from "./explorer-workflow-model.js";
import { MOCK_WORKFLOWS } from "../workflows/mocks/workflow-mock-catalog.js";

import type { DashboardClient } from "../../client/index.js";
import { useExplorerWiring } from "../../state/explorer-wiring-adapter.js";
import { formatErrorCatalogFailure } from "../../../models/failures/error-catalog.js";
export function WorkflowExplorer({ catalog, client }: { catalog: readonly WorkflowCatalogEntry[]; client?: DashboardClient }) {
  const workflows = useMemo(() => explorerWorkflowOptions(catalog), [catalog]);
  const [workflowId, setWorkflowId] = useViewState("explorerWorkflow", explorerRecoveryWorkflow(catalog));
  const id = MOCK_WORKFLOWS.find(flow => flow.id === workflowId.replace(/^fixture-/u, ""))?.id;
  const served = catalog.find(entry => entry.id === workflowId && entry.source === "served");
  const [identity, setIdentity] = useState({ client, workflowId, epoch: 0 });
  const [scenario, setScenario] = useState<PreviewScenario>(DEFAULT_SCENARIO);
  const [mockScenario, setMockScenario] = useState(DEFAULT_MOCK_SCENARIO);
  const [choices, setChoices] = useState(initialWorkflowChoices());
  const { state, retry } = useExplorerWiring(client, served?.id, served?.served?.version);
  if (identity.client !== client || identity.workflowId !== workflowId) {
    setIdentity({ client, workflowId, epoch: identity.epoch + (identity.client !== client ? 1 : 0) }); setScenario(DEFAULT_SCENARIO); setMockScenario(DEFAULT_MOCK_SCENARIO);
    setChoices(initialWorkflowChoices(id));
  }
  const workflow = workflows.find((item) => item.id === workflowId);
  const flow = useMemo(() => workflowId === "fixture-onboarding" ? buildOnboardingMock(mockScenario) : workflowId === "fixture-emergency-contact" ? buildEmergencyContactMock(mockScenario) : {
    steps: buildExplorerPreview(scenario), summary: "Kuali request → UCPath termination → Kuali completion", completion: "Separation filed and Kuali document verified",
    path: { step: 17, control: "preview-pending" }, stopAfter: blockedAfter(scenario),
  }, [workflowId, mockScenario, scenario]);
  if (!workflow || (!served && !id)) return <EmptyState title="Workflow unavailable" description="Choose a registered workflow to inspect its steps." action={<Button onClick={() => setWorkflowId(explorerRecoveryWorkflow(catalog))}>Open Separations</Button>} />;
  if (served) {
    const spec = state.state === "ready" ? state.spec : state.state === "refused" ? state.previous : undefined;
    return <>{state.state === "refused" && spec !== undefined && <Notice tone="warning" title="Workflow definition unavailable" description={formatErrorCatalogFailure(state.failure).text} />}
      {spec !== undefined ? <ExplorerSpecView key={`${identity.epoch}:${workflowId}`} spec={spec} workflowId={workflowId} workflows={workflows} onWorkflow={setWorkflowId} />
        : <ExplorerPage workflowId={workflowId} workflows={workflows} onWorkflow={setWorkflowId}>
          {state.state === "unavailable" ? <EmptyState title="Workflow unavailable" description={state.reason} />
            : state.state === "refused" ? <EmptyState title="Workflow unavailable" description={formatErrorCatalogFailure(state.failure).text} action={<Button onClick={retry}>Retry</Button>} />
            : <LoadingRegion label="Loading workflow definition"><SettingsRowsSkeleton rows={4} /></LoadingRegion>}
        </ExplorerPage>}</>;
  }
  if (!id) throw new Error(`explorer-mock-workflow-unknown: ${workflowId}`);
  const activeFlow = ["fixture-separations", "fixture-onboarding", "fixture-emergency-contact"].includes(workflowId) ? flow : buildWorkflowMock(id, choices);
  return <ExplorerTimeline key={identity.epoch} workflowId={workflowId} workflows={workflows} onWorkflow={(nextId) => {
    const next = workflows.find((item) => item.id === nextId);
    if (!next) throw new Error(`explorer-mock-workflow-unknown: ${nextId}`);
    setWorkflowId(next.id);
  }} title={workflow.title} {...activeFlow} scenario={scenario} onScenario={setScenario}
    onMockChoice={(key, value) => key.startsWith("workflow:") ? setChoices(current => updateWorkflowChoice(id, current, key.slice(9), value)) : setMockScenario(current => updateMockScenario(current, key, value))}
    sourceFor={(field, step) => workflowId === "fixture-separations" ? previewFieldSource(field.source ?? "", step, scenario) : workflowId === "fixture-onboarding" || workflowId === "fixture-emergency-contact" ? mockFieldSource(field.source ?? "") : workflowContractSource(id, choices, field, step)} />;
}
