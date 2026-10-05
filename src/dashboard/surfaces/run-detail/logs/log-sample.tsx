import { useState } from "react";
import { Badge } from "../../../ds/ui.js";
import { StatusBadge } from "../../shared/status/status.js";
import { dsStatusOf } from "../../shared/status/status-model.js";
import { LogPanel } from "../log-panel.js";
import { decisionActionResult, type LogDecisionAction, type LogDecisionAnswer } from "./log-decision-model.js";
import type { LogStep } from "./log-feed-model.js";
import { decisionScenarios, previewScenarios } from "./log-fixture.js";
import { selectedLogPresentation, selectedLogSample, type LogSelection } from "./log-selection-model.js";
import { continuedLookupTimeline } from "./log-selected-fixture.js";
import type { LogTimelineStage } from "./log-timeline-model.js";

/** Status-matched fictional previews with a separate served queue-facts view. */
export function LogSample({ selection }: { selection?: LogSelection }) {
  const scenarioId = new URLSearchParams(typeof window === "undefined" ? "" : window.location.search).get("logPreview") ?? (selection ? "preview" : "separation");
  const [edited, setEdited] = useState<{ basis: string; steps: readonly LogStep[]; timeline: readonly LogTimelineStage[] }>();
  const scenarios = [...previewScenarios, ...decisionScenarios];
  const selected = selection ? selectedLogPresentation(selection) : undefined;
  const preview = selection ? selectedLogSample(selection) : undefined;
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
  return <LogPanel key={basis} title={scenarioId === "preview" && preview ? preview.subject : scenarioId === "selected" && selected ? selected.title : scenario.subject} status={selection && (scenarioId === "preview" || scenarioId === "selected") ? <StatusBadge status={dsStatusOf(selection.row.status)} presentation="queue" /> : <Badge tone="neutral">{scenario.status}</Badge>} steps={steps} timeline={timeline} initialStepId={scenarioId === "preview" ? preview?.initialStepId : undefined} onDecision={scenarioId === "selected" ? undefined : decide} />;
}
