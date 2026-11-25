import { memo, useEffect, useRef, useState, type ReactNode } from "react";
import { ClipboardCheck, CircleCheck, TriangleAlert } from "lucide-react";
import { DASHBOARD_LOGS_REGION_ID } from "../settings/settings-model.js";
import { LogFeed, type LogDecisionHandler, type LogTools } from "./logs/log-feed.js";
import type { LogStep } from "./logs/log-feed-model.js";
import { LogTimeline } from "./logs/log-timeline.js";
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
/** Below this header width the text buttons collapse to icons. */
const COMPACT_HEADER_WIDTH = 520;
const SEARCH_FIELD_WIDTH = 360;
/** Below this header width an open search and the actions take their own line under the title. */
const STACKED_SEARCH_WIDTH = 600;

/** One row: the title truncates, the actions stay on the line. An open search collapses text buttons sooner, shrinks the field, and on a narrow panel moves below the title, so nothing is pushed past the edge. */
function LogHeader({ title, status, middle, searching, children }: { title: string; status?: ReactNode; middle?: ReactNode; searching: boolean; children: ReactNode }) {
  const row = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(Infinity);
  // An open search takes the field's width from the text buttons.
  const compact = width < COMPACT_HEADER_WIDTH + (searching ? SEARCH_FIELD_WIDTH : 0);
  const stacked = searching && width < STACKED_SEARCH_WIDTH;
  useEffect(() => {
    const node = row.current;
    if (node === null) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return <header className="shrink-0 border-b border-ui-stroke bg-ui-table px-4 py-3">
    <div ref={row} className={cn("flex min-h-6 min-w-0 items-center gap-3", stacked && "flex-wrap")}><h2 className={cn("m-0 truncate text-heading", searching ? "min-w-24" : "min-w-0")} title={title}>{title}</h2>{status && <span className="flex shrink-0 items-center gap-2">{status}</span>}{middle}
      <LogHeaderCompact.Provider value={compact}><span className={cn("ml-auto flex items-center gap-2", searching ? "min-w-0 [&>:not([role=search])]:shrink-0" : "shrink-0", stacked && "w-full flex-wrap justify-end")}>{children}</span></LogHeaderCompact.Provider>
    </div>
  </header>;
}

/** The production log layout accepts presentation data and has no transport dependency. */
export const LogPanel = memo(function LogPanel({ title, steps, timeline, toolbar, status, linkedRuns, onOpenLinkedRun, onDecision, onCancelRun, onReview, initialStepId, navigation, content, afterStep, trailingContent, headerActions, rerun, records }: {
  onDecision?: LogDecisionHandler;
  onCancelRun?: (entryId: string) => void;
  onReview?: () => void;
  linkedRuns?: readonly LinkedRunEntry[]; onOpenLinkedRun?: (target: LinkedRunWire) => void;
  title: string; status?: ReactNode; steps: readonly LogStep[]; timeline: readonly LogTimelineStage[]; toolbar?: ReactNode; initialStepId?: string;
  headerActions?: ReactNode; rerun?: LogMenuRerun; records?: LogMenuRecords; navigation?: ReactNode; content?: ReactNode; afterStep?: (id: string) => ReactNode; trailingContent?: ReactNode;
}) {
  const action = runHeaderAction(steps, timeline);
  const [searching, setSearching] = useState(false);
  const header = (jump?: (stepId: string, entryId?: string) => void, tools?: LogTools) => <LogHeader title={title} status={status} searching={searching} middle={jump && !searching ? <LogTimeline stages={timeline} onJump={stepId => jump(stepId)} /> : undefined}>
    {action && jump && <LogActionButton label={action.label} variant={action.label === 'Review' ? 'primary' : undefined} icon={headerIcon(action.label)} onClick={() => action.label === 'Review' && onReview ? onReview() : jump(action.stepId, action.entryId)} />}{toolbar}{linkedRuns && <LinkedRunsButton entries={linkedRuns} onOpen={onOpenLinkedRun} />}{headerActions}
    {tools && <><span role="status" className="text-caption text-ui-muted">{tools.copyState === "copied" ? "Copied" : tools.copyState === "failed" ? "Copy unavailable" : ""}</span><LogSearch tools={tools} onOpenChange={setSearching} /></>}
    <LogActionsMenu title={title} tools={tools} rerun={rerun} records={records} />
  </LogHeader>;
  return <section id={DASHBOARD_LOGS_REGION_ID} tabIndex={-1} aria-label="Selected run logs" className="ui-theme-scope flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-ui-stroke bg-ui-panel font-ui text-ui-primary [--ds-control-bg:var(--ui-table)] [--ds-control-fg:var(--ui-primary)] [--ds-control-bg-hover:var(--ui-hover)] [--ds-border-strong:var(--ui-stroke-control)] [--ds-focus-ring:var(--ui-info)]">
    {content ? <>{header()}{navigation}{content}</> : <LogFeed steps={steps} afterStep={afterStep} trailingContent={trailingContent} initialStepId={initialStepId} onDecision={onDecision} onCancelRun={onCancelRun}
      navigation={(jump, tools) => <>{header(jump, tools)}{navigation}</>} />}
  </section>;
});
