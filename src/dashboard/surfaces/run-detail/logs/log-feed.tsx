import { LogSkeleton } from "../../shared/loading/loading.js";
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ContextType, type ReactNode } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { ArrowDownToLine, CircleCheck, CircleX, LoaderCircle } from "lucide-react";
import { Button, EmptyState } from "../../../ds/ui.js";
import { cn } from "../../../lib/utils.js";
import { logPlainText, matchRanges, visualLogSteps, type LogEntry, type LogStep } from "./log-feed-model.js";
import { LogDecisionBlock, type DecisionAnswerHandler } from "./log-decision.js";
import { ServedDraftsContext } from "./log-decision-model.js";
import { LogScreenshots, RequiredCaptureStatus } from "./log-screenshots.js";
import { ClickLine } from "../../shared/steps/click-line.js";
import { FieldRow, FieldRows } from "../../shared/steps/field-row.js";
import { PageCard, ResultLine } from "../../shared/steps/page-card.js";
import { NoteLine } from "../../shared/steps/note-line.js";
import { StepFrame } from "../../shared/steps/step-frame.js";
import type { RunLogSearchResponse } from "../../../../models/dashboard/run-detail.js";

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
  // A step row carries its own time, so rows of one stage line up; the stage heading keeps its own.
  return <div className="grid min-w-0 grid-cols-[var(--spacing-log-time)_minmax(0,1fr)] gap-x-3"><time className="pt-2 text-caption tabular-nums text-ui-muted">{entry.time}</time><div className="min-w-0" data-log-note-message={entry.captureFailure === undefined ? entry.id : undefined}><LogNote entry={entry} />{entry.captureFailure && <RequiredCaptureStatus state={entry.captureFailure} />}</div></div>;
}
const STEP_STATE_ICON = { done: CircleCheck, active: LoaderCircle, failed: CircleX } as const;
function LogNote({ entry }: { entry: Extract<LogEntry, { kind: "note" }> }) {
  const Icon = entry.state === undefined ? undefined : STEP_STATE_ICON[entry.state];
  return <NoteLine message={entry.message} tone={entry.tone} announce={entry.announce} announceKey={entry.id}
    icon={Icon === undefined ? undefined : <Icon aria-hidden className="size-3.5 self-start translate-y-0.5" />} />;
}

/** Shorter logs mount every step; longer ones mount only the steps near the viewport. */
const LOG_WINDOW_FROM = 200;
/** Frames a jump waits for a windowed step to mount before it reports the target missing. */
const JUMP_FRAMES = 10;

export type LogDecisionHandler = (id: string, option: Parameters<DecisionAnswerHandler>[0], answer: Parameters<DecisionAnswerHandler>[1]) => void;
export type SearchLogNotes = (query: string, signal: AbortSignal) => Promise<RunLogSearchResponse>;

/** What the run header needs to search, copy and download the log it sits above. */
export type LogTools = Readonly<{
  query: string;
  setQuery: (query: string) => void;
  /** 1-based position of the current match, 0 when there is none. */
  position: number;
  total: number;
  searchFailed?: boolean;
  step: (delta: 1 | -1) => void;
  copyState: "idle" | "copied" | "failed";
  canCopy: boolean;
  copy: () => void;
  download: (name: string) => void;
}>;

/** The matches on screen and the steps that hold one. */
type Found = Readonly<{ ranges: readonly Range[]; stepIds: ReadonlySet<string> }>;
const NOTHING_FOUND: Found = { ranges: [], stepIds: new Set() };

/** Below this distance from the newest action the log counts as at the end. */
const AT_END_SLACK = 48;

/** Shared presentation for the operator stream and the isolated design preview. */
export function LogFeed({ onCancelRun, steps, label = "Run logs", embedded = false, beforeContent, afterStep, trailingContent, navigation, onDecision, initialStepId, loading = false, searchNotes }: {
  steps: readonly LogStep[];
  onDecision?: LogDecisionHandler;
  onCancelRun?: (entryId: string) => void;
  label?: string;
  embedded?: boolean;
  loading?: boolean;
  searchNotes?: SearchLogNotes;
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
  const jump = (stepId: string, entryId?: string) => {
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
      (target.querySelector<HTMLElement>("form[aria-label][tabindex=\"-1\"]") ?? target).focus({ preventScroll: true });
      jumpFrame.current = undefined;
    }); };
    land(JUMP_FRAMES);
  };
  const visual = useMemo(() => visualLogSteps(steps), [steps]);
  const needle = query.trim();
  const [found, setFound] = useState<Found>(NOTHING_FOUND);
  const [servedSearch, setServedSearch] = useState<{ query: string; result?: RunLogSearchResponse }>();
  useEffect(() => {
    if (!needle || needle.length > 256 || searchNotes === undefined) return;
    const controller = new AbortController();
    void searchNotes(needle, controller.signal).then(result => {
      if (!controller.signal.aborted) setServedSearch({ query: needle, result });
    }, () => {
      if (!controller.signal.aborted) setServedSearch({ query: needle });
    });
    return () => controller.abort();
  }, [needle, searchNotes, steps]);
  const served = servedSearch?.query === needle ? servedSearch : undefined;
  // A search mounts every step, so what is counted, painted and scrolled to is the same drawn text.
  // shortcut: typing slows on very long logs, and closing the search remounts the window; keep a match index if that bites.
  const windowed = !embedded && visual.length > LOG_WINDOW_FROM && !needle;
  const position = found.ranges.length === 0 ? 0 : Math.min(active, found.ranges.length - 1) + 1;
  const reveal = (range: Range | undefined) => {
    const view = scroller.current, match = range?.startContainer.parentElement;
    if (!view || !match || embedded) return;
    if (jumpFrame.current !== undefined) cancelAnimationFrame(jumpFrame.current);
    const box = match.getBoundingClientRect();
    view.scrollTop += box.top - view.getBoundingClientRect().top - (view.clientHeight - box.height) / 2;
  };
  const revealed = useRef("");
  useLayoutEffect(() => {
    const root = scroller.current;
    const search = () => {
      const ranges = root && needle ? matchRanges(root, needle) : [];
      const indexed = new Set(served?.result?.indexedNoteIds);
      const matched = new Set(served?.result?.matchedNoteIds);
      const visible = ranges.filter(range => {
        const id = range.startContainer.parentElement?.closest<HTMLElement>("[data-log-note-message]")?.dataset.logNoteMessage;
        return id === undefined || !indexed.has(id) || matched.has(id);
      });
      const stepIds = new Set([...headings.current].filter(([, heading]) => {
        const section = heading.closest("section");
        return visible.some(range => section?.contains(range.startContainer));
      }).map(([stepId]) => stepId));
      setFound(visible.length ? { ranges: visible, stepIds } : NOTHING_FOUND);
      return visible;
    };
    const ranges = search();
    // A new search moves to its first match; a log that grows while it is searched leaves the view where it is.
    if (revealed.current !== needle) { revealed.current = needle; reveal(ranges[0]); }
    if (!root || !needle) return;
    let frame: number | undefined;
    const observer = new MutationObserver(() => { if (frame !== undefined) cancelAnimationFrame(frame); frame = requestAnimationFrame(search); });
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    return () => { observer.disconnect(); if (frame !== undefined) cancelAnimationFrame(frame); };
  }, [needle, viewport, served]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (typeof CSS === "undefined" || !("highlights" in CSS) || !found.ranges.length) return;
    const current = found.ranges[position - 1];
    CSS.highlights.set("log-match", new Highlight(...found.ranges.filter(range => range !== current)));
    CSS.highlights.set("log-match-current", new Highlight(...(current ? [current] : [])));
    return () => { CSS.highlights.delete("log-match"); CSS.highlights.delete("log-match-current"); };
  }, [found, position]);
  const dimming = needle !== "" && found.ranges.length > 0;
  const stepNode = (step: LogStep, index: number) => <StepFrame key={step.id} leading={step.time} title={step.title} system={step.system} titleId={`${id}-${step.id}`} headerHidden={step.header === false}
    titleRef={node => { if (node) headings.current.set(step.id, node); else headings.current.delete(step.id); }}
    className={cn(index < visual.length - 1 && "border-b", windowed && index > 0 && "first:pt-5", dimming && !found.stepIds.has(step.id) && "opacity-45")}
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
  const tools: LogTools = { query, setQuery: next => { setQuery(next); setServedSearch(undefined); setActive(0); setCopyState("idle"); }, position, total: found.ranges.length,
    searchFailed: served !== undefined && served.result === undefined,
    step: delta => {
      const total = found.ranges.length;
      if (!total) return;
      const next = (position - 1 + delta + total) % total;
      setActive(next);
      reveal(found.ranges[next]);
    }, copyState, canCopy: visual.length > 0, copy: () => void copy(), download };
  return <ServedDraftsContext.Provider value={drafts}><div className={cn("ui-theme-scope flex min-h-0 min-w-0 flex-1 flex-col bg-ui-panel font-ui text-body text-ui-primary", embedded && "relative flex-none")}>
    {navigation?.(jump, tools)}
    <div className={cn("relative flex min-h-0 min-w-0 flex-1 flex-col", embedded && "flex-none")}>
    {/* Ahead of the scroller in tab order: tabbing through the rows scrolls to the end, which removes the pill. */}
    {!embedded && !atEnd && visual.length > 0 && <Button size="sm" icon={<ArrowDownToLine aria-hidden className="size-4" />} className="absolute z-10 bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-ui-panel shadow-lg" onClick={goLatest}>Jump to latest</Button>}
    <div className={cn("@container min-w-0 flex-1 px-4 pb-6 pt-5", !embedded && "overflow-y-auto focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ui-info")} onScroll={embedded ? undefined : measureEnd} ref={attachScroller} role={embedded ? undefined : "region"} aria-label={embedded ? undefined : label} tabIndex={embedded ? undefined : 0} aria-busy={loading || undefined}>
      {beforeContent}
      {windowed
        ? viewport !== null && <Virtuoso ref={list} customScrollParent={viewport} totalListHeightChanged={measureEnd} data={visual} computeItemKey={(_, step) => step.id} increaseViewportBy={600}
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
