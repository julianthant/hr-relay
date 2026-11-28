import { type IdleSessionCountdown } from './session-idle-model.js';
import { useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { ChevronDown, ChevronUp, UsersRound, X } from "lucide-react";
import { BareButton, DelayedSpinner, dsFocus, IconButton, Skeleton } from "../../ds/ui.js";
import { cn } from "../../lib/utils.js";
import { SESSIONS_CONSOLE_ID } from "./sessions-context.js";
import "./sessions.css";
import { SESSION_STATE_LABELS, sessionTallies, type SessionControl, type SessionsViewState } from "./sessions-view-model.js";
import type { SessionPreviewOperation } from "./session-preview-command-model.js";
import { StartingCard, WorkerCard } from "./worker-card.js";
import { LoadingRegion, SkeletonText } from "../shared/loading/loading.js";

/** The bar's counts: one quiet summary line. */
function BarCounts({ data }: { data: SessionsViewState }) {
  if (data.state !== "ready") return <span className="text-body text-ui-muted">{data.state === "loading" ? "Loading" : "Unavailable"}</span>;
  const tallies = sessionTallies(data.workers).filter(tally => tally.count > 0);
  if (tallies.length === 0) return <span className="text-body text-ui-muted">No workers{data.stale && <StaleMark />}</span>;
  return <span className="text-body text-ui-muted">{tallies.map((tally, index) => <span key={tally.state}>{index > 0 && <span className="px-1.5">·</span>}
    <span className="tabular-nums">{tally.count} {SESSION_STATE_LABELS[tally.state].toLocaleLowerCase()}</span></span>)}{data.stale && <StaleMark />}</span>;
}

/** Says the counts are from the day last read with a small spinner; like a skeleton, it shows only once the new day has been slow. */
function StaleMark() {
  return <span data-sessions-stale className="ml-1.5 inline-flex size-4 items-center justify-center align-middle"><DelayedSpinner /></span>;
}

function SessionsSkeleton() {
  return <LoadingRegion label="Loading sessions" className="flex gap-3 overflow-hidden">{[0, 1, 2].map(index => <div key={index} aria-hidden className="flex w-[25rem] shrink-0 flex-col rounded-xl border border-ui-stroke bg-ui-panel px-3.5 pb-2.5 pt-3.5">
    <div className="flex items-center justify-between gap-3"><SkeletonText className="w-32 text-control" /><SkeletonText className="w-14 text-caption" /></div><div className="mt-1 text-caption"><SkeletonText className="w-4/5" /></div>
    <div className="grid grid-cols-2 gap-1.5 py-3">{[0, 1, 2, 3].map(browser => <div key={browser} className="flex min-h-8 items-center rounded-md bg-ui-table px-2 py-1"><SkeletonText className="w-full text-caption" /></div>)}</div>
    <div className="border-t border-ui-stroke pt-2"><div className="flex h-7 items-center justify-between"><SkeletonText className="w-14 text-caption" /><Skeleton className="h-6 w-14" /></div></div>
  </div>)}</LoadingRegion>;
}

const MIN_HEIGHT = 120;
const DEFAULT_HEIGHT = 320;
const RESIZE_STEP = 24;

/** The Sessions console: a docked panel under the queue and the log, resizable from its top border; it sizes to its cards up to the dragged height. */
export function SessionsView({ data, open, onOpenChange, onControl, workflows = [], operations = {}, idleCountdowns = {} }: {
  workflows?: readonly { id: string; label: string }[];
  data: SessionsViewState; open: boolean; onOpenChange: (open: boolean) => void;
  onControl: (id: string, control: SessionControl) => void;
  idleCountdowns?: Readonly<Record<string, IdleSessionCountdown>>;
  operations?: Readonly<Record<string, SessionPreviewOperation>>;
}) {
  const toggleRef = useRef<HTMLButtonElement>(null);
  const consoleRef = useRef<HTMLElement>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [height, setHeight] = useState(DEFAULT_HEIGHT);
  const maxHeight = () => Math.max(MIN_HEIGHT, (consoleRef.current?.parentElement?.clientHeight ?? 800) - 160);
  const [limit, setLimit] = useState(DEFAULT_HEIGHT);
  useLayoutEffect(() => { if (open) setLimit(maxHeight()); }, [open]);
  const resize = (next: number) => setHeight(Math.min(maxHeight(), Math.max(MIN_HEIGHT, next)));
  const drag = (event: PointerEvent<HTMLDivElement>) => {
    const start = { y: event.clientY, height: consoleRef.current?.offsetHeight ?? height };
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    const move = (moved: globalThis.PointerEvent) => resize(start.height + start.y - moved.clientY);
    const end = () => { target.removeEventListener("pointermove", move); target.removeEventListener("pointerup", end); };
    target.addEventListener("pointermove", move); target.addEventListener("pointerup", end);
  };
  const key = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    // The panel may be shorter than the dragged height, so it grows from that height and shrinks from what shows.
    resize(event.key === "ArrowUp" ? height + RESIZE_STEP : Math.min(height, consoleRef.current?.offsetHeight || height) - RESIZE_STEP);
  };
  const actionable = data.state === "ready" && !data.stale;
  const workers = data.state === "ready" ? data.workers : [];
  const onWorkerControl = (id: string, control: SessionControl) => { onControl(id, control); if (control === "remove") toggleRef.current?.focus(); };
  const pendingAdd = operations.add?.state === "pending" && operations.add.request.action === "add" ? operations.add.request : undefined;
  const adding = pendingAdd !== undefined;
  const pendingAddLabel = pendingAdd && (workflows.find(item => item.id === pendingAdd.workflow)?.label ?? pendingAdd.workflow);
  const stripRef = useRef<HTMLDivElement>(null);
  // The Starting card is first, so a strip scrolled away from it comes back.
  useLayoutEffect(() => { if (adding && stripRef.current !== null) stripRef.current.scrollLeft = 0; }, [adding]);
  const announcement = [
    pendingAdd && `Starting ${pendingAdd.count > 1 ? `${String(pendingAdd.count)} workers` : "a worker"} for ${pendingAddLabel ?? ""}.`,
    ...workers.filter(worker => operations[worker.id]?.state === "pending" && operations[worker.id]?.request.action === "remove").map(worker => `Removing ${worker.label}, ${worker.workflow}.`),
  ].filter(Boolean).join(" ");
  if (!open) return <section id={SESSIONS_CONSOLE_ID} aria-label="Session Panel" className="sr-only"><p role="status">{announcement}</p></section>;
  return <section ref={consoleRef} id={SESSIONS_CONSOLE_ID} aria-label="Session Panel" tabIndex={-1} className={"session-console ui-theme-scope font-ui text-ui-primary outline-none"} style={{ maxHeight: height }}>
    <div role="separator" aria-orientation="horizontal" aria-label="Resize Sessions" aria-valuemin={MIN_HEIGHT} aria-valuemax={Math.max(height, limit)} aria-valuenow={height} tabIndex={0} className={cn("session-console-grip", dsFocus)} onPointerDown={drag} onKeyDown={key} />
    <header className="session-console-header">
      <BareButton ref={toggleRef} type="button" aria-expanded={!collapsed} aria-controls={`${SESSIONS_CONSOLE_ID}-body`} className={cn("session-toggle", dsFocus)} onClick={() => setCollapsed(value => !value)}>
        {collapsed ? <ChevronUp aria-hidden /> : <ChevronDown aria-hidden />}<UsersRound aria-hidden /><span className="session-pill-title">Sessions</span><span aria-hidden className="session-divider" /><span className="session-pill-counts"><BarCounts data={data} /></span>
      </BareButton>
      <IconButton variant="ghost" size="sm" label="Close Sessions" title="" onClick={() => { document.querySelector<HTMLElement>(`button[aria-controls="${SESSIONS_CONSOLE_ID}"]`)?.focus(); onOpenChange(false); }} icon={<X aria-hidden className="size-4" />} />
    </header>
    <p role="status" className="sr-only">{announcement}</p>
    {!collapsed && <div id={`${SESSIONS_CONSOLE_ID}-body`} role="region" aria-label="Sessions" className="session-body">
      <div className="session-body-cards">
      {data.state === "ready" ? data.workers.length || pendingAdd ? <div ref={stripRef} data-session-strip role="group" aria-label="Workers" tabIndex={0} className={cn("flex items-stretch gap-3 overflow-x-auto pb-1", dsFocus)}>
        {pendingAdd && <StartingCard workflow={pendingAddLabel ?? pendingAdd.workflow} count={pendingAdd.count} />}
        {workers.map(worker => <WorkerCard key={worker.id} countdown={idleCountdowns[worker.id]} worker={worker} operation={operations[worker.id]} disabled={!actionable} onControl={onWorkerControl} />)}
      </div> : <div className="flex min-h-32 flex-col items-center justify-center gap-2 text-center"><UsersRound aria-hidden className="size-5 text-ui-muted" /><h3 className="m-0 text-heading">No workers yet</h3><p className="m-0 text-body text-ui-secondary">Add workers to start processing runs.</p></div> : data.state === "loading" ? <SessionsSkeleton /> : <div role="alert" className="flex min-h-32 flex-col items-center justify-center gap-2 text-center"><h3 className="m-0 text-heading">Sessions unavailable</h3><p className="m-0 text-body text-ui-secondary">{data.reason}</p></div>}
      </div>
    </div>}
  </section>;
}
