import { LogSkeleton } from "../../shared/loading/loading.js";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ContextType, type ReactNode } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { ArrowDownToLine } from "lucide-react";
import { Button, EmptyState } from "../../../ds/ui.js";
import { cn } from "../../../lib/utils.js";
import { findLogMatches, logPlainText, visualLogSteps, type LogEntry, type LogHit, type LogStep } from "./log-feed-model.js";
import { LogDecisionBlock, type DecisionAnswerHandler } from "./log-decision.js";
import { ServedDraftsContext } from "./log-decision-model.js";
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

/** Shorter logs mount every step; longer ones mount only the steps near the viewport. */
const LOG_WINDOW_FROM = 200;
/** Frames a jump waits for a windowed step to mount before it reports the target missing. */
const JUMP_FRAMES = 10;

export type LogDecisionHandler = (id: string, option: Parameters<DecisionAnswerHandler>[0], answer: Parameters<DecisionAnswerHandler>[1]) => void;

/** What the run header needs to search, copy and download the log it sits above. */
export type LogTools = Readonly<{
  query: string;
  setQuery: (query: string) => void;
  /** 1-based position of the current match, 0 when there is none. */
  position: number;
  total: number;
  step: (delta: 1 | -1) => void;
  copyState: "idle" | "copied" | "failed";
  canCopy: boolean;
  copy: () => void;
  download: (name: string) => void;
}>;

/** Text of `container` that matches `needle`, in document order. */
function matchRanges(container: Element, needle: string): Range[] {
  const ranges: Range[] = [];
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const text = (node.textContent ?? "").toLocaleLowerCase();
    for (let at = text.indexOf(needle); at >= 0; at = text.indexOf(needle, at + needle.length)) {
      const range = document.createRange();
      range.setStart(node, at); range.setEnd(node, at + needle.length);
      ranges.push(range);
    }
  }
  return ranges;
}

/** Below this distance from the newest action the log counts as at the end. */
const AT_END_SLACK = 48;

/** Shared presentation for the operator stream and the isolated design preview. */
export function LogFeed({ onCancelRun, steps, label = "Run logs", embedded = false, beforeContent, afterStep, trailingContent, navigation, onDecision, initialStepId, loading = false }: {
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
  navigation?: (jump: (stepId: string, entryId?: string) => void, tools: LogTools) => ReactNode;
}) {
  const [query, setQuery] = useState("");
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const [active, setActive] = useState(0);
  const [atEnd, setAtEnd] = useState(true);
  const id = useId();
  const scroller = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null);
  const attachScroller = useCallback((node: HTMLDivElement | null) => { scroller.current = node; setViewport(node); }, []);
  const list = useRef<VirtuosoHandle>(null);
  const [drafts] = useState<NonNullable<ContextType<typeof ServedDraftsContext>>>(() => new Map());
  const end = useRef<HTMLDivElement>(null);
  const headings = useRef(new Map<string, HTMLHeadingElement>());
  const entryTargets = useRef(new Map<string, HTMLDivElement>());
  const jumpFrame = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!initialStepId || list.current || windowed) return;
    const heading = headings.current.get(initialStepId);
    const section = heading?.closest("section");
    const viewport = scroller.current;
    if (!section || !viewport) throw new Error("log-initial-step-missing");
    const style = getComputedStyle(viewport);
    viewport.scrollTop += section.getBoundingClientRect().top - viewport.getBoundingClientRect().top - Number.parseFloat(style.paddingTop || "0");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a log that grows past the window must not jump back to the initial step
  }, [initialStepId]);
  useEffect(() => () => { if (jumpFrame.current !== undefined) cancelAnimationFrame(jumpFrame.current); }, []);
  const jump = (stepId: string, entryId?: string, focus = true) => {
    const order = visualLogSteps(steps);
    const index = order.findIndex(step => step.id === stepId);
    const step = order[index];
    if (!step) throw new Error("log-timeline-step-missing");
    const targetEntryId = entryId ?? (step.header === false ? step.entries[0]?.id : undefined);
    if (targetEntryId && !step.entries.some(entry => entry.id === targetEntryId)) throw new Error("log-navigation-entry-missing");
    if (jumpFrame.current !== undefined) cancelAnimationFrame(jumpFrame.current);
    const land = (frames: number) => { jumpFrame.current = requestAnimationFrame(() => {
      const heading = headings.current.get(stepId);
      const target = heading && targetEntryId ? entryTargets.current.get(JSON.stringify([stepId, targetEntryId])) : heading;
      // A windowed step mounts only once it is scrolled near; bring it in and look again next frame.
      if (list.current && !target && frames > 0) { list.current.scrollToIndex({ index, align: "start" }); land(frames - 1); return; }
      if (!heading) throw new Error("log-timeline-heading-missing");
      if (!target) throw new Error("log-navigation-target-missing");
      const section = heading.closest("section");
      if (!section) throw new Error("log-timeline-section-missing");
      const viewport = scroller.current;
      if (!viewport) throw new Error("log-timeline-viewport-missing");
      const style = getComputedStyle(viewport);
      const scrollTarget = targetEntryId && step.header === false ? target : section;
      viewport.scrollTop += scrollTarget.getBoundingClientRect().top - viewport.getBoundingClientRect().top - Number.parseFloat(style.paddingTop || "0");
      if (focus) (target.querySelector<HTMLElement>("form[aria-label][tabindex=\"-1\"]") ?? target).focus({ preventScroll: true });
      jumpFrame.current = undefined;
    }); };
    land(JUMP_FRAMES);
  };
  const visual = useMemo(() => visualLogSteps(steps), [steps]);
  const { hits, stepIds } = useMemo(() => findLogMatches(visual, query), [visual, query]);
  const position = hits.length === 0 ? 0 : Math.min(active, hits.length - 1) + 1;
  const reveal = (hit: LogHit | undefined) => { if (hit) jump(hit.stepId, hit.entryId, false); };
  // Typing or stepping moves to the match; a log that grows while it is searched leaves the view where it is.
  useEffect(() => { reveal(hits[position - 1]); }, [query, position]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const root = scroller.current, needle = query.trim().toLocaleLowerCase();
    if (!root || !needle || typeof CSS === "undefined" || !("highlights" in CSS)) return;
    const paint = () => {
      const hit = hits[position - 1];
      const container = hit && (hit.entryId === undefined ? headings.current.get(hit.stepId) : entryTargets.current.get(JSON.stringify([hit.stepId, hit.entryId])));
      const current = container ? matchRanges(container, needle)[hit.nth] : undefined;
      const others = matchRanges(root, needle).filter(range => range.startContainer !== current?.startContainer || range.startOffset !== current.startOffset);
      CSS.highlights.set("log-match", new Highlight(...others));
      CSS.highlights.set("log-match-current", new Highlight(...(current ? [current] : [])));
    };
    let frame = requestAnimationFrame(paint);
    // A windowed log mounts steps as they scroll in.
    const observer = new MutationObserver(() => { cancelAnimationFrame(frame); frame = requestAnimationFrame(paint); });
    observer.observe(root, { childList: true, subtree: true });
    return () => { observer.disconnect(); cancelAnimationFrame(frame); CSS.highlights.delete("log-match"); CSS.highlights.delete("log-match-current"); };
  }, [hits, position, query, viewport]);
  const dimming = query.trim() !== "" && hits.length > 0;
  const windowed = !embedded && visual.length > LOG_WINDOW_FROM;
  const stepNode = (step: LogStep, index: number) => <StepFrame key={step.id} leading={step.time} title={step.title} system={step.system} titleId={`${id}-${step.id}`} headerHidden={step.header === false}
    titleRef={node => { if (node) headings.current.set(step.id, node); else headings.current.delete(step.id); }}
    className={cn(index < visual.length - 1 && "border-b", windowed && index > 0 && "first:pt-5", dimming && !stepIds.has(step.id) && "opacity-45")}
    after={afterStep?.(step.id)}>
    {step.entries.map((entry, index) => <div key={entry.id}
      ref={node => { const key = JSON.stringify([step.id, entry.id]); if (node) entryTargets.current.set(key, node); else entryTargets.current.delete(key); }}
      tabIndex={(entry.kind === "decision" && !entry.decision.answered) || (step.header === false && index === 0) ? -1 : undefined}
      className={cn("rounded-lg", entry.kind === "decision" && entry.decision.answered ? "outline-none" : "focus:outline-2 focus:outline-offset-2 focus:outline-ui-info")}><Entry entry={entry} onDecision={onDecision} onCancelRun={onCancelRun} timeInStep={index === 0} />{(entry.kind === "fields" || entry.kind === "click") && entry.screenshots && <LogScreenshots screenshots={entry.screenshots} presentation={entry.screenshots.some(shot => shot.boundary === "before-submit" || shot.boundary === "after-submit") ? "submit" : undefined} />}</div>)}
  </StepFrame>;
  const initialIndex = initialStepId === undefined ? -1 : visual.findIndex(step => step.id === initialStepId);
  const copy = async () => {
    try { await navigator.clipboard.writeText(logPlainText(visual)); setCopyState("copied"); }
    catch { setCopyState("failed"); }
  };
  const download = (name: string) => {
    const url = URL.createObjectURL(new Blob([logPlainText(visual)], { type: "text/plain" }));
    const link = document.createElement("a");
    link.href = url; link.download = `${name}.txt`; link.click();
    URL.revokeObjectURL(url);
  };
  const measureEnd = () => { const node = scroller.current; if (node) setAtEnd(node.scrollHeight - node.scrollTop - node.clientHeight <= AT_END_SLACK); };
  useEffect(measureEnd, [steps]);
  const goLatest = () => { if (jumpFrame.current !== undefined) cancelAnimationFrame(jumpFrame.current); jumpFrame.current = undefined; if (embedded) end.current?.scrollIntoView({ block: "end", behavior: "instant" }); else { list.current?.scrollToIndex({ index: "LAST", align: "end" }); scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "instant" }); } };
  const tools: LogTools = { query, setQuery: next => { setQuery(next); setActive(0); setCopyState("idle"); }, position, total: hits.length,
    step: delta => setActive(hits.length === 0 ? 0 : (position - 1 + delta + hits.length) % hits.length), copyState, canCopy: visual.length > 0, copy: () => void copy(), download };
  return <ServedDraftsContext.Provider value={drafts}><div className={cn("ui-theme-scope flex min-h-0 min-w-0 flex-1 flex-col bg-ui-panel font-ui text-body text-ui-primary", embedded && "relative flex-none")}>
    {navigation?.(jump, tools)}
    <div className={cn("relative flex min-h-0 min-w-0 flex-1 flex-col", embedded && "flex-none")}>
    {/* Ahead of the scroller in tab order: tabbing through the rows scrolls to the end, which removes the pill. */}
    {!embedded && !atEnd && visual.length > 0 && <Button size="sm" icon={<ArrowDownToLine aria-hidden className="size-4" />} className="absolute z-10 bottom-4 left-1/2 -translate-x-1/2 rounded-full shadow-lg" onClick={goLatest}>Jump to latest</Button>}
    <div className={cn("@container min-w-0 flex-1 px-4 pb-6 pt-5", !embedded && "overflow-y-auto focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ui-info")} onScroll={embedded ? undefined : measureEnd} ref={attachScroller} role={embedded ? undefined : "region"} aria-label={embedded ? undefined : label} tabIndex={embedded ? undefined : 0} aria-busy={loading || undefined}>
      {beforeContent}
      {windowed
        ? viewport !== null && <Virtuoso ref={list} customScrollParent={viewport} data={visual} computeItemKey={(_, step) => step.id} increaseViewportBy={600}
          {...(initialIndex < 0 ? {} : { initialTopMostItemIndex: initialIndex })}
          // flow-root keeps each step's own spacing inside the measured item
          itemContent={(index, step) => <div className="flow-root">{stepNode(step, index)}</div>} />
        : visual.map(stepNode)}
      {!visual.length && (loading && !steps.length ? <LogSkeleton /> : <EmptyState className="min-h-64" title="No actions yet" />)}
      {trailingContent}
      <div ref={end} />
    </div>
    </div>
  </div></ServedDraftsContext.Provider>;
}
