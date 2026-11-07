import { memo, type ReactNode } from "react";
import type { LogDecisionAction, LogDecisionAnswer } from "./logs/log-decision-model.js";
import { LogFeed } from "./logs/log-feed.js";
import type { LogStep } from "./logs/log-feed-model.js";
import { LogTimeline } from "./logs/log-timeline.js";
import { decisionMock, type MockState } from "./decision-mock/decision-mock-model.js";
import { DecisionMockFeed } from "./decision-mock/decision-mock-logs.js";
import { StatusBadge } from "../shared/status/status.js";
import { Button, IconButton } from "../../ds/ui.js";
import { RenameableTitle } from "../shared/rename/renameable-title.js";
import { renameMockRun, useMockRunNames } from "../workflows/mocks/mock-run-names.js";
import { mockQueueId } from "../workflows/mocks/workflow-queue-model.js";
import { RotateCcw } from "lucide-react";
import { runHeaderAction, type RunHeaderContext } from "./run-header-model.js";
import type { LogTimelineStage } from "./logs/log-timeline-model.js";

const MOCK_BADGE: Readonly<Record<MockState, { status: "waiting" | "parked" | "failed" | "queued" | "cancelling"; label?: string }>> = {
  review: { status: "waiting" }, parked: { status: "parked" }, failed: { status: "failed" }, paused: { status: "queued", label: "Paused" }, stalled: { status: "failed", label: "Stalled" }, cancelling: { status: "cancelling" },
};

/** The production log layout accepts presentation data and has no transport dependency. */
export const LogPanel = memo(function LogPanel({ title, steps, timeline, status, toolbar, onDecision, onReview, initialStepId, navigation, content, context, afterStep, onRenameTitle }: {
  onDecision?: (id: string, action: LogDecisionAction, answer: LogDecisionAnswer) => void;
  /** Double-click renames the run in place; the queue row shares the name. Offered only when a host supplies it. */
  onRenameTitle?: (name: string) => void;
  onReview?: () => void;
  title: string; steps: readonly LogStep[]; timeline: readonly LogTimelineStage[]; status?: ReactNode; toolbar?: ReactNode; initialStepId?: string;
  navigation?: ReactNode; content?: ReactNode; context?: RunHeaderContext; afterStep?: (id: string) => ReactNode;
}) {
  const mock = decisionMock();
  const names = useMockRunNames();
  let rename: ((name: string) => void) | undefined = onRenameTitle;
  if (mock?.scene) {
    const data = mock.scene;
    const runId = mockQueueId(`mock:${data.workflow}:sample`);
    title = names.get(runId) ?? data.subject;
    rename = name => renameMockRun(runId, name);
    status = <StatusBadge {...MOCK_BADGE[data.state]} presentation="queue" />;
    toolbar = data.headerRetry ? <IconButton label={data.headerRetry} icon={<RotateCcw aria-hidden className="size-3.5" />} /> : undefined;
    navigation = <LogTimeline stages={data.timeline} onJump={() => undefined} />;
    content = <DecisionMockFeed data={data} />;
  }
  const action = runHeaderAction(steps, timeline);
  const header = (jump?: (stepId: string, entryId?: string) => void) => <header className="shrink-0 border-b border-ui-stroke bg-ui-table px-4 py-3">
    <div className="flex min-h-6 min-w-0 flex-wrap items-center gap-3"><RenameableTitle heading name={title} {...(rename === undefined ? {} : { onRename: rename })} inputClassName="text-section" className={`m-0 min-w-0 ${mock ? "text-section" : "text-heading"} text-balance`} />{context?.reviewPending && action?.label === 'Review' && jump ? undefined : status}
      <span className="ml-auto flex flex-wrap items-center gap-2">{action && jump && <Button size="sm" onClick={() => action.label === 'Review' && onReview ? onReview() : jump(action.stepId, action.entryId)}>{action.label}</Button>}{toolbar}</span>
    </div>
  </header>;
  return <section aria-label="Selected run logs" className="ui-theme-scope flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-ui-stroke bg-ui-panel font-ui text-ui-primary [--ds-control-bg:var(--ui-table)] [--ds-control-fg:var(--ui-primary)] [--ds-control-bg-hover:var(--ui-hover)] [--ds-border-strong:var(--ui-stroke-control)] [--ds-focus-ring:var(--ui-info)]">
    {content ? <>{header()}{navigation}{content}</> : <LogFeed steps={steps} afterStep={afterStep} initialStepId={initialStepId} onDecision={onDecision}
      navigation={jump => <>{header(jump)}{navigation}<LogTimeline stages={timeline} onJump={jump} /></>} />}
  </section>;
});
