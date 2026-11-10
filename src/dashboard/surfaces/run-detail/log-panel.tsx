import { memo, useEffect, useRef, useState, type ReactNode } from "react";
import { ClipboardCheck, CircleCheck, TriangleAlert } from "lucide-react";
import { LogFeed, type LogDecisionHandler } from "./logs/log-feed.js";
import type { LogStep } from "./logs/log-feed-model.js";
import { LogTimeline } from "./logs/log-timeline.js";
import { LogActionButton, LogHeaderCompact } from "./logs/log-action-button.js";
import { runHeaderAction } from "./run-header-model.js";
import type { LogTimelineStage } from "./logs/log-timeline-model.js";

const headerIcon = (label: string) => label === "Review" ? <ClipboardCheck aria-hidden className="size-4" /> : label === "View failure" ? <TriangleAlert aria-hidden className="size-4" /> : <CircleCheck aria-hidden className="size-4" />;
/** Below this header width the text buttons collapse to icons. */
const COMPACT_HEADER_WIDTH = 520;

/** One row: the title truncates, the actions stay on the line. */
function LogHeader({ title, children }: { title: string; children: ReactNode }) {
  const row = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const node = row.current;
    if (node === null) return;
    const observer = new ResizeObserver(([entry]) => setCompact(entry.contentRect.width < COMPACT_HEADER_WIDTH));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return <header className="shrink-0 border-b border-ui-stroke bg-ui-table px-4 py-3">
    <div ref={row} className="flex min-h-6 min-w-0 items-center gap-3"><h2 className="m-0 min-w-0 truncate text-heading" title={title}>{title}</h2>
      <LogHeaderCompact.Provider value={compact}><span className="ml-auto flex shrink-0 items-center gap-2">{children}</span></LogHeaderCompact.Provider>
    </div>
  </header>;
}

/** The production log layout accepts presentation data and has no transport dependency. */
export const LogPanel = memo(function LogPanel({ title, steps, timeline, toolbar, onDecision, onCancelRun, onReview, initialStepId, navigation, content, afterStep, footerActions }: {
  onDecision?: LogDecisionHandler;
  onCancelRun?: () => void;
  onReview?: () => void;
  title: string; steps: readonly LogStep[]; timeline: readonly LogTimelineStage[]; toolbar?: ReactNode; initialStepId?: string;
  footerActions?: ReactNode; navigation?: ReactNode; content?: ReactNode; afterStep?: (id: string) => ReactNode;
}) {
  const action = runHeaderAction(steps, timeline);
  const header = (jump?: (stepId: string, entryId?: string) => void) => <LogHeader title={title}>
    {action && jump && <LogActionButton label={action.label} variant={action.label === 'Review' ? 'primary' : undefined} icon={headerIcon(action.label)} onClick={() => action.label === 'Review' && onReview ? onReview() : jump(action.stepId, action.entryId)} />}{toolbar}
  </LogHeader>;
  return <section aria-label="Selected run logs" className="ui-theme-scope flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-ui-stroke bg-ui-panel font-ui text-ui-primary [--ds-control-bg:var(--ui-table)] [--ds-control-fg:var(--ui-primary)] [--ds-control-bg-hover:var(--ui-hover)] [--ds-border-strong:var(--ui-stroke-control)] [--ds-focus-ring:var(--ui-info)]">
    {content ? <>{header()}{navigation}{content}{footerActions && <footer className="flex shrink-0 items-center justify-end gap-1 border-t border-ui-stroke bg-ui-panel px-3 py-2">{footerActions}</footer>}</> : <LogFeed steps={steps} afterStep={afterStep} footerActions={footerActions} initialStepId={initialStepId} onDecision={onDecision} onCancelRun={onCancelRun}
      navigation={jump => <>{header(jump)}{navigation}<LogTimeline stages={timeline} onJump={jump} /></>} />}
  </section>;
});
