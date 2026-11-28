import { memo, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ClipboardCheck, CircleCheck, TriangleAlert } from "lucide-react";
import { DASHBOARD_LOGS_REGION_ID } from "../settings/settings-model.js";
import { LogFeed, type LogDecisionHandler, type LogTools, type SearchLogNotes } from "./logs/log-feed.js";
import type { LogStep } from "./logs/log-feed-model.js";
import { LogActionButton } from "./logs/log-action-button.js";
import { LogActionsMenu, type LogMenuRecords, type LogMenuRerun } from "./logs/log-actions-menu.js";
import { LogSearch } from "./logs/log-search.js";
import { LogHeaderCompact } from "./logs/log-header-compact.js";
import { cn } from "../../lib/utils.js";
import { LinkedRunsButton } from "./linked-runs.js";
import type { LinkedRunEntry } from "./linked-runs-model.js";
import type { LinkedRunWire } from "../queue/queue-model.js";
import { runHeaderAction } from "./run-header-model.js";
import type { LogTimelineStage } from "./logs/log-timeline-model.js";

const headerIcon = (label: string) => label === "Review" ? <ClipboardCheck aria-hidden className="size-4" /> : label === "View failure" ? <TriangleAlert aria-hidden className="size-4" /> : <CircleCheck aria-hidden className="size-4" />;
/** One row: the title truncates, the actions stay on the line. When the row's contents overflow, text buttons collapse to icons first, then the actions take their own line under the title, so nothing is pushed past the edge. */
function LogHeader({ title, status, subtitle, searching, layoutKey, children }: { title: string; status?: ReactNode; subtitle?: ReactNode; searching: boolean; layoutKey: readonly unknown[]; children: ReactNode }) {
  const row = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const [width, setWidth] = useState(Infinity);
  // 0 = text buttons, 1 = icons, 2 = icons beside the search on their own line. Only more room or new contents start again at 0; a narrower row keeps its level.
  const [level, setLevel] = useState(0);
  const key = [searching, ...layoutKey];
  const [seen, setSeen] = useState({ key, width });
  if (width > seen.width || key.length !== seen.key.length || key.some((value, index) => !Object.is(value, seen.key[index]))) { setSeen({ key, width }); setLevel(0); }
  else if (width < seen.width) setSeen({ key, width });
  useLayoutEffect(() => {
    const node = row.current;
    const title = heading.current;
    if (node === null || title === null) return;
    // A squeezed title counts as overflow: buttons collapse, then move to their own line, before the name truncates.
    if (level < 2 && (node.scrollWidth > node.clientWidth || title.scrollWidth > title.clientWidth)) setLevel(level + 1);
  }, [level, seen]);
  useEffect(() => {
    const node = row.current;
    if (node === null) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const stacked = level === 2;
  return <header className="shrink-0 border-b border-ui-stroke bg-ui-table px-4 py-[7px] min-h-11">
    <div ref={row} className={cn("flex min-h-6 min-w-0 items-center gap-3", stacked && "flex-wrap")}><h2 ref={heading} className={cn("m-0 truncate text-heading", searching ? "min-w-24" : "min-w-0")} title={title}>{title}</h2>{status && <span className="flex shrink-0 items-center gap-2">{status}</span>}
      <LogHeaderCompact.Provider value={level > 0}><span className={cn("ml-auto flex items-center gap-2", searching ? "min-w-0 [&>:not([role=search])]:shrink-0" : "shrink-0", stacked && "w-full flex-wrap justify-end [&>[role=search]]:w-auto [&>[role=search]]:min-w-[300px] [&>[role=search]]:flex-1")}>{children}</span></LogHeaderCompact.Provider>
    </div>
    {subtitle}
  </header>;
}

/** The production log layout accepts presentation data and has no transport dependency. */
export const LogPanel = memo(function LogPanel({ title, steps, timeline, toolbar, status, linkedRuns, onOpenLinkedRun, onDecision, onCancelRun, onReview, initialStepId, navigation, content, afterStep, trailingContent, headerActions, rerun, records, subtitle, searchNotes }: {
  subtitle?: ReactNode;
  searchNotes?: SearchLogNotes;
  onDecision?: LogDecisionHandler;
  onCancelRun?: (entryId: string) => void;
  onReview?: () => void;
  linkedRuns?: readonly LinkedRunEntry[]; onOpenLinkedRun?: (target: LinkedRunWire) => void;
  title: string; status?: ReactNode; steps: readonly LogStep[]; timeline: readonly LogTimelineStage[]; toolbar?: ReactNode; initialStepId?: string;
  headerActions?: ReactNode; rerun?: LogMenuRerun; records?: LogMenuRecords; navigation?: ReactNode; content?: ReactNode; afterStep?: (id: string) => ReactNode; trailingContent?: ReactNode;
}) {
  const action = runHeaderAction(steps, timeline);
  const [searching, setSearching] = useState(false);
  const header = (jump?: (stepId: string, entryId?: string) => void, tools?: LogTools) => <LogHeader title={title} status={status} subtitle={subtitle} searching={searching} layoutKey={[title, status, subtitle, toolbar, headerActions, linkedRuns, action?.label, !!tools]}>
    {action && jump && <LogActionButton label={action.label} variant={action.label === 'Review' ? 'primary' : undefined} icon={headerIcon(action.label)} onClick={() => action.label === 'Review' && onReview ? onReview() : jump(action.stepId, action.entryId)} />}{toolbar}{linkedRuns && <LinkedRunsButton entries={linkedRuns} onOpen={onOpenLinkedRun} />}{headerActions}
    {tools && <><span role="status" className="text-caption text-ui-muted">{tools.copyState === "copied" ? "Copied" : tools.copyState === "failed" ? "Copy unavailable" : ""}</span><LogSearch tools={tools} onOpenChange={setSearching} /></>}
    <LogActionsMenu title={title} tools={tools} rerun={rerun} records={records} />
  </LogHeader>;
  return <section id={DASHBOARD_LOGS_REGION_ID} tabIndex={-1} aria-label="Selected run logs" className="ui-theme-scope flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-ui-stroke bg-ui-panel font-ui text-ui-primary [--ds-control-bg:var(--ui-table)] [--ds-control-fg:var(--ui-primary)] [--ds-control-bg-hover:var(--ui-hover)] [--ds-border-strong:var(--ui-stroke-control)] [--ds-focus-ring:var(--ui-info)]">
    {content ? <>{header()}{navigation}{content}</> : <LogFeed steps={steps} afterStep={afterStep} trailingContent={trailingContent} initialStepId={initialStepId} onDecision={onDecision} onCancelRun={onCancelRun} searchNotes={searchNotes}
      navigation={(jump, tools) => <>{header(jump, tools)}{navigation}</>} />}
  </section>;
});
