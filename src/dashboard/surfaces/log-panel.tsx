import { memo, type ReactNode } from "react";
import type { LogDecisionAction, LogDecisionAnswer } from "./log-decision-model.js";
import { LogFeed } from "./log-feed.js";
import type { LogStep } from "./log-feed-model.js";
import { LogTimeline } from "./logs/log-timeline.js";
import type { LogTimelineStage } from "./logs/log-timeline-model.js";

/** The production log layout accepts presentation data and has no transport dependency. */
export const LogPanel = memo(function LogPanel({ title, steps, timeline, status, toolbar, onDecision, initialStepId, navigation, content }: {
  onDecision?: (id: string, action: LogDecisionAction, answer: LogDecisionAnswer) => void;
  title: string; steps: readonly LogStep[]; timeline: readonly LogTimelineStage[]; status?: ReactNode; toolbar?: ReactNode; initialStepId?: string;
  navigation?: ReactNode; content?: ReactNode;
}) {
  return <section aria-label="Selected run logs" className="ui-theme-scope flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-ui-stroke bg-ui-panel font-ui text-ui-primary [--ds-control-bg:var(--ui-table)] [--ds-control-fg:var(--ui-primary)] [--ds-control-bg-hover:var(--ui-hover)] [--ds-border-strong:var(--ui-stroke-control)] [--ds-focus-ring:var(--ui-info)]">
    <header className="flex min-h-12 shrink-0 flex-wrap items-center gap-3 border-b border-ui-stroke bg-ui-table px-4 py-3"><h2 className="m-0 min-w-0 text-heading text-balance">{title}</h2>{status}<span className="ml-auto">{toolbar}</span></header>
    {navigation}
    {content ?? <LogFeed steps={steps} initialStepId={initialStepId} onDecision={onDecision} navigation={jump => <LogTimeline stages={timeline} onJump={jump} />} />}
  </section>;
});
