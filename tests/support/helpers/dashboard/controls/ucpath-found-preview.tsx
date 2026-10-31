import { useState } from "react";
import { Badge } from "../../../../../src/dashboard/ds/ui.js";
import { UcpathFoundTransactions } from "../../../../../src/dashboard/surfaces/run-detail/logs/log-decision.js";
import type { UcpathFoundPresentation } from "../../../../../src/dashboard/surfaces/run-detail/logs/ucpath-found-model.js";
import { LogsSurface } from "./control-surfaces.js";

export function ControlPreview() {
  const scenario = new URLSearchParams(location.search).get("state") ?? "exact";
  const [pending, setPending] = useState(false);
  const presentation: UcpathFoundPresentation = pending || scenario === "checking" ? { state: "checking" } : scenario === "unavailable" ? { state: "unavailable" } : scenario === "loading" ? { state: "loading" } : {
    state: "found", complete: scenario !== "incomplete", authoritative: scenario !== "unauthoritative",
    rows: scenario === "absent" ? [] : [{ transactionNumber: "00481024", person: "Rivera, Alex", employeeId: "10777012", transactionType: "Termination", effectiveDate: "10/30/2026", submittedAt: "10/30 9:00 AM", match: scenario === "ambiguous" || scenario === "incomplete" ? "ambiguous" : "exact", detailVerified: scenario !== "unverified" }, { transactionNumber: "00479310", person: "Rivera, Alex", employeeId: "10777012", transactionType: "Data change", effectiveDate: "10/12/2026", submittedAt: "10/12 2:15 PM", match: "different", detailVerified: true }],
  };
  return <LogsSurface status={<Badge tone="warning">Write parked</Badge>}><UcpathFoundTransactions attemptLabel="Submitted Oct 30, 2026 at 9:00 AM" presentation={presentation} onDecision={value => { document.documentElement.dataset.requestedDecision = JSON.stringify(value); setPending(true); }} /></LogsSurface>;
}
