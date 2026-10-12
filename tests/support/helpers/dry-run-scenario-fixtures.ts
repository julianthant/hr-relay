






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

export function dryRunScenarioResultRecords(HASH: string, NOW: string) {
const STARTED_MET_RESULT = {
  resultId: "11111111-1111-4111-8111-111111111111",
  scenarioId: "separations-kuali-finalization/dry-run",
  workflow: "separations-kuali-finalization",
  subjectLabel: "finalization-canary",
  manifestDigest: HASH,
  verdict: "met",
  assertions: [
    { assertionId: "nodes-reached", verdict: "met", reason: "reached-declared-nodes" },
    { assertionId: "write-deltas-zero", verdict: "met", reason: "write-deltas-unchanged" },
  ],
  wallTimeMs: 12_345,
  recordedAt: NOW,
  execution: {
    state: "started",
    runId: "22222222-2222-4222-8222-222222222222",
    traceId: "sep-120000-2222",
  },
};

const NOT_STARTED_BLOCKED_RESULT = {
  ...STARTED_MET_RESULT,
  resultId: "44444444-4444-4444-8444-444444444444",
  verdict: "blocked",
  assertions: [
    { assertionId: "subject-available", verdict: "blocked", reason: "subject-unavailable" },
  ],
  wallTimeMs: 0,
  execution: { state: "not-started", reason: "subject-unavailable" },
};
return { STARTED_MET_RESULT, NOT_STARTED_BLOCKED_RESULT };
}
