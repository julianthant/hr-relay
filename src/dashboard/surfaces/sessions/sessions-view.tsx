import { IDLE_REFRESH_MS, type IdleSessionCountdown } from './session-idle-model.js';
import { useViewState } from "../../app/navigation/view-route-model.js";
import { SETTINGS_GEAR_ID } from "../settings/settings-model.js";
import { useId, useRef, useState } from "react";
import { Settings, ChevronDown, ChevronUp, Minus, Monitor, Pause, Play, Plus, RotateCw, Square, Trash2, UsersRound } from "lucide-react";
import { ActionBarRow, Button, Dialog, DialogBody, DialogContent, DialogFooter, DialogTrigger, Field, Input, Select, Skeleton } from "../../ds/ui.js";
import { cn } from "../../lib/utils.js";
import { SESSION_STATE_LABELS, sessionStateColor, sessionTallies, type SessionControl, type SessionWorker, type SessionsViewState } from "./sessions-view-model.js";
import type { SessionPreviewOperation } from "./session-preview-command-model.js";
import { SessionTimeline } from "./session-timeline.js";
import { LoadingRegion, SkeletonText } from "../shared/loading/loading.js";

function SessionsSkeleton() {
  return <LoadingRegion label="Loading sessions" className="flex gap-3 overflow-hidden">{[0, 1, 2].map(index => <div key={index} aria-hidden className="flex w-80 shrink-0 flex-col rounded-lg border border-ui-stroke bg-ui-panel p-3">
    <div className="flex items-center justify-between gap-3"><SkeletonText className="w-32 text-control" /><SkeletonText className="w-14 text-caption" /></div><div className="mt-1 text-caption"><SkeletonText className="w-4/5" /></div>
    <div className="mb-3 mt-3 grid grid-cols-2 gap-1.5">{[0, 1, 2, 3].map(browser => <div key={browser} className="flex min-h-8 items-center rounded-md bg-ui-table px-2 py-1"><SkeletonText className="w-full text-caption" /></div>)}</div>
    <div className="mt-auto min-h-10 border-t border-ui-stroke pt-2"><SkeletonText className="w-3/4 text-body" /><Skeleton className="mt-2 h-1.5" /></div>
    <div className="mt-2 flex min-h-8 items-center justify-between border-t border-ui-stroke pt-2"><SkeletonText className="w-14 text-caption" /><Skeleton className="h-6 w-14" /></div>
  </div>)}</LoadingRegion>;
}

function IdleRefreshRing({ countdown }: { countdown: IdleSessionCountdown }) {
  const seconds = Math.ceil(countdown.remainingMs / 1000);
  const label = countdown.waiting ? 'Checking idle session refresh' : `Session refresh in ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  return <span role="img" aria-label={label} title={label} className="inline-flex size-4 shrink-0 rounded-full bg-black/30"><svg aria-hidden viewBox="0 0 20 20" className="size-4 -rotate-90"><circle cx="10" cy="10" r="8" fill="none" stroke="white" opacity=".25" strokeWidth="2" /><circle cx="10" cy="10" r="8" fill="none" stroke="white" strokeWidth="2" pathLength="1" strokeDasharray="1" strokeDashoffset={1 - countdown.remainingMs / IDLE_REFRESH_MS} /></svg></span>;
}

function WorkerCard({ countdown, worker, onControl, operation, onCheck }: { countdown?: IdleSessionCountdown; worker: SessionWorker; onControl: (id: string, control: SessionControl) => void; operation?: SessionPreviewOperation; onCheck?: (id: string) => void }) {
  const locked = operation !== undefined && ['pending', 'checking', 'uncertain'].includes(operation.state);
  return <article aria-label={`${worker.label} · ${worker.workflow}`} className="flex w-80 shrink-0 flex-col rounded-lg border border-ui-stroke bg-ui-panel p-3">
    <header className="flex items-center justify-between gap-3"><h3 className="m-0 text-control font-semibold">{worker.workflow}</h3><span className={cn("inline-flex items-center gap-1.5 text-caption", sessionStateColor(worker.state))}>{worker.state === "idle" && countdown ? <IdleRefreshRing countdown={countdown} /> : <span aria-hidden className="size-1.5 rounded-full bg-current" />}{SESSION_STATE_LABELS[worker.state]}</span></header>
    <p className="mb-0 mt-1 text-caption text-ui-secondary">{worker.subject ?? "No run assigned"}</p>
    <ul aria-label={`${worker.label} systems`} className="mb-3 mt-3 grid list-none grid-cols-2 gap-1.5 pl-0">{worker.browsers.map(browser => <li key={browser.id} className="flex min-h-8 min-w-0 items-center justify-between gap-2 rounded-md bg-ui-table px-2 py-1 text-caption last:odd:col-span-2"><span className="flex min-w-0 items-center gap-1"><Monitor aria-hidden className="size-3 shrink-0 text-ui-muted" /><span className="truncate">{browser.label}</span></span><span className={cn("shrink-0", browser.state === "unavailable" ? "text-ui-danger" : browser.state === "starting" ? "text-ui-warning" : browser.state === "active" ? "text-ui-info" : "text-ui-secondary")}>{browser.state === "active" ? "In use" : browser.state === "ready" ? "Ready" : browser.state === "starting" ? "Opening" : "Unavailable"}</span></li>)}</ul>
    <div className="mt-auto min-h-10 border-t border-ui-stroke pt-2">
      {worker.timeline ? <SessionTimeline nodes={worker.timeline} label={`${worker.label} node timeline`} action={worker.action} /> : worker.state === "idle" ? <div><p className="mb-2 mt-0 text-body">Ready for the next run</p><div role="img" aria-label="No run in progress" className="h-1.5 w-full rounded-sm bg-ui-stroke-control" /></div> : <p className="m-0 text-body">{worker.action}</p>}
      {worker.problem && <p className="mb-0 mt-2 text-caption text-ui-danger">{worker.problem}</p>}
    </div>
    {operation && (operation.request.action !== 'refresh' || ['refused', 'uncertain'].includes(operation.state)) && <div role={operation.state === 'refused' || operation.state === 'uncertain' ? 'alert' : 'status'} className={cn('mt-2 flex items-center justify-between gap-2 text-caption', operation.state === 'refused' ? 'text-ui-danger' : operation.state === 'uncertain' ? 'text-ui-warning' : 'text-ui-secondary')}><span>{operation.message}</span>{operation.state === 'uncertain' && <Button size="sm" variant="secondary" onClick={() => onCheck?.(worker.id)}>Check outcome</Button>}</div>}
    <footer className="mt-2 flex min-h-8 items-center justify-between gap-2 border-t border-ui-stroke pt-2"><span className="text-caption tabular-nums text-ui-muted">{worker.elapsed ?? (worker.state === "idle" ? "Available" : "Not measured")}</span><span className="flex items-center gap-1">
      {worker.state === "running" && <Button size="sm" variant="ghost" className="size-6 p-0" disabled={locked} aria-label="Pause" title="Pause" icon={<Pause aria-hidden className="size-3.5" />} onClick={() => onControl(worker.id, "pause")} />}
      {worker.state === "paused" && <Button size="sm" variant="ghost" className="size-6 p-0" disabled={locked} aria-label="Resume" title="Resume" icon={<Play aria-hidden className="size-3.5" />} onClick={() => onControl(worker.id, "resume")} />}
      {worker.state === "failed" && <Button size="sm" variant="ghost" className="size-6 p-0" disabled={locked} aria-label="Retry" title="Retry" icon={<RotateCw aria-hidden className="size-3.5" />} onClick={() => onControl(worker.id, "retry")} />}
      {worker.state !== "idle" ? <Button size="sm" variant="ghost" className="size-6 p-0" disabled={locked} aria-label="Stop" title="Stop" icon={<Square aria-hidden className="size-3.5" />} onClick={() => onControl(worker.id, "stop")} /> : <Button size="sm" variant="ghost" className="size-6 p-0" disabled={locked} aria-label="Remove worker" title="Remove worker" icon={<Trash2 aria-hidden className="size-3.5" />} onClick={() => onControl(worker.id, "remove")} />}
    </span></footer>
  </article>;
}

export function SessionsView({ data, open, onOpenChange, onControl, onAdd, workflows, settingsOpen, onSettings, operations = {}, onCheck, idleCountdowns = {} }: {
  data: SessionsViewState; open: boolean; onOpenChange: (open: boolean) => void;
  onControl: (id: string, control: SessionControl) => void; onAdd: (workflowId: string, count: number) => void;
  idleCountdowns?: Readonly<Record<string, IdleSessionCountdown>>;
  operations?: Readonly<Record<string, SessionPreviewOperation>>; onCheck?: (id: string) => void;
  workflows: readonly { id: string; label: string }[]; settingsOpen?: boolean; onSettings?: () => void;
}) {
  const contentId = useId();
  const toggleRef = useRef<HTMLButtonElement>(null);
  const [addOpen, setAddOpen] = useViewState("addWorkers", false);
  const [workflow, setWorkflow] = useViewState("workerWorkflow", workflows[0]?.id ?? "");
  const [count, setCount] = useState("1");
  const validCount = Number.isSafeInteger(Number(count)) && Number(count) >= 1 && Number(count) <= 20;
  const addLocked = operations.add !== undefined && ["pending", "checking", "uncertain"].includes(operations.add.state);
  const selectedWorkflow = workflows.find(item => item.id === workflow) ?? workflows[0];
  const selectedWorkflowId = selectedWorkflow?.id ?? "";
  const validWorkflow = selectedWorkflow !== undefined;
  return <section aria-label="Session Panel" className="ui-theme-scope shrink-0 border-t border-ui-stroke bg-ui-panel font-ui text-ui-primary [--ds-control-bg:var(--ui-table)] [--ds-control-bg-hover:var(--ui-hover)] [--ds-control-fg:var(--ui-primary)] [--ds-border-strong:var(--ui-stroke-control)] [--ds-focus-ring:var(--ui-info)]">
    <ActionBarRow label="Session actions" className="relative h-11 gap-3 px-3">
      <button ref={toggleRef} type="button" aria-expanded={open} aria-controls={contentId} onClick={() => onOpenChange(!open)} className="session-panel-toggle absolute inset-y-0 left-0 right-[104px] cursor-pointer focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ui-info"><span className="sr-only">Sessions</span></button>
      <span aria-hidden className="pointer-events-none relative flex shrink-0 items-center gap-2 px-1 py-1.5">{open ? <ChevronDown className="size-3.5 text-ui-muted" /> : <ChevronUp className="size-3.5 text-ui-muted" />}<UsersRound className="size-3.5 text-ui-muted" /><span className="text-heading">Sessions</span></span>
      <span className="pointer-events-none relative flex min-w-0 items-center gap-3 border-l border-ui-stroke pl-3 text-caption">{data.state === "ready" ? data.workers.length ? sessionTallies(data.workers).filter(tally => tally.count > 0).map(tally => <span key={tally.state} className="inline-flex items-center gap-1.5 whitespace-nowrap"><span aria-hidden className={cn("size-1.5 rounded-full bg-current", sessionStateColor(tally.state))} /><span className="tabular-nums">{tally.count}</span><span className="text-ui-secondary">{SESSION_STATE_LABELS[tally.state].toLocaleLowerCase()}</span></span>) : <span className="text-ui-muted">No workers</span> : <span className="text-ui-muted">{data.state === "loading" ? "Loading" : "Unavailable"}</span>}</span>
      <span className="relative z-10 ml-auto flex shrink-0 items-center gap-2">
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild><Button size="sm" variant="ghost" className="size-8 p-0" aria-label="Add workers" disabled={data.state !== "ready" || !workflows.length || addLocked} icon={<Plus aria-hidden className="size-4" />} /></DialogTrigger>
          <DialogContent title="Add workers" description="Select a workflow and worker count." className="ui-theme-scope max-w-[20rem] overflow-visible bg-ui-panel font-ui text-ui-primary [--ds-control-bg:var(--ui-field)] [--ds-control-bg-hover:var(--ui-hover)] [--ds-control-fg:var(--ui-primary)] [--ds-border-strong:var(--ui-stroke-control)] [--ds-focus-ring:var(--ui-info)]" size="sm">
            <DialogBody><div className="grid gap-3">
              <Field label="Workflow"><Select value={selectedWorkflowId} onChange={event => setWorkflow(event.target.value)}>{workflows.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</Select></Field>
              <Field label="Workers"><div className="flex items-center gap-2">
                <Button variant="secondary" aria-label="Remove one worker" icon={<Minus aria-hidden className="size-3.5" />} disabled={!validCount || Number(count) <= 1} onClick={() => setCount(String(Number(count) - 1))} />
                <Input aria-label="Workers" className="min-w-0 flex-1 text-center tabular-nums" type="number" min={1} max={20} step={1} value={count} onChange={event => setCount(event.target.value)} />
                <Button variant="secondary" aria-label="Add one worker" icon={<Plus aria-hidden className="size-3.5" />} disabled={!validCount || Number(count) >= 20} onClick={() => setCount(String(Number(count) + 1))} />
              </div></Field>
            </div></DialogBody>
            <DialogFooter><Button variant="muted" onClick={() => setAddOpen(false)}>Cancel</Button><Button variant="outline" disabled={!validCount || !validWorkflow || data.state !== "ready" || addLocked} onClick={() => { onAdd(selectedWorkflowId, Number(count)); setAddOpen(false); onOpenChange(true); }}>Add workers</Button></DialogFooter>
          </DialogContent>
        </Dialog>
        {onSettings && <Button id={SETTINGS_GEAR_ID} size="sm" variant="ghost" className="size-8 p-0" aria-label="Settings" aria-pressed={settingsOpen} onClick={onSettings} icon={<Settings aria-hidden className="size-4" />} />}
      </span>
    </ActionBarRow>
    {operations.add && <div role={operations.add.state === 'refused' || operations.add.state === 'uncertain' ? 'alert' : 'status'} className="flex items-center gap-2 border-t border-ui-stroke px-4 py-2 text-caption"><span>{operations.add.message}</span>{operations.add.state === 'uncertain' && <Button size="sm" variant="secondary" onClick={() => onCheck?.('add')}>Check outcome</Button>}</div>}
    {open && <div id={contentId} className="max-h-[24rem] overflow-y-auto border-t border-ui-stroke bg-ui-canvas p-3">
      {data.state === "ready" ? data.workers.length ? <div data-session-strip className="flex items-stretch gap-3 overflow-x-auto pb-1">{data.workers.map(worker => <WorkerCard key={worker.id} countdown={idleCountdowns[worker.id]} worker={worker} operation={operations[worker.id]} onCheck={onCheck} onControl={(id, control) => { onControl(id, control); if (control === "remove") toggleRef.current?.focus(); }} />)}</div> : <div className="flex min-h-32 flex-col items-center justify-center gap-2 text-center"><UsersRound aria-hidden className="size-5 text-ui-muted" /><h3 className="m-0 text-heading">No workers yet</h3><p className="m-0 text-body text-ui-secondary">Add workers to start processing runs.</p></div> : data.state === "loading" ? <SessionsSkeleton /> : <div role="alert" className="flex min-h-32 flex-col items-center justify-center gap-2 text-center"><h3 className="m-0 text-heading">Sessions unavailable</h3><p className="m-0 text-body text-ui-secondary">{data.reason}</p></div>}
    </div>}
  </section>;
}
