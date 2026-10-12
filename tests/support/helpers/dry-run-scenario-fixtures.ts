






export function createDryRunScenarioFixtures() {
const MANIFEST = {
  scenarioId: "fixture-workflow/dry-run",
  workflow: "fixture-workflow",
  arm: "dry-run-preview",
  transactionNode: "write",
  recordedBy: "fixture contract",
  cases: [{
    caseId: "ordinary",
    subjectLabel: "fixture-canary",
    subjectKind: "ordinary",
    why: "the ordinary case",
    nodesReached: ["read", "write"],
    nodesExcluded: ["after-write"],
    checkpoints: [{
      node: "read",
      attempt: 1,
      keyedBy: ["workflow", "item", "node", "attempt", "claimGeneration"],
    }],
    gateResults: [],
    durableDeltas: { writeIntents: 0, writeAttempts: 0, durableOutbox: 0 },
    receipt: {
      result: "partial",
      confidence: "unknown",
      verification: [
        { obligation: "node.read", verdict: "verified", mandatory: false },
        { obligation: "node.write", verdict: "unknown", mandatory: true },
        { obligation: "completion.terminal-result", verdict: "unknown", mandatory: true },
        { obligation: "landing", verdict: "unknown", mandatory: true },
      ],
    },
    terminal: {
      lifecycle: "done",
      resultSchema: "RunDryRunPreviewResultSchema",
      kind: "dry-run-preview",
      externalCommit: "none",
      stoppedAtNodeId: "write",
    },
    preview: { outcome: "would-prepare", subject: "match", staged: true },
  }],
} as const;
return { MANIFEST };
}
