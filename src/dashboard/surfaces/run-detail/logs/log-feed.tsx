import { displayExtractedDate } from "../../../lib/date-format.js";
import { LogSkeleton } from "../../shared/loading/loading.js";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowDownToLine, Check, Copy, Cpu, Eye, GitBranch, Info, Monitor, MousePointer2, PanelsTopLeft, PencilLine, ScanSearch } from "lucide-react";
import { Button, IconButton, SearchInput } from "../../../ds/ui.js";
import { cn } from "../../../lib/utils.js";
import { filterLogSteps, logPlainText, logRowCount, visualLogSteps, type LogEntry, type LogStep } from "./log-feed-model.js";
import { LogDecisionBlock } from "./log-decision.js";
import type { LogDecisionAction, LogDecisionAnswer } from "./log-decision-model.js";
import { LogScreenshots } from "./log-screenshots.js";

function Entry({ entry, onDecision, timeInStep = false }: { entry: LogEntry; timeInStep?: boolean; onDecision?: (id: string, action: LogDecisionAction, answer: LogDecisionAnswer) => void }) {
  if (entry.kind === "decision" && timeInStep) return <LogDecisionBlock decision={entry.decision} onAction={onDecision ? (action, answer) => onDecision(entry.id, action, answer) : undefined} />;
  if (entry.kind === "decision") return <div className="grid min-w-0 grid-cols-[var(--spacing-log-time)_minmax(0,1fr)] gap-3"><time className="pt-4 font-data text-caption tabular-nums text-ui-muted">{entry.time}</time><LogDecisionBlock decision={entry.decision} onAction={onDecision ? (action, answer) => onDecision(entry.id, action, answer) : undefined} /></div>;
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
  return <LogNote entry={entry} timeInStep={timeInStep} />;
}
function LogNote({ entry, timeInStep }: { entry: Extract<LogEntry, { kind: "note" }>; timeInStep: boolean }) {
  const target = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (entry.announce) target.current?.focus(); }, [entry.id, entry.announce]);
  return <div className={cn("grid items-baseline gap-3 py-1 text-body", timeInStep ? "grid-cols-[1rem_minmax(0,1fr)]" : "grid-cols-[var(--spacing-log-time)_1rem_minmax(0,1fr)]", entry.tone === "positive" ? "text-ui-positive" : entry.tone === "danger" ? "text-ui-danger" : entry.tone === "info" ? "text-ui-info" : "text-ui-secondary")}>{!timeInStep && <time className="font-data text-caption tabular-nums text-ui-muted">{entry.time}</time>}<Info aria-hidden className="size-3.5 self-start translate-y-0.5 text-ui-muted" /><p ref={target} tabIndex={entry.announce ? -1 : undefined} className="m-0 min-w-0 rounded-sm text-balance [overflow-wrap:break-word] focus-visible:outline-2 focus-visible:outline-ui-info">{entry.message}</p></div>;
}

function FieldValue({ value }: { value: string }) {
  return <>{displayExtractedDate(value).split(/(\b[A-Z]{2,}[A-Za-z\d]*-[A-Za-z\d-]+\b)/gu).map((part, index) => /^[A-Z]{2,}[A-Za-z\d]*-[A-Za-z\d-]+$/u.test(part) && part.length < 80 ? <span key={index} className="whitespace-nowrap">{part}</span> : part)}</>;
}

/** Shared presentation for the operator stream and the isolated design preview. */
export function LogFeed({ steps, label = "Run logs", embedded = false, beforeContent, afterStep, trailingContent, footerContent, navigation, onDecision, initialStepId, loading = false }: {
  steps: readonly LogStep[];
  onDecision?: (id: string, action: LogDecisionAction, answer: LogDecisionAnswer) => void;
  label?: string;
  embedded?: boolean;
  loading?: boolean;
  initialStepId?: string;
  beforeContent?: ReactNode;
  afterStep?: (id: string) => ReactNode;
  trailingContent?: ReactNode;
  footerContent?: ReactNode;
  navigation?: (jump: (stepId: string, entryId?: string) => void) => ReactNode;
}) {
  const [query, setQuery] = useState("");
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const id = useId();
  const scroller = useRef<HTMLDivElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const headings = useRef(new Map<string, HTMLHeadingElement>());
  const entryTargets = useRef(new Map<string, HTMLDivElement>());
  const jumpFrame = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!initialStepId) return;
    const heading = headings.current.get(initialStepId);
    const section = heading?.closest("section");
    const viewport = scroller.current;
    if (!section || !viewport) throw new Error("log-initial-step-missing");
    const style = getComputedStyle(viewport);
    if (end.current) end.current.style.height = `${Math.max(0, viewport.clientHeight - section.getBoundingClientRect().height - Number.parseFloat(style.paddingTop || "0") - Number.parseFloat(style.paddingBottom || "0"))}px`;
    viewport.scrollTop += section.getBoundingClientRect().top - viewport.getBoundingClientRect().top - Number.parseFloat(style.paddingTop || "0");
  }, [initialStepId]);
  useEffect(() => () => { if (jumpFrame.current !== undefined) cancelAnimationFrame(jumpFrame.current); }, []);
  const jump = (stepId: string, entryId?: string) => {
    const step = visualLogSteps(steps).find(step => step.id === stepId);
    if (!step) throw new Error("log-timeline-step-missing");
    const targetEntryId = entryId ?? (step.header === false ? step.entries[0]?.id : undefined);
    if (targetEntryId && !step.entries.some(entry => entry.id === targetEntryId)) throw new Error("log-navigation-entry-missing");
    setQuery("");
    if (jumpFrame.current !== undefined) cancelAnimationFrame(jumpFrame.current);
    jumpFrame.current = requestAnimationFrame(() => {
      const heading = headings.current.get(stepId);
      if (!heading) throw new Error("log-timeline-heading-missing");
      const target = targetEntryId ? entryTargets.current.get(JSON.stringify([stepId, targetEntryId])) : heading;
      if (!target) throw new Error("log-navigation-target-missing");
      const section = heading.closest("section");
      if (!section) throw new Error("log-timeline-section-missing");
      const viewport = scroller.current;
      if (!viewport) throw new Error("log-timeline-viewport-missing");
      const style = getComputedStyle(viewport);
      const scrollTarget = targetEntryId ? target : section;
      if (end.current) end.current.style.height = `${Math.max(0, viewport.clientHeight - scrollTarget.getBoundingClientRect().height - Number.parseFloat(style.paddingTop || "0") - Number.parseFloat(style.paddingBottom || "0"))}px`;
      viewport.scrollTop += scrollTarget.getBoundingClientRect().top - viewport.getBoundingClientRect().top - Number.parseFloat(style.paddingTop || "0");
      target.focus({ preventScroll: true });
      jumpFrame.current = undefined;
    });
  };
  const visual = useMemo(() => visualLogSteps(steps), [steps]);
  const visible = useMemo(() => filterLogSteps(visual, query), [visual, query]);
  const hidden = useMemo(() => {
    if (afterStep === undefined) return [];
    const ids = new Set(visible.map(step => step.id));
    return steps.filter(step => !ids.has(step.id));
  }, [steps, visible, afterStep]);
  const count = logRowCount(visible);
  const copy = async () => {
    try { await navigator.clipboard.writeText(logPlainText(visible)); setCopyState("copied"); }
    catch { setCopyState("failed"); }
  };
  return <div className={cn("ui-theme-scope flex min-h-0 min-w-0 flex-1 flex-col bg-ui-panel font-ui text-body text-ui-primary", embedded && "relative flex-none")}>
    {navigation?.(jump)}
    <div className={cn("min-w-0 flex-1 px-4 pb-6 pt-5", !embedded && "overflow-y-auto focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ui-info")} ref={scroller} role={embedded ? undefined : "region"} aria-label={embedded ? undefined : label} tabIndex={embedded ? undefined : 0} aria-busy={loading || undefined}>
      {beforeContent}
      {hidden.map(step => {
        const content = afterStep?.(step.id);
        return content == null ? null : <div key={step.id}>{content}</div>;
      })}
      {visible.map((step, index) => <section key={step.id} aria-labelledby={`${id}-${step.id}`} className={cn("grid min-w-0 grid-cols-[var(--spacing-log-time)_minmax(0,1fr)] gap-x-4 border-ui-stroke py-5 first:pt-0", index < visible.length - 1 && "border-b", visible.length > 200 && "[content-visibility:auto] [contain-intrinsic-size:auto_140px]")}>
        <time className={cn("font-data text-caption tabular-nums text-ui-muted", step.header === false ? "pt-4" : "pt-0.5")}>{step.time}</time>
        <div className="min-w-0">
          <header className={step.header === false ? "sr-only" : "mb-4 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1"}><h3 id={`${id}-${step.id}`} ref={node => { if (node) headings.current.set(step.id, node); else headings.current.delete(step.id); }} tabIndex={-1} className="m-0 rounded-sm text-heading focus:outline-2 focus:outline-offset-4 focus:outline-ui-info">{step.title}</h3>{step.system && <span className="inline-flex items-center gap-1.5 border-l border-ui-stroke pl-3 text-body text-ui-muted"><Monitor aria-hidden className="size-3.5" />{step.system}</span>}</header>
          <div className="flex min-w-0 flex-col gap-3">{step.entries.map((entry, index) => <div key={entry.id}
            ref={node => { const key = JSON.stringify([step.id, entry.id]); if (node) entryTargets.current.set(key, node); else entryTargets.current.delete(key); }}
            role={entry.kind === "decision" || (step.header === false && index === 0) ? "group" : undefined}
            aria-label={entry.kind === "decision" ? entry.decision.title : step.header === false && index === 0 ? step.title : undefined}
            tabIndex={entry.kind === "decision" || (step.header === false && index === 0) ? -1 : undefined}
            className="rounded-lg focus:outline-2 focus:outline-offset-2 focus:outline-ui-info"><Entry entry={entry} onDecision={onDecision} timeInStep={step.header === false && index === 0} />{(entry.kind === "fields" || entry.kind === "click") && entry.screenshots && <LogScreenshots screenshots={entry.screenshots} />}</div>)}</div>
        </div>
        {afterStep?.(step.id)}
      </section>)}
      {!visible.length && (loading && !steps.length ? <LogSkeleton /> : <div className="flex min-h-64 flex-col items-center justify-center gap-2 text-center"><ScanSearch aria-hidden className="mb-1 size-6 text-ui-muted" /><h3 className="m-0 text-heading">{query.trim() ? "No matching actions" : "No actions yet"}</h3><p className="m-0 text-body text-ui-secondary">{query.trim() ? "Try a field, value, or action name." : "Confirmed actions will appear here."}</p>{query.trim() && <Button variant="ghost" onClick={() => setQuery("")}>Clear search</Button>}</div>)}
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
        <IconButton label="Go to latest action" icon={<ArrowDownToLine aria-hidden className="size-3.5" />} onClick={() => { if (jumpFrame.current !== undefined) cancelAnimationFrame(jumpFrame.current); jumpFrame.current = undefined; if (end.current) end.current.style.height = "0px"; if (embedded) end.current?.scrollIntoView({ block: "end", behavior: "instant" }); else scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "instant" }); }} disabled={!count} />
      </span>
    </footer>
  </div>;
}
