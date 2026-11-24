import { useEffect, useState } from "react";
import { Loader2, Pause, Play, RotateCw, Square, Trash2 } from "lucide-react";
import { Button, Tooltip, TooltipProvider } from "../../ds/ui.js";
import { IconActionButton } from "../shared/actions/icon-action-button.js";
import { cn } from "../../lib/utils.js";
import { systemClock } from "../../../rules/time/clock.js";
import { IDLE_REFRESH_MS, type IdleSessionCountdown } from "./session-idle-model.js";
import { SESSION_STATE_LABELS, sessionStateColor, type SessionControl, type SessionWorker } from "./sessions-view-model.js";
import type { SessionPreviewOperation } from "./session-preview-command-model.js";
import { workerElapsedSeconds } from "./session-panel-model.js";
import { formatDuration } from "../../lib/date-format.js";
import { useServedView } from "../../state/served-clock.js";

type WorkerBrowser = SessionWorker["browsers"][number];
const BROWSER_WORD: Record<WorkerBrowser["state"], string> = { ready: "Ready", active: "In use", starting: "Opening", unopened: "Not opened", closed: "Closed", unavailable: "Unavailable", failed: "Failed", "needs-duo": "Needs Duo", "signed-out": "Signed out" };
const BROWSER_TONE: Record<WorkerBrowser["state"], string> = { ready: "text-ui-secondary", active: "text-ui-info", starting: "text-ui-warning", unopened: "text-ui-muted", closed: "text-ui-muted", unavailable: "text-ui-warning", failed: "text-ui-danger", "needs-duo": "text-ui-warning", "signed-out": "text-ui-warning" };
const MAX_SYSTEMS = 4;

/** Why a settled worker ended, a failed step, or a pending pause or stop: it rides on the status word, since the card has no progress block. */
function cardNote(worker: SessionWorker): string | undefined {
  if (worker.state === "failed" || worker.state === "stopped" || worker.state === "idle" || worker.state === "unavailable") return worker.problem;
  if (worker.timeline?.some(node => node.state === "failed")) return "This step failed.";
  return worker.note;
}

/** A nickname or a served reason stays reachable: the focusable chip carries the full text as its name and shows it in the design-system tooltip. */
function BrowserRow({ browser }: { browser: WorkerBrowser }) {
  const detail = [browser.name, browser.reason].filter(Boolean).join(" · ");
  const row = <>
    <span className="flex min-w-0 items-center gap-1"><span className="break-words">{browser.label}</span></span>
    <span className={cn("shrink-0", BROWSER_TONE[browser.state])}>{BROWSER_WORD[browser.state]}</span>
  </>;
  const name = [browser.name ?? browser.label, BROWSER_WORD[browser.state], browser.reason].filter(Boolean).join(". ");
  return <li className="flex min-h-8 min-w-0 items-center rounded-md bg-[var(--ds-worker-chip-bg)] text-caption">{detail === ""
    ? <div className="flex min-w-0 flex-1 items-center justify-between gap-2 px-2 py-1">{row}</div>
    : <Tooltip content={detail}><div tabIndex={0} role="group" aria-label={name} className="flex min-w-0 flex-1 items-center justify-between gap-2 rounded-md px-2 py-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ui-info">{row}</div></Tooltip>}</li>;
}

/** Browser sessions are always the chip grid, two per row; a workflow past four systems gets a wider card and three per row. */
function Browsers({ worker, wide }: { worker: SessionWorker; wide: boolean }) {
  if (worker.browsers.length === 0) return <p className="m-0 min-h-[4.5rem] flex-1 py-3 text-caption text-ui-muted">{worker.browsersNote ?? "No browser sessions open"}</p>;
  return <TooltipProvider delayDuration={200}><ul aria-label={`${worker.label} systems`} className={cn("m-0 grid min-h-[4.5rem] flex-1 list-none content-start gap-1.5 py-3 pl-0", wide ? "grid-cols-3" : "grid-cols-2")}>{worker.browsers.map(browser => <BrowserRow key={browser.id} browser={browser} />)}</ul></TooltipProvider>;
}

export function IdleWorkerRow({ worker, countdown, operation, disabled = false, onControl }: { worker: SessionWorker; countdown?: IdleSessionCountdown; operation?: SessionPreviewOperation; disabled?: boolean; onControl: (id: string, control: SessionControl) => void }) {
  const locked = disabled || operation?.state === "pending";
  const removing = operation?.state === "pending" && operation.request.action === "remove";
  return <li aria-label={`${worker.label} · ${worker.workflow}`} className="list-none rounded-md bg-[var(--ds-worker-card-bg)] px-3">
    <div className="flex min-h-8 items-center justify-between gap-3">
      <span className="min-w-0 truncate text-control" title={worker.workflow}>{worker.workflow}</span>
      <span className="flex shrink-0 items-center gap-2"><span className={cn("inline-flex items-center gap-1.5 text-caption", sessionStateColor(worker.state))}>{removing ? <Loader2 aria-hidden className="size-3 animate-spin motion-reduce:animate-none" /> : countdown ? <IdleRefreshRing countdown={countdown} /> : null}{removing ? "Removing" : SESSION_STATE_LABELS[worker.state]}</span>
        <IconActionButton tone="muted" label="Remove worker" disabled={locked} icon={<Trash2 aria-hidden className="size-3.5" />} onClick={() => onControl(worker.id, "remove")} /></span>
    </div>
    {!removing && <WorkerOperationNote operation={operation} />}
  </li>;
}

/** The elapsed time ticks here, so the card around it does not re-render every second. */
function WorkerElapsed({ worker }: { worker: SessionWorker }) {
  const card = worker.authority;
  const elapsed = useServedView("", now => card === undefined || card.state === "idle" || now === "" ? worker.elapsed : formatDuration(workerElapsedSeconds(card, now)));
  return <span className="flex h-7 items-center text-caption tabular-nums text-ui-muted">{elapsed ?? (worker.state === "idle" ? "Available" : worker.state === "unavailable" ? "" : "Not measured")}</span>;
}

export function WorkerCard({ worker, countdown, operation, disabled = false, onControl }: { worker: SessionWorker; countdown?: IdleSessionCountdown; operation?: SessionPreviewOperation; disabled?: boolean; onControl: (id: string, control: SessionControl) => void }) {
  const locked = disabled || operation?.state === "pending";
  const settled = worker.state === "failed" || worker.state === "stopped";
  const note = cardNote(worker);
  const wide = worker.browsers.length > MAX_SYSTEMS;
  const icon = (label: string, control: SessionControl, Glyph: typeof Pause) => <IconActionButton tone="muted" label={label} disabled={locked} icon={<Glyph aria-hidden className="size-3.5" />} onClick={() => onControl(worker.id, control)} />;
  return <article aria-label={`${worker.label} · ${worker.workflow}`} className={cn("flex max-w-full shrink-0 flex-col rounded-lg bg-[var(--ds-worker-card-bg)] px-4 py-3", wide ? "w-[32rem]" : "w-[22rem]")}>
    <header className="flex items-start justify-between gap-3"><h3 className="m-0 min-w-0 truncate text-control font-medium" title={worker.workflow}>{worker.workflow}</h3><span title={note} className={cn("inline-flex shrink-0 items-center gap-1.5 pt-0.5 text-caption", sessionStateColor(worker.state))}>{worker.state === "idle" && countdown ? <IdleRefreshRing countdown={countdown} /> : <span aria-hidden className="size-1.5 rounded-full bg-current" />}{SESSION_STATE_LABELS[worker.state]}{note !== undefined && <span className="sr-only">. {note}</span>}</span></header>
    <p className="mb-0 mt-1 truncate text-caption text-ui-secondary" title={worker.subject}>{worker.subject ?? "No run assigned"}</p>
    <Browsers worker={worker} wide={wide} />
    <WorkerOperationNote operation={operation} />
    <footer className="flex items-center justify-between gap-2 border-t border-ui-stroke pt-2"><WorkerElapsed worker={worker} /><span className="flex h-7 items-center gap-1">
      {settled ? <Button size="sm" variant="secondary" className="h-6 gap-1 px-2" disabled={locked} aria-label="Retry" title="Retry" icon={<RotateCw aria-hidden className="size-3.5" />} onClick={() => onControl(worker.id, "retry")}>Retry</Button>
        : <>{worker.state === "running" && icon("Pause", "pause", Pause)}{worker.state === "paused" && icon("Resume", "resume", Play)}
          {worker.state === "unavailable" ? null : worker.state !== "idle" ? icon("Stop", "stop", Square) : icon("Remove worker", "remove", Trash2)}</>}
    </span></footer>
  </article>;
}

/** The idle session's countdown to the next page refresh: a ring that drains with the remaining time (never spins), with the time in its Tooltip. */
export function IdleRefreshRing({ countdown }: { countdown: IdleSessionCountdown }) {
  const [now, setNow] = useState(() => systemClock.nowMs());
  useEffect(() => { setNow(systemClock.nowMs()); const timer = setInterval(() => setNow(systemClock.nowMs()), 1000); return () => clearInterval(timer); }, [countdown.dueAt]);
  const remainingMs = Math.max(0, countdown.dueAt - now);
  const seconds = Math.ceil(remainingMs / 1000);
  const label = countdown.waiting ? 'Checking the session' : `Refreshes in ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')} to stay signed in`;
  return <Tooltip side="top" content={label}><span role="img" aria-label={label} className="inline-flex size-4 shrink-0 text-ui-secondary"><svg aria-hidden viewBox="0 0 20 20" className="size-4 -rotate-90"><circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" opacity=".25" strokeWidth="2" /><circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" pathLength="1" strokeDasharray="1" strokeDashoffset={1 - remainingMs / IDLE_REFRESH_MS} /></svg></span></Tooltip>;
}

function WorkerOperationNote({ operation }: { operation?: SessionPreviewOperation }) {
  return <>{operation && (operation.request.action !== 'refresh' || operation.state === 'refused') && <div role={operation.state === 'refused' ? 'alert' : 'status'} className={cn('mt-2 text-caption', operation.state === 'refused' ? 'text-ui-danger' : 'text-ui-secondary')}>{operation.message}</div>}</>;
}
