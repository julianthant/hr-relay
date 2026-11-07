import { Monitor, Pause, Play, RotateCw, Square, Trash2 } from "lucide-react";
import { Button } from "../../ds/ui.js";
import { cn } from "../../lib/utils.js";
import { IDLE_REFRESH_MS, type IdleSessionCountdown } from "./session-idle-model.js";
import { SESSION_STATE_LABELS, sessionStateColor, type SessionControl, type SessionWorker } from "./sessions-view-model.js";
import type { SessionPreviewOperation } from "./session-preview-command-model.js";
import { SessionTimeline } from "./session-timeline.js";

type Browser = SessionWorker["browsers"][number];
const BROWSER_WORD: Record<Browser["state"], string> = { ready: "Ready", active: "In use", starting: "Opening", unopened: "Not opened", closed: "Closed", unavailable: "Unavailable", failed: "Failed" };
const BROWSER_TONE: Record<Browser["state"], string> = { ready: "text-ui-secondary", active: "text-ui-info", starting: "text-ui-warning", unopened: "text-ui-muted", closed: "text-ui-muted", unavailable: "text-ui-warning", failed: "text-ui-danger" };
const MAX_ROWS = 4;

/** What the bottom line says: why a settled worker ended, the step that failed, or the current step. Only real failures are red. */
function cardLine(worker: SessionWorker): { text: string; danger: boolean } {
  if (worker.state === "failed") return { text: worker.problem ?? "Worker stopped unexpectedly.", danger: true };
  if (worker.state === "stopped") return { text: worker.problem ?? "Stopped.", danger: false };
  const failed = worker.timeline?.find(node => node.state === "failed");
  return failed ? { text: `${failed.label} failed`, danger: true } : { text: worker.action, danger: false };
}

function BrowserRow({ browser }: { browser: Browser }) {
  return <li className="flex min-h-8 min-w-0 items-center justify-between gap-2 rounded-md bg-ui-table px-1 py-1 text-caption last:odd:col-span-2"><span className="flex min-w-0 items-center gap-1"><Monitor aria-hidden className="size-3 shrink-0 text-ui-muted" /><span className="break-words">{browser.label}</span></span><span className={cn("shrink-0", BROWSER_TONE[browser.state])}>{BROWSER_WORD[browser.state]}</span></li>;
}

/** Up to four sessions are rows; more are compact chips, so every name reads in full. */
function Browsers({ worker }: { worker: SessionWorker }) {
  const label = `${worker.label} systems`;
  if (worker.state === "failed" || worker.state === "stopped" || worker.browsers.length === 0) return null;
  if (worker.browsers.length <= MAX_ROWS) return <ul aria-label={label} className="mb-3 mt-3 grid list-none grid-cols-2 gap-1.5 pl-0">{worker.browsers.map(browser => <BrowserRow key={browser.id} browser={browser} />)}</ul>;
  return <ul aria-label={label} className="mb-3 mt-3 flex list-none flex-wrap gap-x-3 gap-y-1.5 pl-0 text-caption">{worker.browsers.map(browser => <li key={browser.id} className="flex items-center gap-1.5"><span aria-hidden className={cn("size-1.5 shrink-0 rounded-full bg-current", BROWSER_TONE[browser.state])} /><span>{browser.label}</span>{browser.state !== "ready" && <span className={BROWSER_TONE[browser.state]}>{BROWSER_WORD[browser.state]}</span>}</li>)}</ul>;
}

export function WorkerCard({ worker, countdown, operation, onControl, onCheck }: { worker: SessionWorker; countdown?: IdleSessionCountdown; operation?: SessionPreviewOperation; onControl: (id: string, control: SessionControl) => void; onCheck?: (id: string) => void }) {
  const locked = operation !== undefined && ["pending", "checking", "uncertain"].includes(operation.state);
  const settled = worker.state === "failed" || worker.state === "stopped";
  const line = cardLine(worker);
  const retry = <Button size="sm" variant="ghost" className="h-8 shrink-0 gap-1 px-2 text-caption text-ui-secondary" disabled={locked} aria-label="Retry" title="Retry" icon={<RotateCw aria-hidden className="size-3.5" />} onClick={() => onControl(worker.id, "retry")}>Retry</Button>;
  const icon = (label: string, control: SessionControl, Glyph: typeof Pause) => <Button size="sm" variant="ghost" className="size-6 p-0" disabled={locked} aria-label={label} title={label} icon={<Glyph aria-hidden className="size-3.5" />} onClick={() => onControl(worker.id, control)} />;
  const text = <p className={cn("m-0 min-w-0 break-words text-body", line.danger && "text-ui-danger")}>{line.text}</p>;
  return <article aria-label={`${worker.label} · ${worker.workflow}`} className="flex w-80 shrink-0 flex-col rounded-lg border border-ui-stroke bg-ui-panel p-3">
    <header className="flex items-start justify-between gap-3"><h3 className="m-0 min-w-0 break-words text-control font-semibold">{worker.workflow}</h3><span className={cn("inline-flex shrink-0 items-center gap-1.5 pt-0.5 text-caption", sessionStateColor(worker.state))}>{worker.state === "idle" && countdown ? <IdleRefreshRing countdown={countdown} /> : <span aria-hidden className="size-1.5 rounded-full bg-current" />}{SESSION_STATE_LABELS[worker.state]}</span></header>
    <p className="mb-0 mt-1 break-words text-caption text-ui-secondary">{worker.subject ?? "No run assigned"}</p>
    <Browsers worker={worker} />
    {(worker.timeline && !settled || line.text || worker.note) && <div className={cn("border-t border-ui-stroke pt-2", settled || worker.browsers.length === 0 ? "mt-3" : "")}>
      {worker.timeline && !settled ? <SessionTimeline nodes={worker.timeline} label={`${worker.label} node timeline`} action={line.text} tone={line.danger ? "danger" : undefined} />
        : worker.state === "idle" ? <div><p className="mb-2 mt-0 text-body">Ready for the next run</p><div role="img" aria-label="No run in progress" className="h-1.5 w-full rounded-sm bg-ui-stroke-control" /></div>
        : settled ? <div className="flex items-center justify-between gap-2">{text}{retry}</div> : line.text ? text : null}
      {worker.note && <p className="mb-0 mt-1.5 text-caption text-ui-warning">{worker.note}</p>}
    </div>}
    <WorkerOperationNote operation={operation} worker={worker} onCheck={onCheck} />
    <footer className="mt-2 flex min-h-8 items-center justify-between gap-2 border-t border-ui-stroke pt-2"><span className="text-caption tabular-nums text-ui-muted">{worker.elapsed ?? (worker.state === "idle" ? "Available" : "Not measured")}</span><span className="flex items-center gap-1">
      {!settled && <>{worker.state === "running" && icon("Pause", "pause", Pause)}{worker.state === "paused" && icon("Resume", "resume", Play)}
        {worker.state !== "idle" ? icon("Stop", "stop", Square) : icon("Remove worker", "remove", Trash2)}</>}
    </span></footer>
  </article>;
}

function IdleRefreshRing({ countdown }: { countdown: IdleSessionCountdown }) {
  const seconds = Math.ceil(countdown.remainingMs / 1000);
  const label = countdown.waiting ? 'Checking idle session refresh' : `Session refresh in ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  return <span role="img" aria-label={label} title={label} className="inline-flex size-4 shrink-0 rounded-full bg-black/30"><svg aria-hidden viewBox="0 0 20 20" className="size-4 -rotate-90"><circle cx="10" cy="10" r="8" fill="none" stroke="white" opacity=".25" strokeWidth="2" /><circle cx="10" cy="10" r="8" fill="none" stroke="white" strokeWidth="2" pathLength="1" strokeDasharray="1" strokeDashoffset={1 - countdown.remainingMs / IDLE_REFRESH_MS} /></svg></span>;
}

function WorkerOperationNote({ operation, worker, onCheck }: { operation?: SessionPreviewOperation; worker: SessionWorker; onCheck?: (id: string) => void }) {
  return <>{operation && (operation.request.action !== 'refresh' || ['refused', 'uncertain'].includes(operation.state)) && <div role={operation.state === 'refused' || operation.state === 'uncertain' ? 'alert' : 'status'} className={cn('mt-2 flex items-center justify-between gap-2 text-caption', operation.state === 'refused' ? 'text-ui-danger' : operation.state === 'uncertain' ? 'text-ui-warning' : 'text-ui-secondary')}><span>{operation.message}</span>{operation.state === 'uncertain' && <Button size="sm" variant="secondary" onClick={() => onCheck?.(worker.id)}>Check outcome</Button>}</div>}</>;
}

