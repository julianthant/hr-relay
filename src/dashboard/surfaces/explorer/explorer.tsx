import { useViewState } from "../../app/navigation/view-route-model.js";
import type { WorkflowCatalogEntry } from "../workflows/workflow-catalog-model.js";
import { useMemo, useState } from "react";
import { Banner, Button, EmptyState } from "../../ds/ui.js";
import { ExplorerTimeline } from "./explorer-flow.js";
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
  const resource = useExplorerWiring(client, served?.id, served?.served?.version);
  const [identity, setIdentity] = useState({ client, workflowId, epoch: 0 });
  const [scenario, setScenario] = useState<PreviewScenario>(DEFAULT_SCENARIO);
  const [mockScenario, setMockScenario] = useState(DEFAULT_MOCK_SCENARIO);
  const [choices, setChoices] = useState(initialWorkflowChoices());
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
    const projection = resource.state === "ready" ? resource.projection : resource.state === "refused" ? resource.previous : undefined;
    const steps = projection !== undefined ? projection.steps : [{ number: 1, title: served.label, parts: [{ kind: "note" as const, text: resource.state === "loading" ? "Loading workflow definition" : resource.state === "unavailable" ? resource.reason : resource.state === "refused" ? formatErrorCatalogFailure(resource.failure).text : "Workflow unavailable" }] }];
    return <>{resource.state === "refused" && projection !== undefined && <Banner tone="warning" title="Workflow definition unavailable">{formatErrorCatalogFailure(resource.failure).text}</Banner>}<ExplorerTimeline key={identity.epoch} workflowId={workflowId} workflows={workflows} onWorkflow={setWorkflowId} title={served.label} steps={steps} scenario={scenario} onScenario={setScenario} onMockChoice={() => undefined}
      sourceFor={field => projection?.sources.get(field.source ?? "")} summary="Registered workflow definition" completion="No run values are available." path={{ step: 1, control: "explorer-step-1" }} /></>;
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
