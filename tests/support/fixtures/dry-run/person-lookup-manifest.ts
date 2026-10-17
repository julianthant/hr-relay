/** Retained test data for dry-run safety assertions; not a registered scenario. */
import {
  parseDryRunScenarioManifest,
  type DryRunScenarioManifest,
} from "../../../../src/models/trust/dry-run-scenario.js";

const CHECKPOINT_KEY = ["workflow", "item", "node", "attempt", "claimGeneration"] as const;

const READ_NODES = ["searching", "search-identity", "cross-verify", "crm-identity", "crm-selected-record", "active-status"] as const;

export const PERSON_LOOKUP_LIVE_READ: DryRunScenarioManifest = parseDryRunScenarioManifest({
  scenarioId: "person-lookup/live-read",
  workflow: "person-lookup",
  arm: "live-read",
  recordedBy: "Task 1.6.7 2026-09-07 — replacement attempts 1–2 retained as failed acquisition; bounded login recovered, exact attempt 3, unchanged D318 receipt obligations",
  cases: [
    {
      caseId: "search-by-eid",
      subjectLabel: "person-lookup-canary",
      subjectKind: "search-by-eid",
      why: "the ordinary Search mode: one current person resolved by EID, cross-verified against the CRM, folded to a verdict; the CRM dates arm stays off by the start box's declared constant",
      nodesReached: [...READ_NODES],
      nodesExcluded: ["matching", "crm-results", "crm-only-recovery", "crm-dates"],

      checkpoints: READ_NODES.map((node) => ({ node, attempt: 3, keyedBy: [...CHECKPOINT_KEY] })),
      gateResults: [],
      durableDeltas: { writeIntents: 0, writeAttempts: 0, durableOutbox: 0 },
      receipt: {
        result: "verified-done",
        confidence: "verified",
        verification: [
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
        ],
      },
      terminal: { lifecycle: "done", resultSchema: "workflow-result", kind: "live-read" },
    },
  ],
});
