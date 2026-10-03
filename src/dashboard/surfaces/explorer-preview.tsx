import { useEffect, useMemo, useState } from "react";
import { Workflow } from "lucide-react";
import type { WorkflowExplorerWire } from "../../models/dashboard/explorer.js";
import { Banner, Button, EmptyState, Spinner, TakeoverFrame } from "../ds/ui.js";
import { useExplorerClient as useDashboardClient } from "../state/explorer-client.js";
import { observeAsyncResource, LOADING, type AsyncResource } from "../state/async-resource.js";
import { ExplorerTimeline } from "./explorer/explorer-flow.js";
import { DEFAULT_SCENARIO, type FlowStep, type PreviewScenario } from "./explorer/explorer-flow-model.js";
import { registeredExplorerPreview } from "./explorer/explorer-preview-model.js";

const FICTIONAL = [
  { id: "preview-onboarding", title: "Onboarding", count: 1,
    summary: "Fictional onboarding example for exploring the interface.",
    steps: [{ number: 1, title: "Fictional onboarding preview", parts: [
      { kind: "note", text: "This example has no registered definition or executable workflow." },
    ] }] },
  { id: "preview-emergency-contact", title: "Emergency Contact", count: 1,
    summary: "Fictional emergency contact example for exploring the interface.",
    steps: [{ number: 1, title: "Fictional emergency contact preview", parts: [
      { kind: "note", text: "This example has no registered definition or executable workflow." },
    ] }] },
] as const satisfies readonly { id: string; title: string; count: number; summary: string; steps: readonly FlowStep[] }[];

function SelectedPreview({ wire, workflowId, onWorkflow, onVersionRegistry }: {
  wire: WorkflowExplorerWire; workflowId: string; onWorkflow: (id: string) => void; onVersionRegistry: () => void;
}) {
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [scenario, setScenario] = useState<PreviewScenario>(DEFAULT_SCENARIO);
  const registered = wire.workflows.find((item) => String(item.id) === workflowId);
  const fictional = FICTIONAL.find((item) => item.id === workflowId);
  const preview = useMemo(() => registered?.definitionPreview.state === "compiled"
    ? registeredExplorerPreview(registered, choices) : undefined, [registered, choices]);
  const workflows = [
    ...wire.workflows.map((item) => ({ id: String(item.id), title: item.label, count: item.definitionPreview.state === "compiled" ? item.definitionPreview.groups.length : 0 })),
    ...FICTIONAL.map(({ id, title, count }) => ({ id, title, count })),
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
    steps={preview?.steps ?? fictional!.steps}
    scenario={scenario}
    onScenario={setScenario}
    sourceFor={(field, step) => preview?.sources.get(`${step}:${field.id}`)}
    onVersionRegistry={onVersionRegistry}
    workflows={workflows}
    workflowId={workflowId}
    onWorkflow={onWorkflow}
    summary={preview?.summary ?? fictional!.summary}
    completion={preview?.completion ?? "Fictional UI preview complete. No workflow was run."}
    path={preview?.path}
    onMockChoice={(id, value) => setChoices((current) => ({ ...current, [id]: value }))}
    previewLabel={preview === undefined ? "Fictional UI preview" : "Definition preview"}
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
