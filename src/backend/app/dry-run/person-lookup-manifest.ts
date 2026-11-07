import { personLookupWorkflow } from "../../../workflows/person-lookup/workflow.js";
import { parseDryRunScenarioManifest } from "../../../models/trust/dry-run-scenario.js";

const reached = ["searching", "search-identity", "cross-verify", "crm-identity", "crm-selected-record", "active-status"];
export const PERSON_LOOKUP_LIVE_READ = parseDryRunScenarioManifest({
  scenarioId: "person-lookup/live-read", workflow: personLookupWorkflow.id, arm: "live-read",
  recordedBy: "Prepared transaction-free read; current live verification pending",
  cases: [{
    caseId: "search-by-eid", subjectLabel: "person-lookup-canary", subjectKind: "search-by-eid",
    why: "Resolve the admitted current EID in UCPath, verify CRM identity and fold employment status without creating any transaction",
    nodesReached: reached, nodesExcluded: ["matching", "crm-results", "crm-only-recovery", "crm-dates"],
    checkpoints: reached.map((node) => ({ node, attempt: 1, keyedBy: ["workflow", "item", "node", "attempt", "claimGeneration"] })),
    screenshots: { nodes: ["searching", "crm-selected-record"] },
    gateResults: [], durableDeltas: { writeIntents: 0, writeAttempts: 0, durableOutbox: 0 },
    receipt: { result: "verified-done", confidence: "verified", verification: [
      { obligation: "node.searching", verdict: "verified", mandatory: false },
      { obligation: "node.matching", verdict: "absent", mandatory: false },
      { obligation: "node.search-identity", verdict: "verified", mandatory: true },
      { obligation: "node.cross-verify", verdict: "verified", mandatory: false },
      { obligation: "node.crm-identity", verdict: "verified", mandatory: true },
      { obligation: "node.crm-selected-record", verdict: "verified", mandatory: true },
      { obligation: "node.crm-results", verdict: "absent", mandatory: false },
      { obligation: "node.crm-only-recovery", verdict: "unknown", mandatory: false },
      { obligation: "node.active-status", verdict: "verified", mandatory: true },
      { obligation: "node.crm-dates", verdict: "absent", mandatory: false },
      { obligation: "completion.terminal-result", verdict: "verified", mandatory: true },
      { obligation: "identity.eid-agrees-across-sources", verdict: "verified", mandatory: true },
      { obligation: "identity.ucpath-selection-is-unambiguous", verdict: "verified", mandatory: true },
    ] }, terminal: { lifecycle: "done", resultSchema: "workflow-result", kind: "live-read" },
  }],
});
