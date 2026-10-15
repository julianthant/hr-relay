import { useMemo, useState } from "react";
import { createErrorCatalogFailure, formatErrorCatalogFailure } from "../../../../models/failures/error-catalog.js";
import type { WorkflowSource } from "../../../app/workflow-sources.js";
import { Badge, Banner, Button } from "../../../ds/ui.js";
import { StatusBadge } from "../../shared/status/status.js";
import { dsStatusOf } from "../../shared/status/status-model.js";
import { LogPanel } from "../log-panel.js";
import { decisionActionResult, type LogDecisionAction, type LogDecisionAnswer } from "./log-decision-model.js";
import type { LogStep } from "./log-feed-model.js";
import { decisionScenarios, previewScenarios } from "./log-fixture.js";
import { selectedLogPresentation, selectedLogSample, type LogSelection } from "./log-selection-model.js";
import { continuedLookupTimeline } from "./log-selected-fixture.js";
import type { LogTimelineStage } from "./log-timeline-model.js";
import { useDashboardClient, useDashboardCommandBinding } from "../../../state/client-context.js";
import { projectRunLogs, useRunWiring } from "../../../state/run-wiring-adapter.js";
import { LogSkeleton } from "../../shared/loading/loading.js";
import { queueRunHeader } from "../run-header-model.js";

export function LogSample({ selection, nowIso, source = "served", initialStepId }: { selection?: LogSelection; nowIso?: string; source?: WorkflowSource; initialStepId?: string }) {
  const requestedPreview = new URLSearchParams(typeof window === "undefined" ? "" : window.location.search).get("logPreview");
  if (source === "served" && selection !== undefined && requestedPreview === null) return <ServedLogSample selection={selection} nowIso={nowIso} initialStepId={initialStepId} />;
  return <PreviewLogSample selection={selection} nowIso={nowIso} />;
}

function ServedLogSample({ selection, nowIso, initialStepId }: { selection: LogSelection; nowIso?: string; initialStepId?: string }) {
  const client = useDashboardClient();
  const binding = useDashboardCommandBinding();
  const resource = useRunWiring(client, selection, binding);
  const logsReadFailedTitle = formatErrorCatalogFailure(createErrorCatalogFailure("LOGS_READ_FAILED_TITLE", {})).text;
  const logsUnavailableTitle = formatErrorCatalogFailure(createErrorCatalogFailure("LOGS_UNAVAILABLE_TITLE", {})).text;
  const confirmedActionsUnavailableTitle = formatErrorCatalogFailure(createErrorCatalogFailure("LOGS_CONFIRMED_ACTIONS_UNAVAILABLE_TITLE", {})).text;
  const incompleteActionEvidenceText = formatErrorCatalogFailure(createErrorCatalogFailure("LOGS_CONFIRMED_ACTION_EVIDENCE_INCOMPLETE", {})).text;
  const projection = useMemo(() => resource.snapshot === undefined ? { steps: [], timeline: [] } : projectRunLogs(resource.snapshot, client), [resource.snapshot, client]);
  const failureMissing = resource.snapshot !== undefined && initialStepId !== undefined && !projection.steps.some(step => step.id === initialStepId);
  const toolbar = useMemo(() => resource.command ? <><Badge tone="neutral">{resource.command.state === "pending" ? "Pending" : resource.command.feedback}</Badge>{resource.replay && <Button size="sm" onClick={resource.replay}>Replay exact decision</Button>}</> : resource.state === "failed" ? <Banner tone="danger" title={logsReadFailedTitle}>{resource.error}</Banner> : resource.state === "loading" && resource.snapshot ? <Badge tone="neutral">Refreshing</Badge> : <>{resource.snapshot?.unavailableEvidence.map(message => <Badge key={message} tone="neutral">{message}</Badge>)}<Badge tone="neutral">Source order · cross-source chronology unavailable</Badge></>, [resource.command, resource.replay, resource.state, resource.snapshot, resource.error, logsReadFailedTitle]);
  return <LogPanel initialStepId={resource.snapshot !== undefined && !failureMissing ? initialStepId : undefined} title={resource.snapshot?.detail.header.title ?? selection.row.title} steps={projection.steps} timeline={projection.timeline} onDecision={resource.onDecision}
    context={queueRunHeader(selection.row, selection.workflowLabel, nowIso ?? selection.row.updatedAt)}
    status={<StatusBadge status={dsStatusOf(selection.row.status)} presentation="queue" />}
    toolbar={toolbar}
    content={failureMissing ? <Banner tone="danger" title={logsUnavailableTitle}>{formatErrorCatalogFailure(createErrorCatalogFailure("NOTIFICATION_TARGET_UNAVAILABLE", {})).text}</Banner> : resource.snapshot === undefined ? resource.state === "loading" ? <LogSkeleton /> : resource.state === "failed" ? <Banner tone="danger" title={logsUnavailableTitle}>{resource.error}</Banner> : undefined : resource.snapshot.actionEvidence?.state === "unavailable" && projection.steps.length === 0 ? <Banner tone="warning" title={confirmedActionsUnavailableTitle}>{incompleteActionEvidenceText}</Banner> : undefined} />;
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
  const decide = (id: string, action: LogDecisionAction, answer: LogDecisionAnswer) => {
    const result = decisionActionResult(action, answer);
    setEdited(current => {
      const nextSteps = (current?.basis === basis ? current.steps : scenario.steps).map(step => ({ ...step, entries: step.entries.flatMap(entry => {
      if (entry.id !== id || entry.kind !== "decision") return [entry];
      const latest = step.entries.reduce((time, row) => row.kind !== "fields" && row.time > time ? row.time : time, entry.time);
      const seconds = Number(latest.slice(0, 2)) * 3600 + Number(latest.slice(3, 5)) * 60 + Number(latest.slice(6)) + 1;
      const time = new Date(seconds * 1000).toISOString().slice(11, 19);
      const event = { kind: "note" as const, id: `${id}-${step.entries.length}`, time, message: `${result.title}. ${result.message}`, tone: result.tone, announce: true };
      return result.continues ? [{ ...entry, decision: { ...entry.decision, actions: undefined, footer: result.title } }, event] : [entry, event];
      }) }));
      if (scenarioId === "preview" && action.id === "approve-lookup-match" && !nextSteps.some(step => step.id === "lookup-job")) {
        nextSteps.push({ id: "lookup-job", time: "09:40:20", title: "Read employment record", system: "UCPath", entries: [{ kind: "note", id: "lookup-job-started", time: "09:40:20", message: `Reading the employment record for ${preview?.subject}.`, tone: "info" }] });
      }
      return { basis, timeline: scenarioId === "preview" ? continuedLookupTimeline(current?.basis === basis ? current.timeline : scenario.timeline, action.id) : scenario.timeline, steps: nextSteps };
    });
  };
  return <LogPanel key={basis} context={selection && (scenarioId === 'preview' || scenarioId === 'selected') ? queueRunHeader(selection.row, selection.workflowLabel, nowIso ?? selection.row.updatedAt) : undefined} title={scenarioId === "preview" && preview ? preview.subject : scenarioId === "selected" && selected ? selected.title : scenario.subject} status={selection && (scenarioId === "preview" || scenarioId === "selected") ? <StatusBadge status={dsStatusOf(selection.row.status)} presentation="queue" /> : <Badge tone="neutral">{scenario.status}</Badge>} steps={steps} timeline={timeline} initialStepId={scenarioId === "preview" ? preview?.initialStepId : undefined} onDecision={scenarioId === "selected" ? undefined : decide} />;
}
