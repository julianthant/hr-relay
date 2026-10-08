import { useViewState } from "../../app/navigation/view-route-model.js";
import { useLayoutEffect, useRef, useState } from "react";
import { ArrowUpRight, CheckCheck, Cpu, Monitor, X } from "lucide-react";
import { Button, dsElev, IconButton, PageHeading, Select } from "../../ds/ui.js";
import { allFields, DEFAULT_COMMENTS, type CommentChoices, type FlowField, type FlowStep, type FieldSource, type PreviewScenario } from "./explorer-flow-model.js";
import { ExplorerParts } from "./explorer-parts.js";
import { ExplorerSource } from "./explorer-source.js";

type ExplorerTimelineProps = {
  title: string; steps: readonly FlowStep[]; scenario: PreviewScenario; onScenario: (scenario: PreviewScenario) => void;
  sourceFor: (field: FlowField, step: number) => FieldSource | undefined;
  workflows: readonly { readonly id: string; readonly title: string; readonly count: number; readonly disabled?: boolean }[];
  workflowId: string; onWorkflow: (id: string) => void;
  summary: string; completion: string; path: { readonly step: number; readonly control: string }; stopAfter?: number;
  onMockChoice: (id: string, value: string) => void;
};

export function ExplorerTimeline(props: ExplorerTimelineProps) {
  const { workflows, workflowId, onWorkflow } = props;
  return <section aria-label="Workflow explorer preview" className="settings-reference-page settings-data-section ui-theme-scope text-ui-primary">
    <PageHeading title="Explorer" description="Browse workflows, their steps and field sources. Fictional preview data." className="settings-heading-actions" actions={
      <Select aria-label="Explorer workflow" className="settings-heading-select" value={workflowId} onChange={event => {
        if (event.target.value !== workflowId) onWorkflow(event.target.value);
      }}>{workflows.map(workflow => <option key={workflow.id} value={workflow.id} disabled={workflow.disabled} title={workflow.disabled ? "Workflow preview unavailable" : undefined}>{workflow.title}</option>)}</Select>
    } />
    <ExplorerWorkflowTimeline key={workflowId} {...props} />
  </section>;
}

function ExplorerWorkflowTimeline({ steps, scenario, onScenario, sourceFor, completion, stopAfter, onMockChoice }: ExplorerTimelineProps) {
  const [comments, setComments] = useState<CommentChoices>(DEFAULT_COMMENTS);
  const [open, setOpen] = useViewState("explorerOpen", {});
  const [sourceAddress, setSourceAddress] = useViewState("explorerSource", undefined);
  const sourceStep = steps.find(step => step.number === sourceAddress?.step);
  const sourceField = sourceStep && allFields(sourceStep.parts).find(field => field.id === sourceAddress?.field);
  const source = sourceStep && sourceField ? { field: sourceField, step: sourceStep, form: sourceAddress?.form } : undefined;
  const setSource = (next: { field: FlowField; step: FlowStep; form?: string } | undefined) => setSourceAddress(next ? { field: next.field.id, step: next.step.number, form: next.form } : undefined);
  const [selected, setSelected] = useState<string>();
  const [pendingFocus, setPendingFocus] = useState<string>();
  const origin = useRef<HTMLButtonElement | null>(null);
  const originAddress = useRef<{ step: number; fieldId: string } | undefined>(undefined);
  const focusRequest = useRef<{ anchor: string; focus: string; block: ScrollLogicalPosition } | undefined>(undefined);
  const stop = stopAfter;
  const onToggle = (id: string, value: boolean) => setOpen((current) => current[id] === value ? current : { ...current, [id]: value });
  const focusAt = (step: number, fieldId?: string, focusId?: string) => {
    const id = fieldId === undefined ? `explorer-step-${step}` : `explorer-field-${step}-${fieldId}`;
    const target = document.getElementById(id);
    if (target === null) throw new Error(`explorer-preview-target-missing: ${id}`);
    const disclosures: Record<string, boolean> = {};
    let parent = target.parentElement;
    while (parent) {
      if (parent instanceof HTMLDetailsElement && parent.dataset.disclosure) disclosures[parent.dataset.disclosure] = true;
      parent = parent.parentElement;
    }
    setOpen((current) => ({ ...current, ...disclosures }));
    focusRequest.current = { anchor: id, focus: focusId ?? id, block: fieldId === undefined ? "start" : "center" };
    setPendingFocus(id);
  };
  useLayoutEffect(() => {
    const request = focusRequest.current;
    if (!request || request.anchor !== pendingFocus) return;
    const frame = requestAnimationFrame(() => {
      focusRequest.current = undefined;
      document.getElementById(request.anchor)?.scrollIntoView({ block: request.block, behavior: "instant" });
      document.getElementById(request.focus)?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [pendingFocus, open]);
  const closeSource = () => {
    setSource(undefined);
    if (originAddress.current) focusAt(originAddress.current.step, originAddress.current.fieldId);
  };
  const returnToField = () => {
    setSelected(undefined);
    if (origin.current?.isConnected) {
      if (originAddress.current) focusAt(originAddress.current.step, originAddress.current.fieldId);
    }
  };
  const updateScenario = (next: PreviewScenario) => {
    onScenario(next); setSource(undefined); setSelected(undefined); setPendingFocus(undefined); focusRequest.current = undefined;
  };
  const updateMockChoice = (id: string, value: string) => {
    onMockChoice(id, value); setSource(undefined); setSelected(undefined); setPendingFocus(undefined); focusRequest.current = undefined;
  };
  return <>
    {sourceAddress && !source && <div role="alert" className="mb-3 rounded-lg border border-ui-stroke p-3 text-body"><p className="m-0">This field source is unavailable for the selected workflow.</p><Button size="sm" onClick={() => setSource(undefined)}>Dismiss unavailable source</Button></div>}
    <div className="min-w-0" onKeyDown={(event) => { if (event.key === "Escape" && selected) { event.stopPropagation(); returnToField(); } }}>
      <ol aria-label="Workflow steps" className="relative pl-10 before:absolute before:bottom-5 before:left-3.5 before:top-3 before:w-px before:bg-ui-stroke">
        {steps.map((step) => {
          const blocked = stop !== undefined && step.number > stop;
          return <li hidden={blocked} key={step.number} id={`explorer-step-${step.number}`} tabIndex={-1} data-step-number={step.number} data-blocked={blocked || undefined}
            className={`relative border-b border-ui-stroke pb-6 pt-6 first:pt-0 last:border-b-0 ${selected === `explorer-step-${step.number}` ? "rounded-md ring-2 ring-ui-info" : ""}`}>
            <span aria-hidden className={`absolute -left-10 flex size-7 items-center justify-center rounded-full border border-ui-stroke bg-ui-panel font-data text-caption text-ui-secondary ${step.number === 1 ? "top-0" : "top-6"}`}>{step.number}</span>
            <div className="mb-3 flex min-h-7 flex-wrap items-center gap-3"><h2 className="text-heading">{step.title}</h2>{step.system && <span className="flex items-center gap-1.5 border-l border-ui-stroke pl-3 text-caption text-ui-muted">{step.system === "Local" ? <Cpu aria-hidden className="size-3.5" /> : step.system === "You" ? <CheckCheck aria-hidden className="size-3.5" /> : <Monitor aria-hidden className="size-3.5" />}{step.system}</span>}{blocked && <span className="ml-auto text-caption text-ui-muted">Stopped by preview result</span>}</div>
            <ExplorerParts parts={step.parts} step={step} scenario={scenario} onScenario={updateScenario} onMockChoice={updateMockChoice} open={open} onToggle={onToggle} onStep={(number) => focusAt(number)} selected={selected} disabled={blocked} comments={comments} onComments={setComments}
              onSource={(field, from, trigger, form) => { origin.current = trigger; originAddress.current = { step: from.number, fieldId: field.id }; setSource({ field, step: from, form }); setSelected(undefined); setPendingFocus(undefined); focusRequest.current = undefined; }} />
          </li>;
        })}
      </ol>
      <p className={`ml-10 mt-3 border-t border-ui-stroke pt-4 text-body ${stop === undefined ? "text-ui-secondary" : "text-ui-danger"}`}>{stop === undefined ? completion : "This preview path stops before downstream writes."}</p>
    </div>
    {source && <ExplorerSource key={`${source.step.number}-${source.field.id}`} label={source.field.label} destination={`${source.step.system ?? "Local"} · ${source.form ?? `Step ${source.step.number}`}`} source={sourceFor(source.field, source.step.number)} onClose={closeSource} onJump={(step, fieldId) => {
      setSource(undefined); setSelected(fieldId === undefined ? `explorer-step-${step}` : `explorer-field-${step}-${fieldId}`); focusAt(step, fieldId);
    }} />}
    {selected && <div onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); returnToField(); } }} className={`fixed bottom-6 right-6 z-40 flex items-center gap-3 rounded-lg border border-ui-stroke bg-ui-panel px-3 py-2 text-body ${dsElev.mid}`}>
      <span className="text-ui-secondary">Original source</span><Button size="toolbar" variant="secondary" icon={<ArrowUpRight aria-hidden className="size-3.5" />} onClick={returnToField}>Return to filled field</Button><IconButton label="Dismiss source highlight" size="sm" onClick={() => setSelected(undefined)} icon={<X aria-hidden className="size-3.5" />} />
    </div>}
  </>;
}
