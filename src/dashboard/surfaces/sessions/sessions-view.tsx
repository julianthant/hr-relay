import { type IdleSessionCountdown } from './session-idle-model.js';
import { useViewState } from "../../app/navigation/view-route-model.js";
import { assistantLauncher } from "../shell/assistant-launcher-model.js";
import { AssistantDockField, AssistantIconLauncher } from "../shell/assistant-launcher.js";
import { useId, useLayoutEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Minus, Plus, UsersRound } from "lucide-react";
import { Button, Dialog, DialogBody, DialogContent, DialogFooter, DialogTrigger, Field, Input, Select, Skeleton } from "../../ds/ui.js";
import { cn } from "../../lib/utils.js";
import { SESSION_STATE_LABELS, sessionTallies, type SessionControl, type SessionsViewState } from "./sessions-view-model.js";
import type { SessionPreviewOperation } from "./session-preview-command-model.js";
import { WorkerCard } from "./worker-card.js";
import { LoadingRegion, SkeletonText } from "../shared/loading/loading.js";

/** The bar's counts: one quiet summary line; only the running count is green, like the rail's running pill. */
function BarCounts({ data }: { data: SessionsViewState }) {
  if (data.state !== "ready") return <span className="text-body text-ui-muted">{data.state === "loading" ? "Loading" : "Unavailable"}</span>;
  const tallies = sessionTallies(data.workers).filter(tally => tally.count > 0);
  if (tallies.length === 0) return <span className="text-body text-ui-muted">No workers</span>;
  return <span className="text-body text-ui-secondary">{tallies.map((tally, index) => <span key={tally.state}>{index > 0 && <span className="px-1.5 text-ui-muted">·</span>}
    <span className={cn("tabular-nums", tally.state === "running" && "font-medium text-ui-positive")}>{tally.count} {SESSION_STATE_LABELS[tally.state].toLocaleLowerCase()}</span></span>)}</span>;
}

function SessionsSkeleton() {
  return <LoadingRegion label="Loading sessions" className="flex gap-3 overflow-hidden">{[0, 1, 2].map(index => <div key={index} aria-hidden className="flex w-[22rem] shrink-0 flex-col rounded-lg border border-ui-stroke bg-ui-panel px-4 py-3">
    <div className="flex items-center justify-between gap-3"><SkeletonText className="w-32 text-control" /><SkeletonText className="w-14 text-caption" /></div><div className="mt-1 text-caption"><SkeletonText className="w-4/5" /></div>
    <div className="mb-3 mt-3 grid grid-cols-2 gap-1.5">{[0, 1, 2, 3].map(browser => <div key={browser} className="flex min-h-8 items-center rounded-md bg-ui-table px-2 py-1"><SkeletonText className="w-full text-caption" /></div>)}</div>
    <div className="mt-auto min-h-10 border-t border-ui-stroke pt-2"><SkeletonText className="w-3/4 text-body" /><Skeleton className="mt-2 h-1.5" /></div>
    <div className="mt-2 flex min-h-8 items-center justify-between border-t border-ui-stroke pt-2"><SkeletonText className="w-14 text-caption" /><Skeleton className="h-6 w-14" /></div>
  </div>)}</LoadingRegion>;
}

export function SessionsView({ data, open, onOpenChange, onControl, onAdd, workflows, operations = {}, onCheck, idleCountdowns = {} }: {
  data: SessionsViewState; open: boolean; onOpenChange: (open: boolean) => void;
  onControl: (id: string, control: SessionControl) => void; onAdd: (workflowId: string, count: number) => void;
  idleCountdowns?: Readonly<Record<string, IdleSessionCountdown>>;
  operations?: Readonly<Record<string, SessionPreviewOperation>>; onCheck?: (id: string) => void;
  workflows: readonly { id: string; label: string }[];
}) {
  const contentId = useId();
  const toggleRef = useRef<HTMLButtonElement>(null);
  const addTriggerRef = useRef<HTMLButtonElement>(null);
  const addFocusOrigin = useRef<Element | null>(null);
  const [addOpen, setAddOpen] = useViewState("addWorkers", false);
  const [workflow, setWorkflow] = useViewState("workerWorkflow", workflows[0]?.id ?? "");
  const [count, setCount] = useState("1");
  const validCount = Number.isSafeInteger(Number(count)) && Number(count) >= 1;
  const addLocked = operations.add !== undefined && ["pending", "checking", "uncertain"].includes(operations.add.state);
  const selectedWorkflow = workflows.find(item => item.id === workflow) ?? workflows[0];
  const selectedWorkflowId = selectedWorkflow?.id ?? "";
  const validWorkflow = selectedWorkflow !== undefined;
  useLayoutEffect(() => {
    const origin = addFocusOrigin.current;
    const trigger = addTriggerRef.current;
    if (origin === null || addOpen || trigger === null || trigger.disabled) return;
    addFocusOrigin.current = null;
    const active = document.activeElement;
    if (active !== null && active !== document.body && active.isConnected && active !== trigger && !origin.contains(active)) return;
    trigger.focus({ preventScroll: true });
  }, [addOpen, addLocked, data.state, validWorkflow]);
  const addControl = <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild><Button ref={addTriggerRef} size="md" variant="secondary" disabled={data.state !== "ready" || !workflows.length || addLocked} icon={<Plus aria-hidden className="size-4" />}>Add workers</Button></DialogTrigger>
          <DialogContent title="Add workers" description="Select a workflow and worker count." className="ui-theme-scope max-w-[20rem] overflow-visible bg-ui-panel font-ui text-ui-primary [--ds-control-bg:var(--ui-field)] [--ds-control-bg-hover:var(--ui-hover)] [--ds-control-fg:var(--ui-primary)] [--ds-border-strong:var(--ui-stroke-control)] [--ds-focus-ring:var(--ui-info)]" size="sm">
            <DialogBody><div className="grid gap-3">
              <Field label="Workflow"><Select value={selectedWorkflowId} onChange={event => setWorkflow(event.target.value)}>{workflows.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</Select></Field>
              <Field label="Workers"><div className="flex items-center gap-2">
                <Button variant="secondary" aria-label="Remove one worker" icon={<Minus aria-hidden className="size-3.5" />} disabled={!validCount || Number(count) <= 1} onClick={() => setCount(String(Number(count) - 1))} />
                <Input aria-label="Workers" className="min-w-0 flex-1 text-center tabular-nums" type="number" min={1} step={1} value={count} onChange={event => setCount(event.target.value)} />
                <Button variant="secondary" aria-label="Add one worker" icon={<Plus aria-hidden className="size-3.5" />} disabled={!validCount || Number(count) >= Number.MAX_SAFE_INTEGER} onClick={() => setCount(String(Number(count) + 1))} />
              </div></Field>
            </div></DialogBody>
            <DialogFooter><Button variant="muted" onClick={() => setAddOpen(false)}>Cancel</Button><Button variant="outline" disabled={!validCount || !validWorkflow || data.state !== "ready" || addLocked} onClick={event => { addFocusOrigin.current = event.currentTarget.closest('[role="dialog"]'); onAdd(selectedWorkflowId, Number(count)); setAddOpen(false); onOpenChange(true); }}>Add workers</Button></DialogFooter>
          </DialogContent>
        </Dialog>;
  const launcher = assistantLauncher();
  const pill = <button ref={toggleRef} type="button" aria-expanded={open} aria-controls={contentId} title="" onClick={() => onOpenChange(!open)} className={cn("session-pill", launcher !== "b" && "dock-surface")}>
    <span className="session-pill-title">Sessions</span><span aria-hidden className="text-ui-muted">·</span><span className="session-pill-counts"><BarCounts data={data} /></span>
    {open ? <ChevronDown aria-hidden /> : <ChevronUp aria-hidden />}
  </button>;
  return <section aria-label="Session Panel" className="session-dock ui-theme-scope font-ui text-ui-primary [--ds-control-bg:var(--ui-table)] [--ds-control-bg-hover:var(--ui-hover)] [--ds-control-fg:var(--ui-primary)] [--ds-border-strong:var(--ui-stroke-control)] [--ds-focus-ring:var(--ui-info)]">
    {open && <div id={contentId} role="region" aria-label="Sessions" className="session-float">
      <div className="session-float-header"><h2 className="session-float-title">Sessions</h2>{addControl}</div>
      {operations.add && ['uncertain', 'checking'].includes(operations.add.state) && <div role={operations.add.state === 'uncertain' ? 'alert' : 'status'} className="flex items-center gap-2 px-3 pb-2 text-caption"><span>{operations.add.message}</span>{operations.add.state === 'uncertain' && <Button size="sm" variant="secondary" onClick={() => onCheck?.('add')}>Check outcome</Button>}</div>}
      <div className="session-float-body">
      {data.state === "ready" ? data.workers.length ? <div data-session-strip className="flex items-stretch gap-3 overflow-x-auto pb-1">{data.workers.map(worker => <WorkerCard key={worker.id} countdown={idleCountdowns[worker.id]} worker={worker} operation={operations[worker.id]} onCheck={onCheck} onControl={(id, control) => { onControl(id, control); if (control === "remove") toggleRef.current?.focus(); }} />)}</div> : <div className="flex min-h-32 flex-col items-center justify-center gap-2 text-center"><UsersRound aria-hidden className="size-5 text-ui-muted" /><h3 className="m-0 text-heading">No workers yet</h3><p className="m-0 text-body text-ui-secondary">Add workers to start processing runs.</p></div> : data.state === "loading" ? <SessionsSkeleton /> : <div role="alert" className="flex min-h-32 flex-col items-center justify-center gap-2 text-center"><h3 className="m-0 text-heading">Sessions unavailable</h3><p className="m-0 text-body text-ui-secondary">{data.reason}</p></div>}
      </div>
    </div>}
    <div className="dock-row" aria-label="Session actions" role="group">
      {launcher === "b" ? <div className="dock-group dock-surface">{pill}<span aria-hidden className="dock-divider" /><AssistantDockField /></div> : <>{pill}{launcher === "a" && <AssistantIconLauncher />}</>}
    </div>
  </section>;
}
