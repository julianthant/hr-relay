import { useMemo, useState } from "react";
import { IsoInstantSchema } from "../../../../../src/rules/identity/ids.js";
import type { DashboardActionHandler } from "../../../../../src/dashboard/surfaces/shared/actions/actions.js";
import { LogPanel } from "../../../../../src/dashboard/surfaces/run-detail/log-panel.js";
import { RunStateChips } from "../../../../../src/dashboard/surfaces/run-detail/run-state-chips.js";
import { Pause, RotateCw, Square } from "lucide-react";
import { ConfirmDialog } from "../../../../../src/dashboard/ds/ui.js";
import { queueRowTitle } from "../../../../../src/dashboard/surfaces/queue/queue-model.js";
import { LogFooterButton } from "../../../../../src/dashboard/surfaces/run-detail/logs/log-action-button.js";
import { rerunFooterAction } from "../../../../../src/dashboard/surfaces/run-detail/logs/log-selection-model.js";
import { answeredRow, type LogDecision } from "../../../../../src/dashboard/surfaces/run-detail/logs/log-decision-model.js";
import type { LogDecisionHandler } from "../../../../../src/dashboard/surfaces/run-detail/logs/log-feed.js";
import type { LogStep } from "../../../../../src/dashboard/surfaces/run-detail/logs/log-feed-model.js";
import type { LogSelection } from "../../../../../src/dashboard/surfaces/run-detail/logs/log-selection-model.js";
import type { LogTimelineStage } from "../../../../../src/dashboard/surfaces/run-detail/logs/log-timeline-model.js";
import { decisionScenarios, previewScenarios } from "./log-fixture.js";
import { continuedLookupTimeline, selectedLogPresentation, selectedLogSample } from "./log-selected-fixture.js";

export function LogPreview({ selection, onAction }: { selection?: LogSelection; onAction?: DashboardActionHandler }) {
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
  const answerSteps = (current: typeof edited, id: string, optionId: string, label: string, answeredInput?: string) => (current?.basis === basis ? current.steps : scenario.steps).map(step => ({ ...step, entries: step.entries.map(entry => entry.id !== id || entry.kind !== "decision" ? entry
    : { ...entry, decision: { ...withoutServed(entry.decision), ...(answeredInput ? { answeredInput } : {}), answered: { optionId, label, at: PREVIEW_ANSWERED_AT, actor: { kind: "person" as const, name: "Alex Rivera" } } } }) }));
  const decide: LogDecisionHandler = (id, option, answer) => {
    const label = answeredRow(option, answer)?.name ?? option.label;
    setEdited(current => {
      const nextSteps = answerSteps(current, id, option.id, label, option.input?.kind === "text" ? answer.text?.trim() : undefined);
      if (scenarioId === "preview" && option.id === "approve-lookup-match" && !nextSteps.some(step => step.id === "lookup-job")) {
        nextSteps.push({ id: "lookup-job", time: "09:40:20", title: "Read employment record", system: "UCPath", entries: [{ kind: "note", id: "lookup-job-started", time: "09:40:20", message: `Reading the employment record for ${preview?.subject}.`, tone: "info" }] });
      }
      return { basis, timeline: scenarioId === "preview" ? continuedLookupTimeline(current?.basis === basis ? current.timeline : scenario.timeline, option.id) : scenario.timeline, steps: nextSteps };
    });
  };
  const cancelPreview = (id: string) => setEdited(current => ({ basis, timeline: current?.basis === basis ? current.timeline : scenario.timeline, steps: answerSteps(current, id, "cancel-run", "Cancel run") }));
  return <LogPanel key={basis} status={selection === undefined ? undefined : <RunStateChips row={selection.row} />} title={scenarioId === "preview" && preview ? preview.subject : scenarioId === "selected" && selected ? selected.title : scenario.subject} steps={steps} timeline={timeline} initialStepId={scenarioId === "preview" ? preview?.initialStepId : undefined} onDecision={scenarioId === "selected" ? undefined : decide} onCancelRun={scenarioId === "selected" ? undefined : cancelPreview} footerActions={scenarioId === "preview" || scenarioId === "selected" ? <>{selection && <PreviewMemberControls selection={selection} onAction={onAction} />}{previewRerun(selection, onAction)}</> : undefined} />;
}

function previewRerun(selection: LogSelection | undefined, onAction?: DashboardActionHandler) {
  const rerun = rerunFooterAction(selection, onAction);
  return rerun === undefined ? undefined : <LogFooterButton label={rerun.label} icon={<RotateCw aria-hidden className="size-4" />} onClick={rerun.run} />;
}

/** A fixture has no clock; the preview answer carries a fixed instant. */
const PREVIEW_ANSWERED_AT = IsoInstantSchema.parse("2026-08-03T16:41:05.000Z");

const withoutServed = ({ served: _served, ...rest }: LogDecision): LogDecision => rest;


/** The preview always offers both member controls; they send the row's own pause and cancel when it serves them. */
function PreviewMemberControls({ selection, onAction }: { selection: LogSelection; onAction?: DashboardActionHandler }) {
  const [confirming, setConfirming] = useState(false);
  const { row } = selection;
  if (row.parent === null || row.status !== "running") return null;
  const title = queueRowTitle(row);
  const target = { runId: row.runId, expectedVersion: row.rowRevision };
  const pause = row.actions.find(action => action.kind === "command" && action.command === "pause");
  const stop = row.actions.find(action => action.kind === "command" && action.command === "cancel");
  const run = (action: typeof pause) => { if (action !== undefined) void onAction?.(action, target); };
  return <>
    <LogFooterButton label={`Pause ${title}`} icon={<Pause aria-hidden className="size-4" />} onClick={() => run(pause)} />
    <LogFooterButton label={`Stop ${title}`} icon={<Square aria-hidden className="size-4" />} onClick={() => setConfirming(true)} />
    <ConfirmDialog open={confirming} onOpenChange={setConfirming} title={`Stop ${title}?`} description="Relay stops this run after its current step. Nothing already saved is undone." confirmLabel="Stop" destructive
      onConfirm={() => { setConfirming(false); run(stop); }} />
  </>;
}
