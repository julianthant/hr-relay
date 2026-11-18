import type { DryRunPreviewStage } from "./dry-run-preview-model.js";
import { useCallback, useMemo } from "react";
import { ListChecks, RotateCcw, RotateCw } from "lucide-react";
import { LogFooterButton } from "./log-action-button.js";
import { MemberRunControls } from "./log-member-controls.js";
import type { DelegatedRecordRef } from "../../../../models/workflow/delegated-record.js";
import { createErrorCatalogFailure, formatErrorCatalogFailure } from "../../../../models/failures/error-catalog.js";
import { Badge, Banner, Button, FailureNotice, IconButton, Notice } from "../../../ds/ui.js";
import type { DashboardActionHandler } from "../../shared/actions/actions.js";
import { LogPanel } from "../log-panel.js";
import { linkedRunEntries } from "../linked-runs-model.js";
import type { LinkedRunWire } from "../../queue/queue-model.js";
import type { LogDecisionHandler } from "./log-feed.js";
import { isCancelOption } from "./log-decision-model.js";
import type { ActionDescriptorWire } from "../../../../models/dashboard/actions.js";
import { rerunFooterAction, type LogSelection } from "./log-selection-model.js";
import { pauseTimeline } from "./log-timeline-model.js";
import { useDashboardClient, useDashboardCommandBinding } from "../../../state/client-context.js";
import { projectRunLogs, useRunWiring, type RunWiringConfirm } from "../../../state/run-wiring-adapter.js";
import { LogFeedPadding, LogSkeleton, LogTimelineSkeleton } from "../../shared/loading/loading.js";
import { RunStateChips } from "../run-state-chips.js";
import { isNeedsDuo, queueRowTitle } from "../../queue/queue-model.js";
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

export function LogSample({ selection, initialStepId, confirm, ...navigation }: { selection: LogSelection; initialStepId?: string; confirm?: RunWiringConfirm } & ServedNavigation) {
  return <ServedLogSample selection={selection} initialStepId={initialStepId} confirm={confirm} {...navigation} />;
}

function ServedLogSample({ selection, initialStepId, confirm, reviewOpen, reviewFocus, onReview, onLogs, onAction, onOpenLinked, onRetryLogs }: { selection: LogSelection; initialStepId?: string; confirm?: RunWiringConfirm } & ServedNavigation) {
  const client = useDashboardClient();
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
    if (action !== undefined) onAction?.(isCancelOption(option) ? withoutConfirm(action) : action, target);
  }, [resource, selection.row.actions, onAction, target]);
  const feedback = useMemo(() => resource.command ? <><Badge tone="neutral">{resource.command.state === "pending" ? "Pending" : resource.command.feedback}</Badge>{resource.replay && <Button size="sm" onClick={resource.replay}>Replay exact decision</Button>}</> : resource.state === "failed" && resource.snapshot !== undefined ? <Notice tone="danger" title={logsReadFailedTitle} description="Relay could not refresh these logs." /> : resource.state === "loading" && resource.snapshot ? <Badge tone="neutral">Refreshing</Badge> : <>{resource.snapshot?.unavailableEvidence.map(message => <Badge key={message} tone="neutral">{message}</Badge>)}</>, [resource.command, resource.replay, resource.state, resource.snapshot, logsReadFailedTitle]);
  const content = useMemo(() => failureMissing ? <Notice sticky tone="danger" title={logsUnavailableTitle} description={formatErrorCatalogFailure(createErrorCatalogFailure("NOTIFICATION_TARGET_UNAVAILABLE", {})).text} /> : resource.snapshot === undefined ? resource.state === "loading" ? <LogFeedPadding><LogSkeleton /></LogFeedPadding> : resource.state === "failed" ? <div className="p-4"><FailureNotice sentence="Relay could not load this run's logs." stillWorks="The queue and the other runs still work."
    action={onRetryLogs === undefined ? undefined : { label: "Retry", onClick: onRetryLogs }} /></div> : undefined : undefined, [failureMissing, logsUnavailableTitle, resource.snapshot, resource.state, onRetryLogs]);
  const afterStep = useCallback((id: string) => {
    const findings = projection.ucpathFindings;
    const showFindings = findings?.stepId === id;
    const showPreview = id === lastStepId && (preview?.state === "available" || preview?.state === "unavailable");
    if (!showFindings && !showPreview) return undefined;
    return <>{showFindings && findings !== undefined ? <UcpathFoundTransactions key={`${selection.row.runId}:${findings.stepId}`} attemptLabel={findings.attemptLabel}
      presentation={resource.command?.state === "pending" ? { state: "checking" } : findings.presentation}
      onDecision={resource.onUcpathDecision} /> : undefined}
      {showPreview ? <div className="col-start-2 mt-4 min-w-0">{preview?.state === "available" ? <FullDryRunPreview
        stages={preview.stages.map(stage => ({ ...stage, state: stage.submitNotClicked ? "not-clicked" : stage.state }))}
        facts={preview.stages.flatMap(stage => stage.sample === undefined ? [] : [{ label: stage.label, value: stage.sample.value, sample: true }])} />
        : preview?.state === "unavailable" ? <Notice tone="warning" title="Dry-run preview unavailable" description={preview.reason === "preview-not-completed" ? "The dry run did not complete." : preview.reason === "preview-result-unreadable" ? "The result could not be read." : "Preview is unavailable."} /> : undefined}</div> : undefined}</>;
  }, [projection.ucpathFindings, selection.row.runId, resource.command?.state, resource.onUcpathDecision, lastStepId, preview]);
  const retryRun = useCallback(() => {
    if (retry !== undefined) onAction?.(retry, { runId: selection.row.runId, expectedVersion: selection.row.rowRevision });
  }, [retry,onAction,selection.row.runId,selection.row.rowRevision]);
  const linkedRuns = useMemo(() => linkedRunEntries(selection.row), [selection.row]);
  const recordCount = resource.snapshot?.detail.ocrRecordCount;
  const rerun = useMemo(() => {
    const action = rerunFooterAction(selection, onAction);
    return action === undefined ? undefined : <LogFooterButton label={action.label} icon={<RotateCw aria-hidden className="size-4" />} onClick={action.run} />;
  }, [selection, onAction]);
  const footerActions = useMemo(() => {
    const records = reviewAvailable && recordCount !== undefined && onReview !== undefined;
    const members = selection.row.parent !== null && selection.row.status === "running";
    if (!records && rerun === undefined && !members) return undefined;
    return <><MemberRunControls selection={selection} onAction={onAction} />{records && <LogFooterButton label={`Records ${recordCount}`} count={recordCount} pressed={Boolean(reviewOpen)} icon={<ListChecks aria-hidden className="size-4" />} onClick={onReview} />}{rerun}</>;
  }, [reviewAvailable, recordCount, onReview, reviewOpen, rerun, selection, onAction]);
  const status = useMemo(() => <RunStateChips row={selection.row} />, [selection.row]);
  const toolbar = useMemo(() => <>{resource.snapshot?.detail.ocrReviewChanges !== undefined && <Notice sticky tone="warning" title="Earlier review changes no longer apply" description="Review the new values." />}{resource.snapshot?.detail.childRetry !== undefined && <IconButton size="md" label={resource.snapshot.detail.childRetry.label}
    icon={<RotateCcw aria-hidden className="size-4" />} disabled={resource.onChildRetry === undefined} onClick={resource.onChildRetry} />}
      {batchRetry !== undefined && <IconButton size="md" label={batchRetry.label} icon={<RotateCcw aria-hidden className="size-4" />} disabled={resource.onBatchMemberRetry === undefined} onClick={resource.onBatchMemberRetry} />}
      {retry !== undefined && onAction !== undefined && <IconButton size="md" label={retry.label} icon={<RotateCcw aria-hidden className="size-4" />} disabled={!retryEnabled} onClick={retryRun} />}{feedback}</>, [resource.snapshot,resource.onChildRetry,resource.onBatchMemberRetry,batchRetry,retry,onAction,retryEnabled,retryRun,feedback]);
  return <><LogPanel initialStepId={resource.snapshot !== undefined && !failureMissing ? initialStepId : undefined} title={resource.snapshot?.detail.header.title ?? queueRowTitle(selection.row)} steps={projection.steps} timeline={projection.timeline} onDecision={resource.onDecision === undefined ? undefined : decide} onCancelRun={cancelRun}
    status={status} navigation={resource.snapshot === undefined && resource.state === "loading" ? <LogTimelineSkeleton /> : isNeedsDuo(selection.row) ? <div className="px-3 py-2"><Banner tone="info" title="Approve the Duo sign-in"><span>Open Duo on your phone and approve the sign-in. The run continues once you do.</span></Banner></div> : undefined}
    onReview={reviewAvailable ? onReview : undefined}
    toolbar={toolbar} linkedRuns={linkedRuns} onOpenLinkedRun={onOpenLinked} footerActions={footerActions}
    content={content}
    afterStep={afterStep} />
    {reviewAvailable && <ReviewDialog open={Boolean(reviewOpen)} onOpenChange={open => { if (!open) onLogs?.(); }} subject={selection.row.title}><RunReview selection={selection} focus={reviewFocus} /></ReviewDialog>}</>;
}

export function FullDryRunPreview({ stages, facts }: { stages: readonly DryRunPreviewStage[]; facts: readonly { label: string; value: string; sample?: boolean }[] }) {
  const applicable = stages.filter(stage => stage.state !== "skipped");
  const exercised = applicable.filter(stage => stage.state === "exercised" || stage.state === "not-clicked").length;
  return <section aria-label="Full dry-run preview" className="log-decision dry-run-result">
    <header className="log-decision-header"><h4>Dry run result</h4><span className="text-caption text-ui-muted">{exercised} of {applicable.length} steps exercised</span></header>
    <dl className="m-0 divide-y divide-ui-stroke">{facts.map(fact => <div key={fact.label} role="group" aria-label={fact.label} className="flex items-center justify-between gap-4 px-3.5 py-2.5 text-body"><dt>{fact.label}</dt><dd className="m-0 flex min-w-0 items-center gap-2 text-ui-muted"><span className="font-data">{fact.value}</span>{fact.sample && <Badge tone="neutral" aria-label="Dry-run sample" className="border-dashed bg-transparent text-ui-info">Sample</Badge>}</dd></div>)}{stages.filter(stage => stage.state !== "exercised").map(stage => <div key={stage.id} role="group" aria-label={stage.label} className="flex items-center justify-between gap-4 px-3.5 py-2.5 text-body"><dt>{stage.label}<span className="block text-caption text-ui-muted">{stage.detail}</span></dt><dd className="m-0"><Badge tone={stage.state === "unavailable" ? "warning" : "neutral"}>{stage.state === "not-clicked" ? "Not clicked" : stage.state === "unavailable" ? "Unavailable" : "Skipped"}</Badge></dd></div>)}</dl>
  </section>;
}
