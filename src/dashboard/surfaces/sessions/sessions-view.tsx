import { useId, useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp, Monitor, Pause, Play, Plus, RotateCw, Square, UsersRound } from "lucide-react";
import { ActionBarRow, Button, Dialog, DialogBody, DialogContent, DialogFooter, DialogTrigger, Field, Input, Select, Skeleton } from "../../ds/ui.js";
import { cn } from "../../lib/utils.js";
import { SESSION_STATE_LABELS, sessionStateColor, sessionTallies, type SessionControl, type SessionWorker, type SessionsViewState } from "./sessions-view-model.js";
import { SessionTimeline } from "./session-timeline.js";

function WorkerCard({ worker, onControl }: { worker: SessionWorker; onControl: (id: string, control: SessionControl) => void }) {
  return <article aria-label={`${worker.label} · ${worker.workflow}`} className="flex w-80 shrink-0 flex-col rounded-lg border border-ui-stroke bg-ui-table p-3">
    <header className="flex items-center justify-between gap-3"><h3 className="m-0 text-control font-semibold">{worker.workflow}</h3><span className={cn("inline-flex items-center gap-1.5 text-caption", sessionStateColor(worker.state))}><span aria-hidden className="size-1.5 rounded-full bg-current" />{SESSION_STATE_LABELS[worker.state]}</span></header>
    <p className="mb-0 mt-1 text-caption text-ui-secondary">{worker.subject ?? "No run assigned"}</p>
    <div className="mt-2 min-h-10">
      {worker.timeline ? <SessionTimeline nodes={worker.timeline} label={`${worker.label} node timeline`} action={worker.action} /> : <p className="m-0 text-body">{worker.action}</p>}
      {worker.problem && <p className="mb-0 mt-2 text-caption text-ui-danger">{worker.problem}</p>}
    </div>
    <ul aria-label={`${worker.label} systems`} className="mb-2 mt-2 grid list-none grid-cols-2 gap-1.5 border-t border-ui-stroke pt-2 pl-0">{worker.browsers.map(browser => <li key={browser.id} className="flex min-h-8 min-w-0 items-center justify-between gap-2 rounded-md bg-ui-panel px-2 py-1 text-caption"><span className="flex min-w-0 items-center gap-1"><Monitor aria-hidden className="size-3 shrink-0 text-ui-muted" /><span className="truncate">{browser.label}</span></span><span className={cn("shrink-0", browser.state === "unavailable" ? "text-ui-danger" : browser.state === "starting" ? "text-ui-warning" : browser.state === "active" ? "text-ui-info" : "text-ui-secondary")}>{browser.state === "active" ? "In use" : browser.state === "ready" ? "Ready" : browser.state === "starting" ? "Opening" : "Unavailable"}</span></li>)}</ul>
    <footer className="mt-auto flex min-h-8 items-center justify-between gap-2 border-t border-ui-stroke pt-2"><span className="text-caption tabular-nums text-ui-muted">{worker.elapsed ?? (worker.state === "idle" ? "Available" : "Not measured")}</span><span className="flex items-center gap-1">
      {worker.state === "running" && <Button size="sm" variant="ghost" icon={<Pause aria-hidden className="size-3" />} onClick={() => onControl(worker.id, "pause")}>Pause</Button>}
      {worker.state === "paused" && <Button size="sm" variant="ghost" icon={<Play aria-hidden className="size-3" />} onClick={() => onControl(worker.id, "resume")}>Resume</Button>}
      {worker.state === "failed" && <Button size="sm" variant="ghost" icon={<RotateCw aria-hidden className="size-3" />} onClick={() => onControl(worker.id, "retry")}>Retry</Button>}
      {worker.state !== "idle" && <Button size="sm" variant="ghost" icon={<Square aria-hidden className="size-3" />} onClick={() => onControl(worker.id, "stop")}>Stop</Button>}
    </span></footer>
  </article>;
}

export function SessionsView({ data, open, onOpenChange, onControl, onAdd, workflows, sampleControl, notice }: {
  data: SessionsViewState; open: boolean; onOpenChange: (open: boolean) => void;
  onControl: (id: string, control: SessionControl) => void; onAdd: (workflowId: string, count: number) => void;
  workflows: readonly { id: string; label: string }[]; sampleControl?: ReactNode; notice?: string;
}) {
  const contentId = useId();
  const [addOpen, setAddOpen] = useState(false);
  const [workflow, setWorkflow] = useState(workflows[0]?.id ?? "");
  const [count, setCount] = useState("1");
  const validCount = Number.isSafeInteger(Number(count)) && Number(count) >= 1 && Number(count) <= 6;
  const validWorkflow = workflows.some(item => item.id === workflow);
  return <section aria-label="Session Panel" className="ui-theme-scope shrink-0 border-t border-ui-stroke bg-ui-panel font-ui text-ui-primary [--ds-control-bg:var(--ui-table)] [--ds-control-bg-hover:var(--ui-hover)] [--ds-control-fg:var(--ui-primary)] [--ds-border-strong:var(--ui-stroke-control)] [--ds-focus-ring:var(--ui-info)]">
    <ActionBarRow label="Session actions" className="h-11 gap-3 px-3"><button type="button" aria-expanded={open} aria-controls={contentId} onClick={() => onOpenChange(!open)} className="flex shrink-0 items-center gap-2 rounded-md px-1 py-1.5 hover:bg-ui-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ui-info">{open ? <ChevronDown aria-hidden className="size-3.5 text-ui-muted" /> : <ChevronUp aria-hidden className="size-3.5 text-ui-muted" />}<UsersRound aria-hidden className="size-3.5 text-ui-muted" /><span className="text-heading">Sessions</span></button>
      <span className="flex min-w-0 items-center gap-3 text-caption">{data.state === "ready" ? sessionTallies(data.workers).map(tally => <span key={tally.state} className="inline-flex items-center gap-1.5 whitespace-nowrap"><span aria-hidden className={cn("size-1.5 rounded-full bg-current", sessionStateColor(tally.state))} /><span className="tabular-nums">{tally.count}</span><span className="text-ui-secondary">{SESSION_STATE_LABELS[tally.state].toLocaleLowerCase()}</span></span>) : <span className="text-ui-muted">{data.state === "loading" ? "Loading" : "Unavailable"}</span>}</span>
      <span className="ml-auto flex shrink-0 items-center gap-2">{sampleControl}<Dialog open={addOpen} onOpenChange={setAddOpen}><DialogTrigger asChild><Button size="sm" variant="ghost" disabled={data.state !== "ready" || !workflows.length} icon={<Plus aria-hidden className="size-3.5" />}>Add workers</Button></DialogTrigger><DialogContent title="Add workers" description="Choose a workflow and how many workers to show." className="ui-theme-scope bg-ui-panel font-ui text-ui-primary" size="sm"><DialogBody><div className="grid gap-4"><Field label="Workflow"><Select value={workflow} onChange={event => setWorkflow(event.target.value)}>{workflows.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</Select></Field><Field label="Workers" description="1 to 6 workers"><Input type="number" min={1} max={6} step={1} value={count} onChange={event => setCount(event.target.value)} /></Field></div></DialogBody><DialogFooter><Button variant="secondary" onClick={() => setAddOpen(false)}>Cancel</Button><Button disabled={!validCount || !validWorkflow || data.state !== "ready"} onClick={() => { onAdd(workflow, Number(count)); setAddOpen(false); onOpenChange(true); }}>Add to preview</Button></DialogFooter></DialogContent></Dialog></span>
    </ActionBarRow>
    {notice && <p role="status" className="m-0 border-t border-ui-stroke px-4 py-2 text-caption text-ui-secondary">{notice}</p>}
    {open && <div id={contentId} className="max-h-[24rem] overflow-y-auto border-t border-ui-stroke p-3">
      {data.state === "ready" ? data.workers.length ? <div data-session-strip className="flex items-stretch gap-3 overflow-x-auto pb-1">{data.workers.map(worker => <WorkerCard key={worker.id} worker={worker} onControl={onControl} />)}</div> : <div className="flex min-h-32 flex-col items-center justify-center gap-2 text-center"><UsersRound aria-hidden className="size-5 text-ui-muted" /><h3 className="m-0 text-heading">No workers yet</h3><p className="m-0 text-body text-ui-secondary">Add workers to preview this layout.</p></div> : data.state === "loading" ? <div role="status" aria-label="Loading sessions" className="flex gap-3 overflow-hidden">{[1, 2, 3].map(item => <Skeleton key={item} className="h-60 w-72 shrink-0 rounded-lg" />)}</div> : <div role="alert" className="flex min-h-32 flex-col items-center justify-center gap-2 text-center"><h3 className="m-0 text-heading">Sessions unavailable</h3><p className="m-0 text-body text-ui-secondary">{data.reason}</p></div>}
    </div>}
  </section>;
}
