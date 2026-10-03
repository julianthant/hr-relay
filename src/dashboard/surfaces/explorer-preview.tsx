import { useEffect, useMemo, useState } from "react";
import { Workflow } from "lucide-react";
import type { WorkflowExplorerWire } from "../../models/dashboard/explorer.js";
import { Banner, Button, EmptyState, Spinner, TakeoverFrame } from "../ds/ui.js";
import { useExplorerClient as useDashboardClient } from "../state/explorer-client.js";
import { observeAsyncResource, LOADING, type AsyncResource } from "../state/async-resource.js";
import { ExplorerTimeline } from "./explorer/explorer-flow.js";
import { DEFAULT_SCENARIO, type PreviewScenario } from "./explorer/explorer-flow-model.js";
import { buildEmergencyContactMock, buildOnboardingMock, DEFAULT_MOCK_SCENARIO,
  EXPLORER_MOCK_WORKFLOWS, mockFieldSource, updateMockScenario, type MockScenario } from "./explorer/explorer-mock-fixtures.js";
import { registeredExplorerPreview } from "./explorer/explorer-preview-model.js";
const FICTIONAL = EXPLORER_MOCK_WORKFLOWS.filter((workflow) => workflow.id !== "fixture-separations");

function SelectedPreview({ wire, workflowId, onWorkflow, onVersionRegistry }: {
  wire: WorkflowExplorerWire; workflowId: string; onWorkflow: (id: string) => void; onVersionRegistry: () => void;
}) {
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [mockScenario, setMockScenario] = useState<MockScenario>(DEFAULT_MOCK_SCENARIO);
  const [scenario, setScenario] = useState<PreviewScenario>(DEFAULT_SCENARIO);
  const registered = wire.workflows.find((item) => String(item.id) === workflowId);
  const fictional = FICTIONAL.find((item) => item.id === workflowId);
  const preview = useMemo(() => registered?.definitionPreview.state === "compiled"
    ? registeredExplorerPreview(registered, choices) : undefined, [registered, choices]);
  const mock = fictional?.id === "fixture-onboarding" ? buildOnboardingMock(mockScenario)
    : fictional?.id === "fixture-emergency-contact" ? buildEmergencyContactMock(mockScenario) : undefined;
  const workflows = [
    ...wire.workflows.map((item) => ({ id: String(item.id), title: item.label, count: item.definitionPreview.state === "compiled" ? item.definitionPreview.groups.length : 0 })),
    ...FICTIONAL,
  ];
  if (registered === undefined && fictional === undefined) {
    return <TakeoverFrame label="Workflow explorer preview" className="ui-theme-scope bg-ui-canvas p-5">
      <EmptyState icon={<Workflow aria-hidden className="size-6" />} title={`No workflow is registered as "${workflowId}"`}
        description={`Registered today: ${wire.workflows.map((item) => String(item.id)).join(", ") || "none"}. Fictional previews have their own names.`}
        action={<div className="flex gap-2">
          {wire.workflows[0] && <Button size="sm" onClick={() => onWorkflow(String(wire.workflows[0].id))}>Open {wire.workflows[0].label}</Button>}
          <Button size="sm" variant="secondary" onClick={onVersionRegistry}>Version registry</Button>
        </div>} />
    </TakeoverFrame>;
  }
  if (registered?.definitionPreview.state === "unavailable") {
    return <TakeoverFrame label="Workflow explorer preview" className="ui-theme-scope bg-ui-canvas p-5">
      <Banner tone="warning" title={`${registered.label} definition preview unavailable`}>
        {registered.definitionPreview.reason}
      </Banner>
      <Button size="toolbar" variant="secondary" onClick={onVersionRegistry}>Version registry</Button>
    </TakeoverFrame>;
  }
  return <ExplorerTimeline
    title={preview?.title ?? fictional!.title}
    steps={preview?.steps ?? mock!.steps}
    scenario={scenario}
    onScenario={setScenario}
    sourceFor={(field, step) => preview?.sources.get(`${step}:${field.id}`) ?? (fictional ? mockFieldSource(field.source ?? "") : undefined)}
    onVersionRegistry={onVersionRegistry}
    workflows={workflows}
    workflowId={workflowId}
    onWorkflow={onWorkflow}
    summary={preview?.summary ?? mock!.summary}
    completion={preview?.completion ?? `${mock!.completion}. No workflow was run.`}
    path={preview?.path ?? mock?.path}
    stopAfter={mock?.stopAfter}
    onMockChoice={(id, value) => fictional
      ? setMockScenario((current) => updateMockScenario(current, id, value))
      : setChoices((current) => ({ ...current, [id]: value }))}
    previewLabel={preview === undefined ? "Mock data" : "Definition preview"}
    workflowClass={preview === undefined ? "Fictional workflow · UI preview" : "Registered workflow · hypothetical preview"}
  />;
}

export function WorkflowExplorerPreview({ workflowId, onWorkflow, onVersionRegistry }: {
  workflowId: string; onWorkflow: (id: string) => void; onVersionRegistry: () => void;
}) {
  const client = useDashboardClient();
  const [resource, setResource] = useState<AsyncResource<WorkflowExplorerWire>>(LOADING);
  useEffect(() => {
    setResource(LOADING);
    return observeAsyncResource(() => client.workflowExplorer(), setResource);
  }, [client]);
  if (resource.state === "loading" || resource.state === "idle") return <TakeoverFrame label="Workflow explorer preview" className="ui-theme-scope bg-ui-canvas p-5"><Spinner label="Loading the explorer projection" /></TakeoverFrame>;
  if (resource.state === "failed") return <TakeoverFrame label="Workflow explorer preview" className="ui-theme-scope bg-ui-canvas p-5"><Banner tone="danger" title="The explorer projection could not be read">{resource.error.message}</Banner></TakeoverFrame>;
  return <SelectedPreview key={`${workflowId}:${resource.value.descriptorHash}`} wire={resource.value} workflowId={workflowId} onWorkflow={onWorkflow} onVersionRegistry={onVersionRegistry} />;
}
