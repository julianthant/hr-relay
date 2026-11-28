import type { DryRunPreviewStage } from "./dry-run-preview-model.js";
import { useCallback, useMemo } from "react";
import { ArrowLeft, RotateCcw } from "lucide-react";
import { LogActionButton } from "./log-action-button.js";
import { MemberRunControls } from "./log-member-controls.js";
import type { DelegatedRecordRef } from "../../../../models/workflow/delegated-record.js";
import { createErrorCatalogFailure, formatErrorCatalogFailure } from "../../../../models/failures/error-catalog.js";
import { WorkerSetupRefusalCodeSchema } from "../../../../models/run/worker-control.js";
import { Badge, Banner, Button, Card, FailureNotice, IconButton, Notice } from "../../../ds/ui.js";
import type { DashboardActionHandler } from "../../shared/actions/actions.js";
import { LogPanel } from "../log-panel.js";
import { linkedRunEntries } from "../linked-runs-model.js";
import type { LinkedRunWire } from "../../queue/queue-model.js";
import type { LogDecisionHandler } from "./log-feed.js";
import { isCancelOption } from "./log-decision-model.js";
import type { ActionDescriptorWire } from "../../../../models/dashboard/actions.js";
import { rerunAction, type LogSelection } from "./log-selection-model.js";
import { pauseTimeline } from "./log-timeline-model.js";
import { useDashboardClient, useDashboardCommandBinding } from "../../../state/client-context.js";
import { projectRunLogs, useRunWiring, type RunWiringConfirm } from "../../../state/run-wiring-adapter.js";
import { LogFeedPadding, LogSkeleton } from "../../shared/loading/loading.js";
import { RunStateChips, StartedByLine } from "../run-state-chips.js";
import { queueRowTitle, type QueueSurfaceWire } from "../../queue/queue-model.js";
import { SYSTEM_NAME } from "../../shared/status/system-chip-model.js";
import { elapsedSecondsBetween } from "../../shared/status/format.js";
import { formatDuration } from "../../../lib/date-format.js";
import { useServedView } from "../../../state/served-clock.js";
import { RunReview } from "../review/review.js";
import { ReviewDialog } from "../review/review-dialog.js";
import { UcpathFoundTransactions } from "./log-decision.js";
import { batchMemberRetryAction } from "../../../app/commands/command-dispatch.js";

type ServedNavigation = Readonly<{ reviewOpen?: boolean; reviewFocus?: DelegatedRecordRef; onReview?: () => void; onLogs?: () => void; onAction?: DashboardActionHandler; onOpenLinked?: (target: LinkedRunWire) => void; onRetryLogs?: () => void }>;

function withoutConfirm(action: ActionDescriptorWire): ActionDescriptorWire {
  if (action.kind !== "command") return action;
  const { confirm: _confirm, ...direct } = action;
  return direct;
}

/** Status only: fast-duo approves on its own; a failed approval fails the run and the operator reruns it. */
function DuoWaitBanner({ wait, nowIso }: { wait: Extract<QueueSurfaceWire["operatorWait"], { state: "present" }>; nowIso: string }) {
  const elapsed = useServedView(nowIso, now => formatDuration(Math.max(0, elapsedSecondsBetween(wait.since, now))));
  // The banner is a live region: the ticking text is hidden from it so a tick never announces; the same text sits outside it for reading.
  return <div className="px-3 py-2"><Banner tone="info" title={`Approving Duo for ${SYSTEM_NAME[wait.system]}`}><span aria-hidden className="tabular-nums">Waiting {elapsed}</span></Banner>
    <span className="sr-only">Waiting {elapsed}</span></div>;
}

export function LogSample({ selection, initialStepId, confirm, ...navigation }: { selection: LogSelection; initialStepId?: string; confirm?: RunWiringConfirm } & ServedNavigation) {
  return <ServedLogSample selection={selection} initialStepId={initialStepId} confirm={confirm} {...navigation} />;
}

function ServedLogSample({ selection, initialStepId, confirm, reviewOpen, reviewFocus, onReview, onLogs, onAction, onOpenLinked, onRetryLogs }: { selection: LogSelection; initialStepId?: string; confirm?: RunWiringConfirm } & ServedNavigation) {
  const client = useDashboardClient();
  const runId = selection.row.runId;
  const searchNotes = useMemo(() => client.searchRunLogs?.bind(client, runId), [client, runId]);
  const binding = useDashboardCommandBinding();
  const resource = useRunWiring(client, selection, binding, confirm);
  const logsReadFailedTitle = formatErrorCatalogFailure(createErrorCatalogFailure("LOGS_READ_FAILED_TITLE", {})).text;
  const logsUnavailableTitle = formatErrorCatalogFailure(createErrorCatalogFailure("LOGS_UNAVAILABLE_TITLE", {})).text;
  const projection = useMemo<ReturnType<typeof projectRunLogs>>(() => {
    if (resource.snapshot === undefined) return { steps: [], timeline: [] };
    const logs = projectRunLogs(resource.snapshot, client);
    return { ...logs, timeline: pauseTimeline(logs.timeline, selection.row.pauseControl?.state, selection.row.interrupt) };
  }, [resource.snapshot, client, selection.row.pauseControl?.state, selection.row.interrupt]);
  const failureMissing = resource.snapshot !== undefined && initialStepId !== undefined && !projection.steps.some(step => step.id === initialStepId);
  const preview = resource.snapshot?.logs.dryRunPreview;
  const lastStepId = projection.steps.at(-1)?.id;
  const previewRegion = useMemo(() => preview?.state === "available" ? <FullDryRunPreview
    stages={preview.stages.map(stage => ({ ...stage, state: stage.submitNotClicked ? "not-clicked" : stage.state }))}
    facts={preview.stages.flatMap(stage => stage.sample === undefined ? [] : [{ label: stage.label, value: stage.sample.value, sample: true }])} />
    // A failed or cancelled run says so in its logs; only a completed dry run's unreadable preview needs a line here.
    : preview?.state === "unavailable" && preview.reason !== "preview-not-completed" ? <Banner tone="warning" title="Dry-run preview unavailable">{preview.reason === "preview-result-unreadable" ? "The result could not be read." : "Preview is unavailable."}</Banner> : undefined, [preview]);
  const emptyPreview = lastStepId === undefined && previewRegion !== undefined ? <div className="mt-4 min-w-0">{previewRegion}</div> : undefined;
  const reviewAvailable = resource.snapshot?.detail.availableSections.includes("review") === true;
  const batchRetry = batchMemberRetryAction(selection.row);
  const retry = selection.row.parent === null || resource.snapshot?.detail.childRetry !== undefined ? undefined : selection.row.actions.find(action => action.kind === "command" && action.command === "retry");
  const retryEnabled = resource.state === "loaded" && binding?.authority.dayState.day.state === "loaded"
    && (resource.command === undefined || resource.command.state === "refused") && onAction !== undefined;
  const target = useMemo(() => ({ runId: selection.row.runId, expectedVersion: selection.row.rowRevision }), [selection.row.runId, selection.row.rowRevision]);
  const cancel = selection.row.actions.find(action => action.kind === "command" && action.command === "cancel");
  // A decision card's Cancel run is the operator's answer: it sends the row's cancel at once; the queue card keeps its confirm.
  const cancelRun = cancel !== undefined && onAction !== undefined ? () => onAction(withoutConfirm(cancel), target) : undefined;
  // A run control sends the queue row's own descriptor; every other option goes through the served-decision dispatch.
  const decide = useCallback<LogDecisionHandler>((id, option, answer) => {
    if (option.send.via !== "row-action") { resource.onDecision?.(id, option, answer); return; }
    const key = option.send.actionKey;
    const action = selection.row.actions.find(candidate => candidate.key === key);
    if (action !== undefined) void onAction?.(isCancelOption(option) ? withoutConfirm(action) : action, target);
  }, [resource, selection.row.actions, onAction, target]);
  const feedback = useMemo(() => resource.command ? <><Badge tone="neutral">{resource.command.state === "pending" ? "Pending" : resource.command.feedback}</Badge>{resource.replay && <Button size="sm" onClick={resource.replay}>Replay exact decision</Button>}</> : resource.state === "failed" && resource.snapshot !== undefined ? <FailureNotice sentence={`${logsReadFailedTitle}: Relay could not refresh these logs.`} /> : resource.state === "loading" && resource.snapshot ? <Badge tone="neutral">Refreshing</Badge> : <>{resource.snapshot?.unavailableEvidence.map(message => <Badge key={message} tone="neutral">{message}</Badge>)}</>, [resource.command, resource.replay, resource.state, resource.snapshot, logsReadFailedTitle]);
  const content = useMemo(() => failureMissing ? <div className="p-[var(--ds-space-section)]"><FailureNotice sentence={`${logsUnavailableTitle}: this run or step no longer exists.`} /></div> : resource.snapshot === undefined ? resource.state === "loading" ? <LogFeedPadding><LogSkeleton /></LogFeedPadding> : resource.state === "failed" ? <div className="p-[var(--ds-space-section)]"><FailureNotice sentence={resource.retryable === false && resource.error !== undefined ? resource.error : "Couldn't load logs."}
    action={onRetryLogs === undefined || resource.retryable === false ? undefined : { label: "Retry", onClick: onRetryLogs }} /></div> : undefined : undefined, [failureMissing, logsUnavailableTitle, resource.snapshot, resource.state, resource.retryable, resource.error, onRetryLogs]);
  const afterStep = useCallback((id: string) => {
    const findings = projection.ucpathFindings;
    const showFindings = findings?.stepId === id;
    const showPreview = id === lastStepId && previewRegion !== undefined;
    if (!showFindings && !showPreview) return undefined;
    return <>{showFindings && findings !== undefined ? <div className="col-start-2 mt-4 min-w-0"><UcpathFoundTransactions key={`${selection.row.runId}:${findings.stepId}`} attemptLabel={findings.attemptLabel}
      presentation={resource.command?.state === "pending" ? { state: "checking" } : findings.presentation}
      onDecision={resource.onUcpathDecision} /></div> : undefined}
      {showPreview ? <div className="col-start-2 mt-4 min-w-0">{previewRegion}</div> : undefined}</>;
  }, [projection.ucpathFindings, selection.row.runId, resource.command?.state, resource.onUcpathDecision, lastStepId, previewRegion]);
  const retryRun = useCallback(() => {
    if (retry !== undefined) void onAction?.(retry, { runId: selection.row.runId, expectedVersion: selection.row.rowRevision });
  }, [retry,onAction,selection.row.runId,selection.row.rowRevision]);
  const linkedRuns = useMemo(() => linkedRunEntries(selection.row), [selection.row]);
  const recordCount = resource.snapshot?.detail.ocrRecordCount;
  const rerun = useMemo(() => rerunAction(selection, onAction), [selection, onAction]);
  const records = useMemo(() => reviewAvailable && recordCount !== undefined && onReview !== undefined ? { count: recordCount, open: onReview } : undefined, [reviewAvailable, recordCount, onReview]);
  const headerActions = useMemo(() => <MemberRunControls selection={selection} onAction={onAction} />, [selection, onAction]);
  const status = useMemo(() => <RunStateChips row={selection.row} />, [selection.row]);
  const parentRun = selection.row.parent;
  const toolbar = useMemo(() => <>{parentRun !== null && onOpenLinked !== undefined && <LogActionButton variant="ghost" label={`Back to ${parentRun.title}`} aria-label={`Back to ${parentRun.title}`} title={`Back to ${parentRun.title}`} className="max-w-48" icon={<ArrowLeft aria-hidden className="size-4 shrink-0" />} text={<span className="min-w-0 truncate">{parentRun.title}</span>} onClick={() => onOpenLinked(parentRun)} />}{resource.snapshot?.detail.ocrReviewChanges !== undefined && <Notice sticky tone="warning" title="Earlier review changes no longer apply" description="Review the new values." />}{resource.snapshot?.detail.childRetry !== undefined && <IconButton size="md" label={resource.snapshot.detail.childRetry.label}
    icon={<RotateCcw aria-hidden className="size-4" />} disabled={resource.onChildRetry === undefined} onClick={resource.onChildRetry} />}
      {batchRetry !== undefined && <IconButton size="md" label={batchRetry.label} icon={<RotateCcw aria-hidden className="size-4" />} disabled={resource.onBatchMemberRetry === undefined} onClick={resource.onBatchMemberRetry} />}
      {retry !== undefined && onAction !== undefined && <IconButton size="md" label={retry.label} icon={<RotateCcw aria-hidden className="size-4" />} disabled={!retryEnabled} onClick={retryRun} />}{feedback}</>, [parentRun,onOpenLinked,resource.snapshot,resource.onChildRetry,resource.onBatchMemberRetry,batchRetry,retry,onAction,retryEnabled,retryRun,feedback]);
  const startup = selection.row.notStarting;
  const setupProblem = startup !== undefined && WorkerSetupRefusalCodeSchema.safeParse(startup.code).success ? startup.summary : undefined;
  // The Duo wait is a state card: it follows the recorded setup in the feed.
  const duoCard = setupProblem === undefined && selection.row.operatorWait.state === "present" ? <div className="mt-4 min-w-0"><DuoWaitBanner wait={selection.row.operatorWait} nowIso={selection.row.updatedAt} /></div> : undefined;
  return <><LogPanel initialStepId={resource.snapshot !== undefined && !failureMissing ? initialStepId : undefined} title={resource.snapshot?.detail.header.title ?? queueRowTitle(selection.row)} steps={projection.steps} timeline={projection.timeline} onDecision={resource.onDecision === undefined ? undefined : decide} onCancelRun={cancelRun}
    status={status} subtitle={<StartedByLine surface={selection.row} wrap className="mt-0.5" />} navigation={setupProblem !== undefined ? <div className="px-3 py-2"><Banner tone="warning" title={setupProblem} /></div> : undefined}
    onReview={reviewAvailable ? onReview : undefined}
    toolbar={toolbar} linkedRuns={linkedRuns} onOpenLinkedRun={onOpenLinked} headerActions={headerActions} rerun={rerun} records={records}
    content={content} searchNotes={searchNotes}
    afterStep={afterStep} trailingContent={duoCard === undefined ? emptyPreview : <>{emptyPreview}{duoCard}</>} />
    {reviewAvailable && <ReviewDialog open={Boolean(reviewOpen)} onOpenChange={open => { if (!open) onLogs?.(); }} subject={selection.workflowLabel}><RunReview selection={selection} focus={reviewFocus} /></ReviewDialog>}</>;
}

export function FullDryRunPreview({ stages, facts }: { stages: readonly DryRunPreviewStage[]; facts: readonly { label: string; value: string; sample?: boolean }[] }) {
  const applicable = stages.filter(stage => stage.state !== "skipped");
  const exercised = applicable.filter(stage => stage.state === "exercised" || stage.state === "not-clicked").length;
  return <Card role="region" aria-label="Full dry-run preview" className="max-w-[560px] overflow-hidden">
    <header className="flex items-center justify-between gap-3 border-b border-ui-stroke px-4 py-3"><h4 className="m-0 text-control font-medium">Dry run result</h4><span className="text-caption text-ui-muted">{exercised} of {applicable.length} steps exercised</span></header>
    <dl className="m-0 divide-y divide-ui-stroke">{facts.map(fact => <div key={fact.label} role="group" aria-label={fact.label} className="flex items-center justify-between gap-4 px-3.5 py-2.5 text-body"><dt>{fact.label}</dt><dd className="m-0 flex min-w-0 items-center gap-2 text-ui-muted"><span className="tabular-nums">{fact.value}</span>{fact.sample && <Badge tone="neutral" aria-label="Dry-run sample" className="border-dashed bg-transparent text-ui-info">Sample</Badge>}</dd></div>)}{stages.filter(stage => stage.state !== "exercised").map(stage => <div key={stage.id} role="group" aria-label={stage.label} className="flex items-center justify-between gap-4 px-3.5 py-2.5 text-body"><dt>{stage.label}<span className="block text-caption text-ui-muted">{stage.detail}</span></dt><dd className="m-0"><Badge tone={stage.state === "unavailable" ? "warning" : "neutral"}>{stage.state === "not-clicked" ? "Not clicked" : stage.state === "unavailable" ? "Unavailable" : "Skipped"}</Badge></dd></div>)}</dl>
  </Card>;
}
