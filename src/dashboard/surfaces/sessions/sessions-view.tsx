import { type IdleSessionCountdown } from './session-idle-model.js';
import { useViewState } from "../../app/navigation/view-route-model.js";
import { AssistantLauncher } from "../shell/assistant-launcher.js";
import { useContext, useId, useLayoutEffect, useRef, useState } from "react";
import { FirstScreenRevealedContext } from "../../app/startup/first-screen.js";
import { ChevronDown, ChevronUp, Loader2, LogOut, Minus, Plus, Settings, UsersRound } from "lucide-react";
import { BareButton, Button, Dialog, DialogBody, DialogContent, DialogFooter, DialogTrigger, dsFocus, Field, IconButton, Input, Select, Skeleton, Tooltip, useSkeletonWait } from "../../ds/ui.js";
import { SETTINGS_GEAR_ID } from "../settings/settings-model.js";
import { cn } from "../../lib/utils.js";
import { isQuietIdle, SESSION_STATE_LABELS, sessionTallies, type SessionControl, type SessionsViewState } from "./sessions-view-model.js";
import type { SessionPreviewOperation } from "./session-preview-command-model.js";
import { IdleWorkerRow, WorkerCard } from "./worker-card.js";
import { LoadingRegion, SkeletonText } from "../shared/loading/loading.js";

/** The bar's counts: one quiet summary line; only the running count is green, like the rail's running pill. */
function BarCounts({ data }: { data: SessionsViewState }) {
  if (data.state !== "ready") return <span className="text-body text-ui-muted">{data.state === "loading" ? "Loading" : "Unavailable"}</span>;
  const tallies = sessionTallies(data.workers).filter(tally => tally.count > 0);
  if (tallies.length === 0) return <span className="text-body text-ui-muted">No workers{data.stale && <StaleMark />}</span>;
  return <span className="text-body text-ui-secondary">{tallies.map((tally, index) => <span key={tally.state}>{index > 0 && <span className="px-1.5 text-ui-muted">·</span>}
    <span className={cn("tabular-nums", tally.state === "running" && "font-medium text-ui-positive")}>{tally.count} {SESSION_STATE_LABELS[tally.state].toLocaleLowerCase()}</span></span>)}{data.stale && <StaleMark />}</span>;
}

/** Says the counts are from the day last read; like a skeleton, it shows only once the new day has been slow. */
function StaleMark() {
  const waiting = useSkeletonWait();
  return <span className={cn("text-ui-muted", waiting && "invisible")}><span aria-hidden className="px-1.5">·</span><span data-sessions-stale>Updating</span></span>;
}

function SessionsSkeleton() {
  return <LoadingRegion label="Loading sessions" className="flex gap-3 overflow-hidden">{[0, 1, 2].map(index => <div key={index} aria-hidden className="flex w-[22rem] shrink-0 flex-col rounded-lg border border-ui-stroke bg-ui-panel px-4 py-3">
    <div className="flex items-center justify-between gap-3"><SkeletonText className="w-32 text-control" /><SkeletonText className="w-14 text-caption" /></div><div className="mt-1 text-caption"><SkeletonText className="w-4/5" /></div>
    <div className="grid grid-cols-2 gap-1.5 py-3">{[0, 1, 2, 3].map(browser => <div key={browser} className="flex min-h-8 items-center rounded-md bg-ui-table px-2 py-1"><SkeletonText className="w-full text-caption" /></div>)}</div>
    <div className="border-t border-ui-stroke pt-2"><div className="flex h-7 items-center justify-between"><SkeletonText className="w-14 text-caption" /><Skeleton className="h-6 w-14" /></div></div>
  </div>)}</LoadingRegion>;
}

export function SessionsView({ data, open, onOpenChange, onControl, onAdd, workflows, operations = {}, idleCountdowns = {}, account }: {
  data: SessionsViewState; open: boolean; onOpenChange: (open: boolean) => void;
  onControl: (id: string, control: SessionControl) => void; onAdd: (workflowId: string, count: number) => void;
  idleCountdowns?: Readonly<Record<string, IdleSessionCountdown>>;
  operations?: Readonly<Record<string, SessionPreviewOperation>>;
  workflows: readonly { id: string; label: string }[];
  account?: { onSettings: () => void; onLogout: () => void };
}) {
  const contentId = useId();
  const toggleRef = useRef<HTMLButtonElement>(null);
  const dockRef = useRef<HTMLElement>(null);
  // The columns, Settings content and assistant panel end above the bar, so its height is published for them.
  useLayoutEffect(() => {
    const dock = dockRef.current;
    if (dock === null) return;
    const root = document.documentElement;
    const publish = () => root.style.setProperty("--session-dock-h", `${String(dock.offsetHeight)}px`);
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(dock);
    return () => { observer.disconnect(); root.style.removeProperty("--session-dock-h"); };
  }, []);
  const actionable = data.state === "ready" && !data.stale;
  const workers = data.state === "ready" ? data.workers : [];
  const idle = workers.filter(isQuietIdle);
  const cards = workers.filter(worker => !isQuietIdle(worker));
  const onWorkerControl = (id: string, control: SessionControl) => { onControl(id, control); if (control === "remove") toggleRef.current?.focus(); };
  const addTriggerRef = useRef<HTMLButtonElement>(null);
  const addFocusOrigin = useRef<Element | null>(null);
  const [addOpen, setAddOpen] = useViewState("addWorkers", false);
  const firstScreenRevealed = useContext(FirstScreenRevealedContext);
  const [workflow, setWorkflow] = useViewState("workerWorkflow", workflows[0]?.id ?? "");
  const [count, setCount] = useState("1");
  const validCount = Number.isSafeInteger(Number(count)) && Number(count) >= 1;
  const addLocked = operations.add?.state === "pending";
  const pendingAdd = operations.add?.state === "pending" && operations.add.request.action === "add" ? operations.add.request : undefined;
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
  const addControl = <Dialog open={addOpen && firstScreenRevealed} onOpenChange={setAddOpen}>
          {actionable && workflows.length > 0 && <Tooltip side="top" content="Add workers"><DialogTrigger asChild><IconButton ref={addTriggerRef} variant="ghost" size="sm" label="Add workers" title="" disabled={addLocked} icon={<Plus aria-hidden className="size-4" />} /></DialogTrigger></Tooltip>}
          <DialogContent title="Add workers" description="Select a workflow and worker count." className="ui-theme-scope overflow-visible bg-ui-panel font-ui text-ui-primary [--ds-control-bg:var(--ui-field)] [--ds-control-bg-hover:var(--ui-hover)] [--ds-control-fg:var(--ui-primary)] [--ds-border-strong:var(--ui-stroke-control)] [--ds-focus-ring:var(--ui-info)]" size="sm">
            <DialogBody><div className="grid gap-3">
              <Field label="Workflow"><Select value={selectedWorkflowId} onChange={event => setWorkflow(event.target.value)}>{workflows.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</Select></Field>
              <Field label="Workers"><div className="flex items-center gap-2">
                <Button variant="secondary" aria-label="Remove one worker" icon={<Minus aria-hidden className="size-3.5" />} disabled={!validCount || Number(count) <= 1} onClick={() => setCount(String(Number(count) - 1))} />
                <Input aria-label="Workers" className="min-w-0 flex-1 text-center tabular-nums" type="number" min={1} step={1} value={count} onChange={event => setCount(event.target.value)} />
                <Button variant="secondary" aria-label="Add one worker" icon={<Plus aria-hidden className="size-3.5" />} disabled={!validCount || Number(count) >= Number.MAX_SAFE_INTEGER} onClick={() => setCount(String(Number(count) + 1))} />
              </div></Field>
            </div></DialogBody>
            <DialogFooter><Button variant="secondary" onClick={() => setAddOpen(false)}>Cancel</Button><Button variant="primary" disabled={!validCount || !validWorkflow || !actionable || addLocked} onClick={event => { addFocusOrigin.current = event.currentTarget.closest('[role="dialog"]'); onAdd(selectedWorkflowId, Number(count)); setAddOpen(false); onOpenChange(true); }}>Add workers</Button></DialogFooter>
          </DialogContent>
        </Dialog>;
  const toggle = <BareButton ref={toggleRef} type="button" aria-expanded={open} aria-controls={contentId} title="" className={cn("session-toggle", dsFocus)}>
    {open ? <ChevronDown aria-hidden /> : <ChevronUp aria-hidden />}<UsersRound aria-hidden /><span className="session-pill-title">Sessions</span><span aria-hidden className="session-divider" /><span className="session-pill-counts"><BarCounts data={data} /></span>
  </BareButton>;
  return <div className="session-footer ui-theme-scope font-ui text-ui-primary"><section ref={dockRef} aria-label="Session Panel" className="session-dock ui-theme-scope font-ui text-ui-primary [--ds-control-bg:var(--ui-table)] [--ds-control-bg-hover:var(--ui-hover)] [--ds-control-fg:var(--ui-primary)] [--ds-border-strong:var(--ui-stroke-control)] [--ds-focus-ring:var(--ui-info)]">
    <div className="session-bar" aria-label="Session actions" role="group" onClick={event => { const target = event.target as Element; if (event.currentTarget.contains(target) && !target.closest(".session-bar-end")) onOpenChange(!open); }}>
      {toggle}<span className="session-bar-end">{addControl}{account && <>
        <Tooltip side="top" content="Settings"><IconButton id={SETTINGS_GEAR_ID} variant="ghost" size="sm" label="Settings" title="" onClick={account.onSettings} icon={<Settings aria-hidden className="size-4" />} /></Tooltip>
        <Tooltip side="top" content="Log out"><IconButton className="hub-logout" variant="ghost" size="sm" label="Log out" title="" onClick={account.onLogout} icon={<LogOut aria-hidden className="size-4" />} /></Tooltip>
      </>}<AssistantLauncher /></span>
    </div>
    {open && <div id={contentId} role="region" aria-label="Sessions" className="session-body">
      <div className="session-body-cards">
      {data.state === "ready" ? data.workers.length || pendingAdd ? <>
        {pendingAdd && <ul aria-label="Workers being added" className="m-0 mb-2 flex list-none flex-col gap-1 p-0"><li aria-busy className="list-none rounded-md bg-[var(--ds-worker-card-bg)] px-3"><div className="flex min-h-8 items-center justify-between gap-3">
          <span className="min-w-0 truncate text-control">{workflows.find(item => item.id === pendingAdd.workflow)?.label ?? pendingAdd.workflow}{pendingAdd.count > 1 && <span className="text-ui-muted"> × {pendingAdd.count}</span>}</span>
          <span className="inline-flex shrink-0 items-center gap-1.5 text-caption text-ui-muted"><Loader2 aria-hidden className="size-3 animate-spin motion-reduce:animate-none" />Starting</span></div></li></ul>}
        {cards.length > 0 && <div data-session-strip className="flex flex-wrap items-stretch gap-3 pb-1">{cards.map(worker => <WorkerCard key={worker.id} countdown={idleCountdowns[worker.id]} worker={worker} operation={operations[worker.id]} disabled={!actionable} onControl={onWorkerControl} />)}</div>}
        {idle.length > 0 && <ul aria-label="Idle workers" className={cn("m-0 flex list-none flex-col gap-1 p-0", cards.length > 0 && "mt-2")}>{idle.map(worker => <IdleWorkerRow key={worker.id} countdown={idleCountdowns[worker.id]} worker={worker} operation={operations[worker.id]} disabled={!actionable} onControl={onWorkerControl} />)}</ul>}
      </> : <div className="flex min-h-32 flex-col items-center justify-center gap-2 text-center"><UsersRound aria-hidden className="size-5 text-ui-muted" /><h3 className="m-0 text-heading">No workers yet</h3><p className="m-0 text-body text-ui-secondary">Add workers to start processing runs.</p></div> : data.state === "loading" ? <SessionsSkeleton /> : <div role="alert" className="flex min-h-32 flex-col items-center justify-center gap-2 text-center"><h3 className="m-0 text-heading">Sessions unavailable</h3><p className="m-0 text-body text-ui-secondary">{data.reason}</p></div>}
      </div>
    </div>}
  </section>
  </div>;
}
