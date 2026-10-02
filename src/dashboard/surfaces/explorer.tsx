import { useMemo, useState } from "react";
import { ExplorerTimeline } from "./explorer/explorer-flow.js";
import { buildExplorerPreview, previewFieldSource } from "./explorer/explorer-fixture.js";
import { blockedAfter, DEFAULT_SCENARIO, type PreviewScenario } from "./explorer/explorer-flow-model.js";
import { buildEmergencyContactMock, buildOnboardingMock, DEFAULT_MOCK_SCENARIO, EXPLORER_MOCK_WORKFLOWS, mockFieldSource, updateMockScenario, type MockWorkflowId } from "./explorer/explorer-mock-fixtures.js";

/** Local presentation producer; the registered-definition UI has been retired. */
export function WorkflowExplorer({ onVersionRegistry }: { onVersionRegistry: () => void }) {
  const [workflowId, setWorkflowId] = useState<MockWorkflowId>("fixture-separations");
  const [scenario, setScenario] = useState<PreviewScenario>(DEFAULT_SCENARIO);
  const [mockScenario, setMockScenario] = useState(DEFAULT_MOCK_SCENARIO);
  const workflow = EXPLORER_MOCK_WORKFLOWS.find((item) => item.id === workflowId)!;
  const flow = useMemo(() => workflowId === "fixture-onboarding" ? buildOnboardingMock(mockScenario) : workflowId === "fixture-emergency-contact" ? buildEmergencyContactMock(mockScenario) : {
    steps: buildExplorerPreview(scenario), summary: "Kuali request → UCPath termination → Kuali completion", completion: "Separation filed and Kuali document verified",
    path: { step: 17, control: "preview-pending" }, stopAfter: blockedAfter(scenario),
  }, [workflowId, mockScenario, scenario]);
  return <ExplorerTimeline key={workflowId} workflowId={workflowId} workflows={EXPLORER_MOCK_WORKFLOWS} onWorkflow={(id) => {
    const next = EXPLORER_MOCK_WORKFLOWS.find((item) => item.id === id);
    if (!next) throw new Error(`explorer-mock-workflow-unknown: ${id}`);
    setWorkflowId(next.id); setScenario(DEFAULT_SCENARIO); setMockScenario(DEFAULT_MOCK_SCENARIO);
  }} title={workflow.title} {...flow} scenario={scenario} onScenario={setScenario}
    onMockChoice={(id, value) => setMockScenario((current) => updateMockScenario(current, id, value))}
    sourceFor={(field, step) => workflowId === "fixture-separations" ? previewFieldSource(field.source ?? "", step, scenario) : mockFieldSource(field.source ?? "")}
    onVersionRegistry={onVersionRegistry} />;
}
