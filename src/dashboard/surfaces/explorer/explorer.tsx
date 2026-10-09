import { useViewState } from "../../app/navigation/view-route-model.js";
import type { WorkflowCatalogEntry } from "../workflows/workflow-catalog-model.js";
import { useMemo, useState } from "react";
import { Button, EmptyState } from "../../ds/ui.js";
import { ExplorerTimeline } from "./explorer-flow.js";
import { buildExplorerPreview, previewFieldSource } from "./explorer-fixture.js";
import { blockedAfter, DEFAULT_SCENARIO, type PreviewScenario } from "./explorer-flow-model.js";
import { buildEmergencyContactMock, buildOnboardingMock, DEFAULT_MOCK_SCENARIO, mockFieldSource, updateMockScenario } from "./explorer-mock-fixtures.js";
import { buildWorkflowMock, explorerWorkflowOptions, initialWorkflowChoices, updateWorkflowChoice, workflowContractSource } from "./explorer-workflow-model.js";
import { MOCK_WORKFLOWS, mockWorkflow, type MockWorkflowId } from "../workflows/mocks/workflow-mock-catalog.js";

/** Local presentation producer; the registered-definition UI has been retired. */
export function WorkflowExplorer({ catalog }: { catalog: readonly WorkflowCatalogEntry[] }) {
  const workflows = useMemo(() => explorerWorkflowOptions(catalog), [catalog]);
  const [workflowId, setWorkflowId] = useViewState("explorerWorkflow", "fixture-separations");
  const id = MOCK_WORKFLOWS.find(flow => flow.id === workflowId.replace(/^fixture-/u, ""))?.id;
  const [scenario, setScenario] = useState<PreviewScenario>(DEFAULT_SCENARIO);
  const [mockScenario, setMockScenario] = useState(DEFAULT_MOCK_SCENARIO);
  const [choices, setChoices] = useState(initialWorkflowChoices(mockWorkflow("fixture-separations".replace(/^fixture-/u, "")).id));
  const workflow = workflows.find((item) => item.id === workflowId)!;
  const flow = useMemo(() => workflowId === "fixture-onboarding" ? buildOnboardingMock(mockScenario) : workflowId === "fixture-emergency-contact" ? buildEmergencyContactMock(mockScenario) : {
    steps: buildExplorerPreview(scenario), summary: "Kuali request → UCPath termination → Kuali completion", completion: "Separation filed and Kuali document verified",
    path: { step: 17, control: "preview-pending" }, stopAfter: blockedAfter(scenario),
  }, [workflowId, mockScenario, scenario]);
  if (!workflow || !id) return <EmptyState title="Workflow unavailable" description="Choose a registered workflow to inspect its steps." action={<Button onClick={() => setWorkflowId("fixture-separations")}>Open Separations</Button>} />;
  const activeFlow = ["fixture-separations", "fixture-onboarding", "fixture-emergency-contact"].includes(workflowId) ? flow : buildWorkflowMock(id, choices);
  return <ExplorerTimeline workflowId={workflowId} workflows={workflows} onWorkflow={(nextId) => {
    const next = workflows.find((item) => item.id === nextId);
    if (!next) throw new Error(`explorer-mock-workflow-unknown: ${nextId}`);
    setWorkflowId(next.id); setScenario(DEFAULT_SCENARIO); setMockScenario(DEFAULT_MOCK_SCENARIO); setChoices(initialWorkflowChoices(next.id.replace(/^fixture-/u, "") as MockWorkflowId));
  }} title={workflow.title} {...activeFlow} scenario={scenario} onScenario={setScenario}
    onMockChoice={(key, value) => key.startsWith("workflow:") ? setChoices(current => updateWorkflowChoice(id, current, key.slice(9), value)) : setMockScenario(current => updateMockScenario(current, key, value))}
    sourceFor={(field, step) => workflowId === "fixture-separations" ? previewFieldSource(field.source ?? "", step, scenario) : workflowId === "fixture-onboarding" || workflowId === "fixture-emergency-contact" ? mockFieldSource(field.source ?? "") : workflowContractSource(id, choices, field, step)} />;
}
