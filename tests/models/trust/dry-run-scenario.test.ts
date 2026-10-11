import assert from "node:assert/strict";
import { describe,it } from "vitest";
import {
deriveDryRunScenarioManifestDigest,
parseDryRunScenarioManifest,
} from "../../../src/models/trust/dry-run-scenario.js";

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

const GATED_MANIFEST = {
  ...MANIFEST,
  cases: [{
    ...MANIFEST.cases[0],
    nodesReached: ["read", "approval", "write"],
    gateResults: [{ gate: "approval", decision: "approved", resolvedBy: "local-operator" }],
  }],
} as const;

describe("dry-run scenario manifest boundary", () => {
  it("canonicalizes and digests the complete manifest facts", () => {
    const parsed = parseDryRunScenarioManifest(MANIFEST);

    assert.equal(
      deriveDryRunScenarioManifestDigest(parsed),
      "0aaccc8fbfc9c0083a8248104d800f74f073ad6d0736e0913a2685e118c7e297",
    );
  });


  it("refuses a gate expectation field no evaluator compares", () => {
    assert.throws(() => parseDryRunScenarioManifest({
      ...GATED_MANIFEST,
      cases: [{
        ...GATED_MANIFEST.cases[0],
        gateResults: [{
          gate: "approval",
          decision: "approved",
          resolvedBy: "local-operator",
          leaf: "resolve-gate-approved",
        }],
      }],
    }), /leaf/);
  });

  it("rejects duplicate subject cases at the strict manifest boundary", () => {
    assert.throws(() => parseDryRunScenarioManifest({
      ...MANIFEST,
      cases: [MANIFEST.cases[0], { ...MANIFEST.cases[0], caseId: "second" }],
    }), /repeats a subjectLabel/);
  });
});
