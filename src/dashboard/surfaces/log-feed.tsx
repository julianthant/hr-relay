import { useId, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowDownToLine, Check, Copy, Cpu, Eye, GitBranch, Info, Monitor, MousePointer2, PanelsTopLeft, PencilLine, ScanSearch } from "lucide-react";
import { Button, Dialog, DialogBody, DialogContent, DialogTrigger, IconButton, SearchInput } from "../ds/ui.js";
import { cn } from "../lib/utils.js";
import { filterLogSteps, logPlainText, logRowCount, visualLogSteps, type LogEntry, type LogScreenshot, type LogStep } from "./log-feed-model.js";

function Screenshot({ screenshot }: { screenshot: LogScreenshot }) {
  const [failed, setFailed] = useState(false);
  return <figure className="m-0 mt-3 max-w-log-capture">
    {failed ? <p role="alert" className="rounded-md border border-ui-stroke p-3 text-body text-ui-danger">Screenshot could not be displayed.</p> : <Dialog>
      <DialogTrigger asChild>
        <button type="button" className="block w-full cursor-zoom-in overflow-hidden rounded-md border border-ui-stroke focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ui-info" aria-label={`Enlarge screenshot captured at ${screenshot.time}`}>
          <img className="block h-auto w-full" src={screenshot.src} alt={screenshot.alt} width={screenshot.width} height={screenshot.height} loading="lazy" onError={() => setFailed(true)} onLoad={event => {
            if (event.currentTarget.naturalWidth !== screenshot.width || event.currentTarget.naturalHeight !== screenshot.height) setFailed(true);
          }} />
        </button>
      </DialogTrigger>
      <DialogContent className="ui-theme-scope bg-ui-panel font-ui text-ui-primary" title="Screenshot" description={`Captured ${screenshot.time}`} size="xl">
        <DialogBody><img className="block h-auto w-full" src={screenshot.src} alt={screenshot.alt} width={screenshot.width} height={screenshot.height} /></DialogBody>
      </DialogContent>
    </Dialog>}
    <figcaption className="mt-2 text-caption text-ui-muted">Captured <time className="tabular-nums">{screenshot.time}</time></figcaption>
  </figure>;
}

function Entry({ entry }: { entry: LogEntry }) {
  if (entry.kind === "fields") return <div className={cn("overflow-hidden rounded-lg border border-ui-stroke bg-ui-table", entry.title === undefined && entry.result === undefined && "px-3")}>
    {entry.title && <div className="flex items-center gap-2.5 border-b border-ui-stroke px-3 py-3"><PanelsTopLeft aria-hidden className="size-4 shrink-0 text-ui-muted" /><h4 className="m-0 text-control font-semibold">{entry.title}</h4></div>}
    <dl className={cn("m-0", (entry.title !== undefined || entry.result !== undefined) && "px-3")}>
      {entry.fields.map(field => {
        const Icon = field.kind === "fill" ? PencilLine : field.kind === "compute" ? Cpu : Eye;
        return <div key={field.id} data-log-field={field.kind} className="grid min-w-0 grid-cols-[var(--spacing-log-time)_1rem_minmax(var(--spacing-log-label),.85fr)_minmax(0,1.15fr)] items-baseline gap-x-3 border-b border-ui-stroke py-2.5 last:border-b-0">
          <time className="self-start pt-0.5 font-data text-caption tabular-nums text-ui-muted">{field.time}</time>
          <Icon aria-hidden className={cn("size-3.5 self-start translate-y-0.5", field.kind === "fill" ? "text-ui-info" : "text-ui-muted")} />
          <dt className="min-w-0 text-body font-medium">{field.label}</dt>
          <dd className={cn("m-0 min-w-0 text-right text-body text-balance [overflow-wrap:break-word]", field.kind === "fill" ? "text-ui-info font-medium" : "text-ui-secondary")}><FieldValue value={field.value} /></dd>
        </div>;
      })}
    </dl>
    {entry.result && <div className="flex items-baseline justify-between gap-4 border-t border-ui-stroke px-3 py-3 text-body"><span className="inline-flex shrink-0 items-center gap-2.5 font-medium"><GitBranch aria-hidden className="size-3.5 text-ui-info" />Read result</span><strong className="min-w-0 text-right font-semibold text-ui-positive text-balance">{entry.result}</strong></div>}
  </div>;
  if (entry.kind === "click") return <div>
    <div className="flex items-center gap-3">
      <time className="w-log-time shrink-0 font-data text-caption tabular-nums text-ui-muted">{entry.time}</time>
      <span className="inline-flex min-w-0 items-center gap-2 rounded-md border border-ui-stroke bg-ui-table px-2.5 py-1.5 text-body font-medium"><MousePointer2 aria-hidden className="size-3.5 shrink-0 text-ui-muted" />{entry.label}</span>
    </div>
  </div>;
  return <div className="grid grid-cols-[var(--spacing-log-time)_1rem_minmax(0,1fr)] items-baseline gap-3 py-1 text-body text-ui-secondary"><time className="font-data text-caption tabular-nums text-ui-muted">{entry.time}</time><Info aria-hidden className="size-3.5 self-start translate-y-0.5 text-ui-muted" /><p className="m-0 min-w-0 text-balance [overflow-wrap:break-word]">{entry.message}</p></div>;
}

function FieldValue({ value }: { value: string }) {
  return <>{value.split(/(\b[A-Z]{2,}[A-Za-z\d]*-[A-Za-z\d-]+\b)/gu).map((part, index) => /^[A-Z]{2,}[A-Za-z\d]*-[A-Za-z\d-]+$/u.test(part) && part.length < 80 ? <span key={index} className="whitespace-nowrap">{part}</span> : part)}</>;
}

/** Shared presentation for the operator stream and the isolated design preview. */
export function LogFeed({ steps, label = "Run logs", embedded = false, beforeContent, afterStep, trailingContent, footerContent, loading = false }: {
  steps: readonly LogStep[];
  label?: string;
  embedded?: boolean;
  loading?: boolean;
  beforeContent?: ReactNode;
  afterStep?: (id: string) => ReactNode;
  trailingContent?: ReactNode;
  footerContent?: ReactNode;
}) {
  const [query, setQuery] = useState("");
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const id = useId();
  const scroller = useRef<HTMLDivElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const visible = useMemo(() => filterLogSteps(visualLogSteps(steps), query), [steps, query]);
  const count = logRowCount(visible);
  const copy = async () => {
    try { await navigator.clipboard.writeText(logPlainText(visible)); setCopyState("copied"); }
    catch { setCopyState("failed"); }
  };
  return <div className={cn("ui-theme-scope flex min-h-0 min-w-0 flex-1 flex-col bg-ui-panel font-ui text-body text-ui-primary", embedded && "relative flex-none")}>
    <div className={cn("min-w-0 flex-1 px-4 pb-6 pt-5", !embedded && "overflow-y-auto focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ui-info")} ref={scroller} role={embedded ? undefined : "region"} aria-label={embedded ? undefined : label} tabIndex={embedded ? undefined : 0} aria-busy={loading || undefined}>
      {beforeContent}
      {steps.filter(step => !visible.some(item => item.id === step.id)).map(step => {
        const content = afterStep?.(step.id);
        return content == null ? null : <div key={step.id}>{content}</div>;
      })}
      {visible.map(step => <section key={step.id} aria-labelledby={`${id}-${step.id}`} className="grid min-w-0 grid-cols-[var(--spacing-log-time)_minmax(0,1fr)] gap-x-4 border-b border-ui-stroke py-5 first:pt-0 last:border-b-0">
        <time className="pt-0.5 font-data text-caption tabular-nums text-ui-muted">{step.time}</time>
        <div className="min-w-0">
          <header className="mb-4 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1"><h3 id={`${id}-${step.id}`} className="m-0 text-heading">{step.title}</h3>{step.system && <span className="inline-flex items-center gap-1.5 border-l border-ui-stroke pl-3 text-body text-ui-muted"><Monitor aria-hidden className="size-3.5" />{step.system}</span>}</header>
          <div className="flex min-w-0 flex-col gap-3">{step.entries.map(entry => <Entry key={entry.id} entry={entry} />)}</div>
          {[...new Map(step.entries.flatMap(entry => entry.kind === "note" ? [] : entry.screenshots ?? []).map(screenshot => [screenshot.src, screenshot])).values()].map(screenshot => <Screenshot key={screenshot.src} screenshot={screenshot} />)}
        </div>
        {afterStep?.(step.id)}
      </section>)}
      {!visible.length && <div className="flex min-h-64 flex-col items-center justify-center gap-2 text-center"><ScanSearch aria-hidden className="mb-1 size-6 text-ui-muted" /><h3 className="m-0 text-heading">{loading ? "Loading logs…" : query.trim() ? "No matching actions" : "No actions yet"}</h3><p className="m-0 text-body text-ui-secondary">{loading ? "Reading the recorded actions." : query.trim() ? "Try a field, value, or action name." : "Confirmed actions will appear here."}</p>{query.trim() && <Button variant="ghost" onClick={() => setQuery("")}>Clear search</Button>}</div>}
      {trailingContent}
      <div ref={end} />
    </div>
    <footer className={cn("flex shrink-0 flex-wrap items-center gap-3 border-t border-ui-stroke bg-ui-panel px-3 py-2", embedded && "sticky bottom-0 mt-auto")}>
      <SearchInput className="w-44" aria-label="Search logs" placeholder="Search logs…" value={query} onChange={event => { setQuery(event.target.value); setCopyState("idle"); }} onClear={() => setQuery("")} />
      <span className="text-caption tabular-nums text-ui-muted" role="status">{count} {query.trim() ? "matching " : ""}{count === 1 ? "action" : "actions"}</span>
      {footerContent}
      <span className="ml-auto inline-flex items-center gap-1">
        <span className="mr-2 text-caption text-ui-muted" role="status">{copyState === "copied" ? "Copied" : copyState === "failed" ? "Copy unavailable" : ""}</span>
        <IconButton label="Copy logs" icon={copyState === "copied" ? <Check aria-hidden className="size-3.5" /> : <Copy aria-hidden className="size-3.5" />} onClick={() => void copy()} disabled={!count} />
        <IconButton label="Go to latest action" icon={<ArrowDownToLine aria-hidden className="size-3.5" />} onClick={() => embedded ? end.current?.scrollIntoView({ block: "end", behavior: "instant" }) : scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "instant" })} disabled={!count} />
      </span>
    </footer>
  </div>;
}
