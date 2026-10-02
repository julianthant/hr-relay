import { useState } from "react";
import { Select } from "../../ds/ui.js";
import { LogPanel } from "../log-panel.js";
import { decisionActionResult, type LogDecisionAction, type LogDecisionAnswer } from "../log-decision-model.js";
import type { LogStep } from "../log-feed-model.js";
import { decisionScenarios, previewScenarios } from "./log-fixture.js";

/** Explicit fictional data, independent of the selected queue run's stored record. */
export function LogSample() {
  const [scenarioId, setScenarioId] = useState<string>("separation");
  const [steps, setSteps] = useState<readonly LogStep[]>(previewScenarios[0].steps);
  const scenarios = [...previewScenarios, ...decisionScenarios];
  const scenario = scenarios.find(item => item.id === scenarioId);
  if (!scenario) throw new Error("log-sample-scenario-missing");
  const decide = (id: string, action: LogDecisionAction, answer: LogDecisionAnswer) => {
    const result = decisionActionResult(action, answer);
    setSteps(current => current.map(step => ({ ...step, entries: step.entries.flatMap(entry => {
      if (entry.id !== id || entry.kind !== "decision") return [entry];
      const latest = step.entries.reduce((time, row) => row.kind !== "fields" && row.time > time ? row.time : time, entry.time);
      const seconds = Number(latest.slice(0, 2)) * 3600 + Number(latest.slice(3, 5)) * 60 + Number(latest.slice(6)) + 1;
      const time = new Date(seconds * 1000).toISOString().slice(11, 19);
      const event = { kind: "note" as const, id: `${id}-${step.entries.length}`, time, message: `${result.title}. ${result.message}`, tone: result.tone, announce: true };
      return result.continues ? [{ ...entry, decision: { ...entry.decision, actions: undefined, footer: result.title } }, event] : [entry, event];
    }) })));
  };
  return <LogPanel key={scenario.id} title={`Separations · ${scenario.subject}`} status={scenario.status} steps={steps} timeline={scenario.timeline} onDecision={decide}
    toolbar={<Select aria-label="Logs sample data" variant="toolbar" value={scenarioId} onChange={event => { const next = scenarios.find(item => item.id === event.target.value); if (!next) throw new Error("log-sample-scenario-missing"); setScenarioId(next.id); setSteps(next.steps); }}>{scenarios.map(item => <option key={item.id} value={item.id}>Sample data · {item.label}</option>)}</Select>} />;
}
