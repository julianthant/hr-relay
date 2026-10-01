import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowUpRight, CheckCheck, ChevronsUpDown, Cpu, Eye, FileCode2, GitBranch, Keyboard, ListOrdered, Monitor, MousePointer2, PencilLine, Search, Workflow, X } from "lucide-react";
import { Badge, Button, dsElev, dsFocus, IconButton, PageHeader, TakeoverFrame } from "../../ds/ui.js";
import { buildExplorerPreview, EXPLORER_PREVIEW_TITLE, previewFieldSource } from "./explorer-fixture.js";
import { blockedAfter, DEFAULT_COMMENTS, DEFAULT_SCENARIO, type CommentChoices, type FlowField, type FlowStep, type PreviewScenario } from "./explorer-flow-model.js";
import { ExplorerParts } from "./explorer-parts.js";
import { ExplorerSource } from "./explorer-source.js";

export function ExplorerFlow({ onBack, onConnected, onVersionRegistry }: { onBack: () => void; onConnected: () => void; onVersionRegistry: () => void }) {
  const [scenario, setScenario] = useState<PreviewScenario>(DEFAULT_SCENARIO);
  const [comments, setComments] = useState<CommentChoices>(DEFAULT_COMMENTS);
  const [open, setOpen] = useState<Readonly<Record<string, boolean>>>({});
  const [query, setQuery] = useState("");
  const [legend, setLegend] = useState(false);
  const [source, setSource] = useState<{ field: FlowField; step: FlowStep; form?: string }>();
  const [selected, setSelected] = useState<string>();
  const [pendingFocus, setPendingFocus] = useState<string>();
  const origin = useRef<HTMLButtonElement | null>(null);
  const originAddress = useRef<{ step: number; fieldId: string } | undefined>(undefined);
  const focusRequest = useRef<{ anchor: string; focus: string; block: ScrollLogicalPosition } | undefined>(undefined);
  const main = useRef<HTMLDivElement>(null);
  const steps = useMemo(() => buildExplorerPreview(scenario), [scenario]);
  const stop = blockedAfter(scenario);
  const onToggle = (id: string, value: boolean) => setOpen((current) => current[id] === value ? current : { ...current, [id]: value });
  const setAllOpen = (value: boolean) => {
    const next: Record<string, boolean> = {};
    main.current?.querySelectorAll<HTMLDetailsElement>("details[data-disclosure]").forEach((node) => { next[node.dataset.disclosure!] = value; });
    setOpen(next);
  };
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
    focusRequest.current = undefined;
    document.getElementById(request.anchor)?.scrollIntoView({ block: request.block, behavior: "instant" });
    document.getElementById(request.focus)?.focus({ preventScroll: true });
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
    setScenario(next); setSource(undefined); setSelected(undefined); setPendingFocus(undefined); focusRequest.current = undefined;
  };
  return <TakeoverFrame label="Workflow explorer preview" className="ui-theme-scope bg-ui-canvas font-ui text-ui-primary [--ds-surface-3:var(--ui-hover)] [--ds-border-strong:var(--ui-stroke-control)] [--ds-control-bg:var(--ui-table)] [--ds-control-fg:var(--ui-primary)] [--ds-control-bg-hover:var(--ui-hover)] [--ds-focus-ring:var(--ui-info)]">
    <PageHeader title="Explorer" icon={<Workflow aria-hidden className="size-4" />} badge={<Badge className="border-ui-stroke bg-ui-table text-ui-secondary">Mock data</Badge>}
      back={<IconButton label="Back to dashboard" size="sm" onClick={onBack} icon={<ArrowLeft aria-hidden className="size-4" />} />}
      actions={<><Button size="toolbar" variant="secondary" onClick={() => setAllOpen(true)}>Expand all</Button><Button size="toolbar" variant="secondary" onClick={() => setAllOpen(false)}>Collapse all</Button><IconButton label="Show action legend" size="sm" onClick={() => setLegend(!legend)} icon={<ListOrdered aria-hidden className="size-4" />} /><Button size="toolbar" variant="secondary" icon={<FileCode2 aria-hidden className="size-3.5" />} onClick={onConnected}>Registered definition</Button><Button size="toolbar" variant="secondary" icon={<Eye aria-hidden className="size-3.5" />} onClick={onVersionRegistry}>Version registry</Button></>} />
    <div className="grid min-h-0 flex-1 grid-cols-[190px_minmax(0,1fr)] gap-2 p-3 min-[1151px]:grid-cols-[230px_minmax(0,1fr)]">
      <nav aria-label="Preview workflows" className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-ui-stroke bg-ui-panel">
        <label className="m-3 flex h-8 items-center gap-2 rounded-md border border-ui-stroke-control bg-ui-field px-2 text-ui-muted"><Search aria-hidden className="size-3.5 shrink-0" /><input aria-label="Find workflow" placeholder="Find workflow…" value={query} onChange={(event) => setQuery(event.target.value)} className={`min-w-0 flex-1 bg-transparent text-body text-ui-primary placeholder:text-ui-muted ${dsFocus}`} /></label>
        <p className="px-3 pb-2 text-caption text-ui-muted">Workflows</p>
        {EXPLORER_PREVIEW_TITLE.toLowerCase().includes(query.trim().toLowerCase()) ? <button type="button" aria-current="page" onClick={() => { main.current?.scrollTo({ top: 0 }); }} className={`mx-2 flex items-center gap-2 rounded-md bg-ui-hover px-3 py-2.5 text-left text-body ${dsFocus}`}><Workflow aria-hidden className="size-3.5 text-ui-info" /><span className="font-semibold">{EXPLORER_PREVIEW_TITLE}</span><span className="ml-auto text-caption text-ui-muted">22</span></button> : <p className="px-3 py-3 text-body text-ui-secondary">No matching workflow</p>}
        <p className="mt-auto border-t border-ui-stroke px-3 py-3 text-caption text-ui-muted">Fictional workflow · UI preview</p>
      </nav>
      <div ref={main} className="min-h-0 overflow-y-auto rounded-lg border border-ui-stroke bg-ui-canvas px-5 py-6 min-[1151px]:px-6" onKeyDown={(event) => { if (event.key === "Escape" && selected) { event.stopPropagation(); returnToField(); } }}>
        <div className="mb-6 flex items-center gap-3 border-b border-ui-stroke pb-6">
          <div className="min-w-0 flex-1"><h1 className="text-workflow tracking-tight">{EXPLORER_PREVIEW_TITLE}</h1><p className="mt-1.5 text-body text-ui-secondary">Kuali request → UCPath termination → Kuali completion</p></div>
          <Button size="toolbar" variant="secondary" icon={<GitBranch aria-hidden className="size-3.5" />} onClick={() => focusAt(17, undefined, "preview-pending")}>Preview paths</Button>
        </div>
        {legend && <div className="mb-6 flex flex-wrap gap-x-5 gap-y-2 rounded-md border border-ui-stroke bg-ui-table px-3 py-2 text-caption text-ui-secondary" aria-label="Action legend">
          {([[Eye, "Read"], [PencilLine, "Fill"], [MousePointer2, "Click"], [Keyboard, "Key"], [Cpu, "Compute"], [CheckCheck, "Verify"], [ChevronsUpDown, "Expand / collapse"]] as const).map(([Icon, label]) => <span key={label} className="flex items-center gap-1.5"><Icon aria-hidden className="size-3.5" />{label}</span>)}
        </div>}
        <ol aria-label="Workflow steps" className="relative pl-10 before:absolute before:bottom-5 before:left-3.5 before:top-3 before:w-px before:bg-ui-stroke">
          {steps.map((step) => {
            const blocked = stop !== undefined && step.number > stop;
            return <li hidden={blocked} key={step.number} id={`explorer-step-${step.number}`} tabIndex={-1} data-step-number={step.number} data-blocked={blocked || undefined}
              className={`relative border-b border-ui-stroke pb-6 pt-6 first:pt-0 last:border-b-0 ${selected === `explorer-step-${step.number}` ? "rounded-md ring-2 ring-ui-info" : ""}`}>
              <span aria-hidden className={`absolute -left-10 flex size-7 items-center justify-center rounded-full border border-ui-stroke bg-ui-panel font-data text-caption text-ui-secondary ${step.number === 1 ? "top-0" : "top-6"}`}>{step.number}</span>
              <div className="mb-3 flex min-h-7 items-center gap-3"><h2 className="text-heading">{step.title}</h2>{step.system && <span className="flex items-center gap-1.5 border-l border-ui-stroke pl-3 text-caption text-ui-muted">{step.system === "Local" ? <Cpu aria-hidden className="size-3.5" /> : step.system === "You" ? <CheckCheck aria-hidden className="size-3.5" /> : <Monitor aria-hidden className="size-3.5" />}{step.system}</span>}{blocked && <span className="ml-auto text-caption text-ui-muted">Stopped by preview result</span>}</div>
              <ExplorerParts parts={step.parts} step={step} scenario={scenario} onScenario={updateScenario} open={open} onToggle={onToggle} onStep={(number) => focusAt(number)} selected={selected} disabled={blocked} comments={comments} onComments={setComments}
                onSource={(field, from, trigger, form) => { origin.current = trigger; originAddress.current = { step: from.number, fieldId: field.id }; setSource({ field, step: from, form }); setSelected(undefined); setPendingFocus(undefined); focusRequest.current = undefined; }} />
            </li>;
          })}
        </ol>
        <p className={`ml-10 mt-3 border-t border-ui-stroke pt-4 text-body ${stop === undefined ? "text-ui-secondary" : "text-ui-danger"}`}>{stop === undefined ? "Separation filed and Kuali document verified" : "This preview path stops before downstream writes."}</p>
      </div>
    </div>
    {source && <ExplorerSource key={`${source.step.number}-${source.field.id}`} label={source.field.label} destination={`${source.step.system ?? "Local"} · ${source.form ?? `Step ${source.step.number}`}`} source={previewFieldSource(source.field.source ?? "", source.step.number, scenario)} onClose={closeSource} onJump={(step, fieldId) => {
      setSource(undefined); setSelected(fieldId === undefined ? `explorer-step-${step}` : `explorer-field-${step}-${fieldId}`); focusAt(step, fieldId);
    }} />}
    {selected && <div onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); returnToField(); } }} className={`fixed bottom-6 right-6 z-40 flex items-center gap-3 rounded-lg border border-ui-stroke bg-ui-panel px-3 py-2 text-body ${dsElev.mid}`}>
      <span className="text-ui-secondary">Original source</span><Button size="toolbar" variant="secondary" icon={<ArrowUpRight aria-hidden className="size-3.5" />} onClick={returnToField}>Return to filled field</Button><IconButton label="Dismiss source highlight" size="sm" onClick={() => setSelected(undefined)} icon={<X aria-hidden className="size-3.5" />} />
    </div>}
  </TakeoverFrame>;
}
