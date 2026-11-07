import { Monitor, Pause, Play, RotateCw, Square, Trash2 } from "lucide-react";
import { Button } from "../../ds/ui.js";
import { cn } from "../../lib/utils.js";
import { SESSION_STATE_LABELS, sessionStateColor, type SessionControl, type SessionWorker } from "./sessions-view-model.js";
import type { SessionPreviewOperation } from "./session-preview-command-model.js";
import type { IdleSessionCountdown } from "./session-idle-model.js";
import { SessionTimeline } from "./session-timeline.js";
import { IdleRefreshRing, WorkerOperationNote } from "./sessions-view.js";

type Browser = SessionWorker["browsers"][number];
const BROWSER_WORD: Record<Browser["state"], string> = { ready: "Ready", active: "In use", starting: "Opening", unopened: "Not opened", closed: "Closed", unavailable: "Unavailable", failed: "Failed" };
const BROWSER_TONE: Record<Browser["state"], string> = { ready: "text-ui-secondary", active: "text-ui-info", starting: "text-ui-warning", unopened: "text-ui-muted", closed: "text-ui-muted", unavailable: "text-ui-warning", failed: "text-ui-danger" };
const MAX_ROWS = 4;
const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** What the bottom line says: the reason a settled worker ended, the step that failed, or the current step. */
function cardLine(worker: SessionWorker): { text: string; danger: boolean } {
  if (worker.state === "failed") return { text: worker.problem ?? "Worker stopped unexpectedly.", danger: true };
  if (worker.state === "stopped") return { text: capital(worker.problem ?? "Stopped"), danger: false };
  const failed = worker.timeline?.find(node => node.state === "failed");
  return failed ? { text: `${failed.label} failed`, danger: true } : { text: worker.action, danger: false };
}

function BrowserRow({ browser }: { browser: Browser }) {
  return <li className="flex min-h-8 min-w-0 items-center justify-between gap-1 rounded-md bg-ui-table px-1 py-1 text-caption last:odd:col-span-2"><span className="flex min-w-0 items-center gap-1"><Monitor aria-hidden className="size-3 shrink-0 text-ui-muted" /><span className="truncate" title={browser.label}>{browser.label}</span></span><span className={cn("shrink-0", BROWSER_TONE[browser.state])}>{BROWSER_WORD[browser.state]}</span></li>;
}

/** Option A shows the first sessions and one summary row; option B lists every session as a chip. */
function Browsers({ worker, variant }: { worker: SessionWorker; variant: "a" | "b" }) {
  const settled = worker.state === "failed" || worker.state === "stopped";
  const label = `${worker.label} systems`;
  if (settled) return variant === "a" ? <p className="mb-3 mt-3 flex min-h-8 items-center rounded-md bg-ui-table px-2 text-caption text-ui-muted">No browser sessions open</p> : null;
  if (worker.browsers.length <= MAX_ROWS) return <ul aria-label={label} className="mb-3 mt-3 grid list-none grid-cols-2 gap-1.5 pl-0">{worker.browsers.map(browser => <BrowserRow key={browser.id} browser={browser} />)}</ul>;
  if (variant === "b") return <ul aria-label={label} className="mb-3 mt-3 flex list-none flex-wrap gap-x-3 gap-y-1.5 pl-0 text-caption">{worker.browsers.map(browser => <li key={browser.id} className="flex min-w-0 items-center gap-1.5"><span aria-hidden className={cn("size-1.5 shrink-0 rounded-full bg-current", BROWSER_TONE[browser.state])} /><span className="truncate" title={browser.label}>{browser.label}</span>{browser.state !== "ready" && <span className={BROWSER_TONE[browser.state]}>{BROWSER_WORD[browser.state]}</span>}</li>)}</ul>;
  const shown = worker.browsers.slice(0, MAX_ROWS - 1);
  const rest = worker.browsers.slice(MAX_ROWS - 1);
  const attention = rest.filter(browser => !["ready", "active"].includes(browser.state));
  return <ul aria-label={label} className="mb-3 mt-3 grid list-none grid-cols-2 gap-1.5 pl-0">{shown.map(browser => <BrowserRow key={browser.id} browser={browser} />)}
    <li className="flex min-h-8 min-w-0 items-center justify-between gap-1 rounded-md bg-ui-table px-2 py-1 text-caption"><span className="whitespace-nowrap text-ui-secondary">+{rest.length} more</span>{attention.length > 0 && <span className={cn("whitespace-nowrap", BROWSER_TONE[attention.some(browser => browser.state === "failed") ? "failed" : "unavailable"])}>{attention.length} {attention.length === 1 ? "needs" : "need"} attention</span>}</li></ul>;
}

export function WorkerCardOption({ variant, worker, countdown, operation, onControl, onCheck }: { variant: "a" | "b"; worker: SessionWorker; countdown?: IdleSessionCountdown; operation?: SessionPreviewOperation; onControl: (id: string, control: SessionControl) => void; onCheck?: (id: string) => void }) {
  const locked = operation !== undefined && ["pending", "checking", "uncertain"].includes(operation.state);
  const settled = worker.state === "failed" || worker.state === "stopped";
  const line = cardLine(worker);
  const retry = <Button size="sm" variant="ghost" className="h-8 shrink-0 gap-1 px-2 text-caption text-ui-secondary" disabled={locked} aria-label="Retry" title="Retry" icon={<RotateCw aria-hidden className="size-3.5" />} onClick={() => onControl(worker.id, "retry")}>Retry</Button>;
  const icon = (label: string, control: SessionControl, glyph: typeof Pause) => { const Glyph = glyph; return <Button size="sm" variant="ghost" className="size-6 p-0" disabled={locked} aria-label={label} title={label} icon={<Glyph aria-hidden className="size-3.5" />} onClick={() => onControl(worker.id, control)} />; };
  const text = <p className={cn("m-0 line-clamp-2 min-w-0 text-body", line.danger && "text-ui-danger")} title={line.text}>{line.text}</p>;
  return <article aria-label={`${worker.label} · ${worker.workflow}`} className="flex w-80 shrink-0 flex-col rounded-lg border border-ui-stroke bg-ui-panel p-3">
    <header className="flex items-center justify-between gap-3"><h3 className="m-0 min-w-0 truncate text-control font-semibold" title={worker.workflow}>{worker.workflow}</h3><span className={cn("inline-flex shrink-0 items-center gap-1.5 text-caption", sessionStateColor(worker.state))}>{worker.state === "idle" && countdown ? <IdleRefreshRing countdown={countdown} /> : <span aria-hidden className="size-1.5 rounded-full bg-current" />}{SESSION_STATE_LABELS[worker.state]}</span></header>
    <p className="mb-0 mt-1 truncate text-caption text-ui-secondary" title={worker.subject}>{worker.subject ?? "No run assigned"}</p>
    <Browsers worker={worker} variant={variant} />
    <div className={cn("border-t border-ui-stroke pt-2", variant === "a" || !settled ? "mt-auto min-h-10" : "mt-3")}>
      {worker.timeline && !settled ? <SessionTimeline nodes={worker.timeline} label={`${worker.label} node timeline`} action={line.text} tone={line.danger ? "danger" : undefined} />
        : worker.state === "idle" && !worker.problem ? <div><p className="mb-2 mt-0 text-body">Ready for the next run</p><div role="img" aria-label="No run in progress" className="h-1.5 w-full rounded-sm bg-ui-stroke-control" /></div>
        : variant === "b" && settled ? <div className="flex items-start justify-between gap-2">{text}{retry}</div> : text}
      {worker.problem && !settled && <p className="mb-0 mt-2 text-caption text-ui-danger">{worker.problem}</p>}
      {worker.note && <p className="mb-0 mt-1.5 text-caption text-ui-warning">{worker.note}</p>}
    </div>
    <WorkerOperationNote operation={operation} worker={worker} onCheck={onCheck} />
    <footer className="mt-2 flex min-h-8 items-center justify-between gap-2 border-t border-ui-stroke pt-2"><span className="text-caption tabular-nums text-ui-muted">{worker.elapsed ?? (worker.state === "idle" ? "Available" : "Not measured")}</span><span className="flex items-center gap-1">
      {settled ? variant === "a" && retry : <>
        {worker.state === "running" && icon("Pause", "pause", Pause)}{worker.state === "paused" && icon("Resume", "resume", Play)}
        {worker.state !== "idle" ? icon("Stop", "stop", Square) : icon("Remove", "remove", Trash2)}</>}
    </span></footer>
  </article>;
}
