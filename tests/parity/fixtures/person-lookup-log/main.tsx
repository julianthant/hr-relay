import { createRoot } from "react-dom/client";
import { Badge, DsBodyScope, TooltipProvider } from "../../../../src/dashboard/ds/ui.js";
import { LogPanel } from "../../../../src/dashboard/surfaces/run-detail/log-panel.js";
import { projectRunLogs } from "../../../../src/dashboard/state/run-wiring-adapter.js";
import { PERSON_LOOKUP_LOG_SCENARIOS, personLookupLogSnapshot, type PersonLookupLogScenario } from "../../../support/fixtures/person-lookup-log-snapshots.js";
import "./style.css";

const query = new URLSearchParams(location.search);
const scenario = PERSON_LOOKUP_LOG_SCENARIOS.find(item => item === query.get("scenario")) ?? "success";
const theme = query.get("theme") === "light" ? "light" : "dark";
document.documentElement.setAttribute("data-demo-theme", theme);
document.body.setAttribute("data-demo-theme", theme);

const SVG = (label: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="850" height="300" viewBox="0 0 850 300"><rect width="850" height="300" fill="#f3f5f7"/><rect width="850" height="34" fill="#d9dee4"/><text x="16" y="22" font-family="sans-serif" font-size="14" fill="#333">${label}</text></svg>`)}`;
function Fixture({ scenario }: { scenario: PersonLookupLogScenario }) {
  const logs = projectRunLogs(personLookupLogSnapshot(scenario), { artifactUrl: () => SVG("Fictional UCPath page") });
  return <TooltipProvider><DsBodyScope><LogPanel title="10000001" status={<Badge tone="neutral">{scenario === "failed" ? "Failed" : "Done"}</Badge>} steps={logs.steps} timeline={logs.timeline} /></DsBodyScope></TooltipProvider>;
}
const container = document.getElementById("root");
if (container === null) throw new Error("fixture root missing");
createRoot(container).render(<Fixture scenario={scenario} />);
