import { useState } from "react";
import { Select } from "../../ds/ui.js";
import { LogPanel } from "../log-panel.js";
import { previewScenarios } from "./log-fixture.js";

/** Explicit fictional data, independent of the selected queue run's stored record. */
export function LogSample() {
  const [scenarioId, setScenarioId] = useState<string>("separation");
  const scenario = previewScenarios.find(item => item.id === scenarioId);
  if (!scenario) throw new Error("log-sample-scenario-missing");
  return <LogPanel key={scenario.id} title={`Separations · ${scenario.subject}`} status={scenario.status} steps={scenario.steps}
    toolbar={<Select aria-label="Logs sample data" variant="toolbar" value={scenarioId} onChange={event => setScenarioId(event.target.value)}>{previewScenarios.map(item => <option key={item.id} value={item.id}>Sample data · {item.label}</option>)}</Select>} />;
}
