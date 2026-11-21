import { LogSkeleton } from "../../shared/loading/loading.js";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowDownToLine, Check, Copy } from "lucide-react";
import { Button, EmptyState, IconButton, SearchInput } from "../../../ds/ui.js";
import { cn } from "../../../lib/utils.js";
import { filterLogSteps, logPlainText, logRowCount, visualLogSteps, type LogEntry, type LogStep } from "./log-feed-model.js";
import { LogDecisionBlock, type DecisionAnswerHandler } from "./log-decision.js";
import { LogScreenshots, RequiredCaptureStatus } from "./log-screenshots.js";
import { ClickLine } from "../../shared/steps/click-line.js";
import { FieldRow, FieldRows } from "../../shared/steps/field-row.js";
import { PageCard, ResultLine } from "../../shared/steps/page-card.js";
import { NoteLine } from "../../shared/steps/note-line.js";
import { StepFrame } from "../../shared/steps/step-frame.js";

function Entry({ entry, onDecision, onCancelRun, timeInStep = false }: { entry: LogEntry; timeInStep?: boolean; onDecision?: LogDecisionHandler; onCancelRun?: (entryId: string) => void }) {
  const block = entry.kind === "decision" ? <LogDecisionBlock decision={entry.decision} onAnswer={onDecision ? (option, answer) => onDecision(entry.id, option, answer) : undefined} onCancel={onCancelRun ? () => onCancelRun(entry.id) : undefined} /> : undefined;
  if (entry.kind === "decision" && entry.decision.title === "Screenshot" && entry.decision.state === "recorded" && entry.decision.screenshots) return <LogScreenshots screenshots={entry.decision.screenshots} presentation={entry.decision.screenshots.some(shot => shot.boundary === "before-submit" || shot.boundary === "after-submit") ? "submit" : undefined} />;
  if (block && timeInStep) return block;
  if (entry.kind === "decision") return <div className="grid min-w-0 grid-cols-[var(--spacing-log-time)_minmax(0,1fr)] gap-x-3"><time className="pt-4 text-caption tabular-nums text-ui-muted">{entry.time}</time>{block}</div>;
  if (entry.kind === "fields") return <PageCard title={entry.title} bare={entry.title === undefined && entry.result === undefined}>
    <FieldRows padded={entry.title !== undefined || entry.result !== undefined}>
      {entry.fields.map(field => <FieldRow key={field.id} kind={field.kind} label={field.label} value={field.value} unread={field.unread} mark={field.mark} />)}
    </FieldRows>
    {entry.result && <ResultLine value={entry.result} />}
  </PageCard>;
  if (entry.kind === "click") return <ClickLine label={entry.label} />;
  return <><LogNote entry={entry} />{entry.captureFailure && <RequiredCaptureStatus state={entry.captureFailure} />}</>;
}
function LogNote({ entry }: { entry: Extract<LogEntry, { kind: "note" }> }) {
  return <NoteLine message={entry.message} tone={entry.tone} announce={entry.announce} announceKey={entry.id} />;
}

export type LogDecisionHandler = (id: string, option: Parameters<DecisionAnswerHandler>[0], answer: Parameters<DecisionAnswerHandler>[1]) => void;

/** Shared presentation for the operator stream and the isolated design preview. */
export function LogFeed({ onCancelRun, steps, label = "Run logs", embedded = false, beforeContent, afterStep, trailingContent, footerContent, footerActions, navigation, onDecision, initialStepId, loading = false }: {
  steps: readonly LogStep[];
  onDecision?: LogDecisionHandler;
  onCancelRun?: (entryId: string) => void;
  label?: string;
  embedded?: boolean;
  loading?: boolean;
  initialStepId?: string;
  beforeContent?: ReactNode;
  afterStep?: (id: string) => ReactNode;
  trailingContent?: ReactNode;
  footerContent?: ReactNode;
  footerActions?: ReactNode;
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
      const scrollTarget = targetEntryId && step.header === false ? target : section;
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
    <div className={cn("@container min-w-0 flex-1 px-4 pb-6 pt-5", !embedded && "overflow-y-auto focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ui-info")} ref={scroller} role={embedded ? undefined : "region"} aria-label={embedded ? undefined : label} tabIndex={embedded ? undefined : 0} aria-busy={loading || undefined}>
      {beforeContent}
      {hidden.map(step => {
        const content = afterStep?.(step.id);
        return content == null ? null : <div key={step.id}>{content}</div>;
      })}
      {visible.map((step, index) => <StepFrame key={step.id} leading={step.time} title={step.title} system={step.system} titleId={`${id}-${step.id}`} headerHidden={step.header === false}
        titleRef={node => { if (node) headings.current.set(step.id, node); else headings.current.delete(step.id); }}
        className={cn(index < visible.length - 1 && "border-b", visible.length > 200 && "[content-visibility:auto] [contain-intrinsic-size:auto_140px]")}
        after={afterStep?.(step.id)}>
        {step.entries.map((entry, index) => <div key={entry.id}
          ref={node => { const key = JSON.stringify([step.id, entry.id]); if (node) entryTargets.current.set(key, node); else entryTargets.current.delete(key); }}
          role={entry.kind === "decision" || (step.header === false && index === 0) ? "group" : undefined}
          aria-label={entry.kind === "decision" ? entry.decision.title : step.header === false && index === 0 ? step.title : undefined}
          tabIndex={(entry.kind === "decision" && !entry.decision.answered) || (step.header === false && index === 0) ? -1 : undefined}
          className={cn("rounded-lg", entry.kind === "decision" && entry.decision.answered ? "outline-none" : "focus:outline-2 focus:outline-offset-2 focus:outline-ui-info")}><Entry entry={entry} onDecision={onDecision} onCancelRun={onCancelRun} timeInStep={index === 0} />{(entry.kind === "fields" || entry.kind === "click") && entry.screenshots && <LogScreenshots screenshots={entry.screenshots} presentation={entry.screenshots.some(shot => shot.boundary === "before-submit" || shot.boundary === "after-submit") ? "submit" : undefined} />}</div>)}
      </StepFrame>)}
      {!visible.length && (loading && !steps.length ? <LogSkeleton /> : <EmptyState className="min-h-64" title={query.trim() ? "No matching actions" : "No actions yet"} action={query.trim() ? <Button variant="ghost" onClick={() => setQuery("")}>Clear search</Button> : undefined} />)}
      {trailingContent}
      <div ref={end} />
    </div>
    <footer className={cn("log-footer flex shrink-0 items-center gap-3 border-t border-ui-stroke bg-ui-panel px-3 py-2", embedded && "sticky bottom-0 mt-auto")}>
      <SearchInput className="w-44 min-w-0 shrink" aria-label="Search logs" placeholder="Search logs" value={query} onChange={event => { setQuery(event.target.value); setCopyState("idle"); }} onClear={() => setQuery("")} />
      <span className="shrink-0 whitespace-nowrap text-caption tabular-nums text-ui-muted" role="status">{count} {query.trim() ? "matching " : ""}{count === 1 ? "action" : "actions"}</span>
      {footerContent}
      <span className="ml-auto inline-flex shrink-0 items-center gap-1">
        <span className="mr-2 text-caption text-ui-muted" role="status">{copyState === "copied" ? "Copied" : copyState === "failed" ? "Copy unavailable" : ""}</span>
        {footerActions}
        <IconButton label="Copy logs" icon={copyState === "copied" ? <Check aria-hidden className="size-4" /> : <Copy aria-hidden className="size-4" />} onClick={() => void copy()} disabled={!count} />
        <IconButton label="Go to latest action" icon={<ArrowDownToLine aria-hidden className="size-4" />} onClick={() => { if (jumpFrame.current !== undefined) cancelAnimationFrame(jumpFrame.current); jumpFrame.current = undefined; if (embedded) end.current?.scrollIntoView({ block: "end", behavior: "instant" }); else scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "instant" }); }} disabled={!count} />
      </span>
    </footer>
  </div>;
}
