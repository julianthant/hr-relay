import { useState } from "react";
import { Banner, Button, DsBodyScope, PageHeading, TooltipProvider, dsText, useDemoTheme } from "../../../src/dashboard/ds/ui.js";
import { UcpathFoundTransactions } from "../../../src/dashboard/surfaces/run-detail/logs/log-decision.js";
import type { UcpathFoundPresentation } from "../../../src/dashboard/surfaces/run-detail/logs/ucpath-found-model.js";

export function ControlPreview() {
  const { theme } = useDemoTheme();
  const [scenario, setScenario] = useState("exact");
  const [pending, setPending] = useState(false);
  const [decision, setDecision] = useState("");
  const presentation: UcpathFoundPresentation = pending ? { state: "checking" } : scenario === "unavailable" ? { state: "unavailable" } : scenario === "loading" ? { state: "loading" } : {
    state: "found", complete: scenario !== "incomplete", authoritative: true,
    rows: scenario === "absent" || scenario === "incomplete" ? [] : [{ transactionNumber: "EXAMPLE-1024", person: "Example Person", employeeId: "EXAMPLE-EID", transactionType: "Separation", effectiveDate: "10/30/2026", submittedAt: "10/30/2026 9:00 AM", match: scenario === "ambiguous" ? "ambiguous" : "exact", detailVerified: scenario !== "unverified" }],
  };
  return <div data-app-root data-demo-theme={theme}><TooltipProvider><DsBodyScope><main className={`ds-body-stack ${dsText.body}`} style={{ margin: "0 auto", maxWidth: 1000, padding: "var(--ds-space-section)" }}>
    <Banner tone="info" title="UI mock">Synthetic transactions. No UCPath reads, decisions, or writes are sent.</Banner><PageHeading title="Logs" description="Separation · Unknown submission" />
    <UcpathFoundTransactions key={scenario} attemptLabel="Example original attempt 1" presentation={presentation} onDecision={value => { setDecision(value.kind); setPending(true); }} />
    {decision && <p role="status">Mock {decision} requested. Original outcome has not been settled.</p>}
    <div className="flex gap-2">{["exact", "ambiguous", "absent", "incomplete", "unverified", "loading", "unavailable"].map(value => <Button key={value} variant="muted" onClick={() => { setScenario(value); setPending(false); setDecision(""); }}>Show {value}</Button>)}</div>
  </main></DsBodyScope></TooltipProvider></div>;
}
