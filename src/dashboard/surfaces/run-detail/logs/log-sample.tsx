import type { DryRunPreviewStage } from "./dry-run-preview-model.js";
import { useCallback, useMemo, useState } from "react";
import { ListChecks, RotateCcw } from "lucide-react";
import { LogActionButton } from "./log-action-button.js";
import type { DelegatedRecordRef } from "../../../../models/workflow/delegated-record.js";
import { createErrorCatalogFailure, formatErrorCatalogFailure } from "../../../../models/failures/error-catalog.js";
import type { WorkflowSource } from "../../../app/workflow-sources.js";
import { Badge, Button, IconButton, Notice } from "../../../ds/ui.js";
import type { DashboardActionHandler } from "../../shared/actions/actions.js";
import { StatusBadge } from "../../shared/status/status.js";
import { dsStatusOf } from "../../shared/status/status-model.js";
import { LogPanel } from "../log-panel.js";
import type { LogDecisionHandler } from "./log-feed.js";
import { IsoInstantSchema } from "../../../../rules/identity/ids.js";
import { answeredRow, type LogDecision } from "./log-decision-model.js";
import type { LogStep } from "./log-feed-model.js";
import { decisionScenarios, previewScenarios } from "./log-fixture.js";
import { selectedLogPresentation, selectedLogSample, type LogSelection } from "./log-selection-model.js";
import { continuedLookupTimeline } from "./log-selected-fixture.js";
import { pauseTimeline, type LogTimelineStage } from "./log-timeline-model.js";
import { useDashboardClient, useDashboardCommandBinding } from "../../../state/client-context.js";
import { projectRunLogs, useRunWiring, type RunWiringConfirm } from "../../../state/run-wiring-adapter.js";
import { LogSkeleton } from "../../shared/loading/loading.js";
import { queueRunHeader } from "../run-header-model.js";
import { queueRowTitle } from "../../queue/queue-model.js";
import { RunReview } from "../review/review.js";
import { UcpathFoundTransactions } from "./log-decision.js";
import { batchMemberRetryAction } from "../../../app/commands/command-dispatch.js";

type ServedNavigation = Readonly<{ reviewOpen?: boolean; reviewFocus?: DelegatedRecordRef; onReview?: () => void; onLogs?: () => void; onAction?: DashboardActionHandler }>;

export function LogSample({ selection, nowIso, source = "served", initialStepId, confirm, ...navigation }: { selection?: LogSelection; nowIso?: string; source?: WorkflowSource; initialStepId?: string; confirm?: RunWiringConfirm } & ServedNavigation) {
  if (source === "served" && selection !== undefined) return <ServedLogSample selection={selection} nowIso={nowIso} initialStepId={initialStepId} confirm={confirm} {...navigation} />;
  return <PreviewLogSample selection={selection} nowIso={nowIso} />;
}

function ServedLogSample({ selection, nowIso, initialStepId, confirm, reviewOpen, reviewFocus, onReview, onLogs, onAction }: { selection: LogSelection; nowIso?: string; initialStepId?: string; confirm?: RunWiringConfirm } & ServedNavigation) {
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
  const cancelRun = cancel !== undefined && onAction !== undefined ? () => onAction(cancel, target) : undefined;
  // A run control sends the queue row's own descriptor; every other option goes through the served-decision dispatch.
  const decide = useCallback<LogDecisionHandler>((id, option, answer) => {
    if (option.send.via !== "row-action") { resource.onDecision?.(id, option, answer); return; }
    const key = option.send.actionKey;
    const action = selection.row.actions.find(candidate => candidate.key === key);
    if (action !== undefined) onAction?.(action, target);
  }, [resource, selection.row.actions, onAction, target]);
  const feedback = useMemo(() => resource.command ? <><Badge tone="neutral">{resource.command.state === "pending" ? "Pending" : resource.command.feedback}</Badge>{resource.replay && <Button size="sm" onClick={resource.replay}>Replay exact decision</Button>}</> : resource.state === "failed" && resource.snapshot !== undefined ? <Notice tone="danger" title={logsReadFailedTitle} description={resource.error} /> : resource.state === "loading" && resource.snapshot ? <Badge tone="neutral">Refreshing</Badge> : <>{resource.snapshot?.unavailableEvidence.map(message => <Badge key={message} tone="neutral">{message}</Badge>)}</>, [resource.command, resource.replay, resource.state, resource.snapshot, resource.error, logsReadFailedTitle]);
  const content = useMemo(() => failureMissing ? <Notice sticky tone="danger" title={logsUnavailableTitle} description={formatErrorCatalogFailure(createErrorCatalogFailure("NOTIFICATION_TARGET_UNAVAILABLE", {})).text} /> : resource.snapshot === undefined ? resource.state === "loading" ? <LogSkeleton /> : resource.state === "failed" ? <Notice tone="danger" title={logsUnavailableTitle} description={resource.error} /> : undefined : undefined, [failureMissing, logsUnavailableTitle, resource.snapshot, resource.state, resource.error]);
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
  const toolbar = useMemo(() => <>{resource.snapshot?.detail.ocrReviewChanges !== undefined && <Notice sticky tone="warning" title="Earlier review changes no longer apply" description="Review the new values." />}{resource.snapshot?.detail.childRetry !== undefined && <IconButton size="md" label={resource.snapshot.detail.childRetry.label}
    icon={<RotateCcw aria-hidden className="size-4" />} disabled={resource.onChildRetry === undefined} onClick={resource.onChildRetry} />}{reviewAvailable && resource.snapshot?.detail.ocrRecordCount !== undefined && onReview !== undefined && <LogActionButton label={`Records ${resource.snapshot.detail.ocrRecordCount}`} variant={reviewOpen ? "secondary" : "outline"} aria-pressed={Boolean(reviewOpen)} icon={<ListChecks aria-hidden className="size-4" />} onClick={reviewOpen ? onLogs : onReview} />}
      {batchRetry !== undefined && <IconButton size="md" label={batchRetry.label} icon={<RotateCcw aria-hidden className="size-4" />} disabled={resource.onBatchMemberRetry === undefined} onClick={resource.onBatchMemberRetry} />}
      {retry !== undefined && onAction !== undefined && <IconButton size="md" label={retry.label} icon={<RotateCcw aria-hidden className="size-4" />} disabled={!retryEnabled} onClick={retryRun} />}{feedback}</>, [resource.snapshot,resource.onChildRetry,resource.onBatchMemberRetry,batchRetry,reviewOpen,onLogs,reviewAvailable,onReview,retry,onAction,retryEnabled,retryRun,feedback]);
  return <LogPanel initialStepId={resource.snapshot !== undefined && !failureMissing ? initialStepId : undefined} title={resource.snapshot?.detail.header.title ?? queueRowTitle(selection.row)} steps={projection.steps} timeline={projection.timeline} onDecision={resource.onDecision === undefined ? undefined : decide} onCancelRun={cancelRun}
    onReview={reviewAvailable ? onReview : undefined}
    context={queueRunHeader(selection.row, selection.workflowLabel, nowIso ?? selection.row.updatedAt)}
    status={<StatusBadge status={dsStatusOf(selection.row.status)} pauseControl={selection.row.pauseControl} interrupt={selection.row.interrupt} presentation="queue" />}
    toolbar={toolbar}
    content={reviewOpen ? <RunReview selection={selection} focus={reviewFocus} /> : content}
    afterStep={afterStep} />;
}

function PreviewLogSample({ selection, nowIso }: { selection?: LogSelection; nowIso?: string }) {
  const scenarioId = new URLSearchParams(typeof window === "undefined" ? "" : window.location.search).get("logPreview") ?? (selection ? "preview" : "separation");
  const [edited, setEdited] = useState<{ basis: string; steps: readonly LogStep[]; timeline: readonly LogTimelineStage[] }>();
  const scenarios = [...previewScenarios, ...decisionScenarios];
  const row = selection?.row, workflowLabel = selection?.workflowLabel;
  const selected = useMemo(() => row && workflowLabel !== undefined ? selectedLogPresentation({ row, workflowLabel }) : undefined, [row, workflowLabel]);
  const preview = useMemo(() => row && workflowLabel !== undefined ? selectedLogSample({ row, workflowLabel }) : undefined, [row, workflowLabel]);
  const scenario = scenarioId === "preview" && preview ? preview : scenarioId === "selected" && selected
    ? { ...selected, id: "selected", label: "Queue facts", subject: "" } : scenarios.find(item => item.id === scenarioId);
  if (!scenario) throw new Error("log-sample-scenario-missing");
  const basis = scenarioId === "preview" && selection ? `${scenarioId}:${selection.row.updatedAt}:${selection.row.status}` : scenarioId;
  const steps = edited?.basis === basis ? edited.steps : scenario.steps;
  const timeline = edited?.basis === basis ? edited.timeline : scenario.timeline;
  // A fixture has no server: answering records a preview answer on the decision, and the lookup preview continues past its approval.
  const decide: LogDecisionHandler = (id, option, answer) => {
    const label = answeredRow(option, answer)?.name ?? option.label;
    setEdited(current => {
      const nextSteps = (current?.basis === basis ? current.steps : scenario.steps).map(step => ({ ...step, entries: step.entries.map(entry => entry.id !== id || entry.kind !== "decision" ? entry
        : { ...entry, decision: { ...withoutServed(entry.decision), answered: { optionId: option.id, label, at: PREVIEW_ANSWERED_AT, actor: { kind: "person" as const, name: "Alex Rivera" } } } }) }));
      if (scenarioId === "preview" && option.id === "approve-lookup-match" && !nextSteps.some(step => step.id === "lookup-job")) {
        nextSteps.push({ id: "lookup-job", time: "09:40:20", title: "Read employment record", system: "UCPath", entries: [{ kind: "note", id: "lookup-job-started", time: "09:40:20", message: `Reading the employment record for ${preview?.subject}.`, tone: "info" }] });
      }
      return { basis, timeline: scenarioId === "preview" ? continuedLookupTimeline(current?.basis === basis ? current.timeline : scenario.timeline, option.id) : scenario.timeline, steps: nextSteps };
    });
  };
  return <LogPanel key={basis} context={selection && (scenarioId === 'preview' || scenarioId === 'selected') ? queueRunHeader(selection.row, selection.workflowLabel, nowIso ?? selection.row.updatedAt) : undefined} title={scenarioId === "preview" && preview ? preview.subject : scenarioId === "selected" && selected ? selected.title : scenario.subject} status={selection && (scenarioId === "preview" || scenarioId === "selected") ? <StatusBadge status={dsStatusOf(selection.row.status)} presentation="queue" /> : <Badge tone="neutral">{scenario.status}</Badge>} steps={steps} timeline={timeline} initialStepId={scenarioId === "preview" ? preview?.initialStepId : undefined} onDecision={scenarioId === "selected" ? undefined : decide} onCancelRun={scenarioId === "selected" ? undefined : previewCancel} />;
}

/** A fixture has no clock; the preview answer carries a fixed instant. */
const PREVIEW_ANSWERED_AT = IsoInstantSchema.parse("2026-08-03T16:41:05.000Z");

/** A fixture has no run to cancel; the button shows and does nothing. */
const previewCancel = () => undefined;

const withoutServed = ({ served: _served, ...rest }: LogDecision): LogDecision => rest;

export function FullDryRunPreview({ stages, facts }: { stages: readonly DryRunPreviewStage[]; facts: readonly { label: string; value: string; sample?: boolean }[] }) {
  const applicable = stages.filter(stage => stage.state !== "skipped");
  const exercised = applicable.filter(stage => stage.state === "exercised" || stage.state === "not-clicked").length;
  return <section aria-label="Full dry-run preview" className="log-decision dry-run-result">
    <header className="log-decision-header"><h4>Dry run result</h4><span className="text-caption text-ui-muted">{exercised} of {applicable.length} steps exercised</span></header>
    <dl className="m-0 divide-y divide-ui-stroke">{facts.map(fact => <div key={fact.label} role="group" aria-label={fact.label} className="flex items-center justify-between gap-4 px-3.5 py-2.5 text-body"><dt>{fact.label}</dt><dd className="m-0 flex min-w-0 items-center gap-2 text-ui-muted"><span className="font-data">{fact.value}</span>{fact.sample && <Badge tone="neutral" aria-label="Dry-run sample" className="border-dashed bg-transparent text-ui-info">Sample</Badge>}</dd></div>)}{stages.filter(stage => stage.state !== "exercised").map(stage => <div key={stage.id} role="group" aria-label={stage.label} className="flex items-center justify-between gap-4 px-3.5 py-2.5 text-body"><dt>{stage.label}<span className="block text-caption text-ui-muted">{stage.detail}</span></dt><dd className="m-0"><Badge tone={stage.state === "unavailable" ? "warning" : "neutral"}>{stage.state === "not-clicked" ? "Not clicked" : stage.state === "unavailable" ? "Unavailable" : "Skipped"}</Badge></dd></div>)}</dl>
  </section>;
}
