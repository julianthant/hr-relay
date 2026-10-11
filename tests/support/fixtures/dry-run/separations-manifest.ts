/** Retained test data for dry-run safety assertions; not a registered scenario. */
import {
  parseDryRunScenarioManifest,
  type DryRunScenarioManifest,
} from "../../../../src/models/trust/dry-run-scenario.js";


const READ_NODES = [
  "resolve-action",
  "document",
  "plan",
  "termination-type",
  "name-search",
  "subject",
  "job-summary",
  "employment",
  "department-option",
  "timecard-search",
  "timecard",
  "dates",
  "comparison",
] as const;
const GATE_NODE = "identity-approval";
const APPROVAL_NODE = "approval";
const PENDING_SET_NODE = "pending-set";
const TRANSACTION_NODE = "clear-pending";

const FULL_PATH = [...READ_NODES, APPROVAL_NODE, PENDING_SET_NODE, TRANSACTION_NODE] as const;


const EXCLUDED_NODES = [
  GATE_NODE,
  "file-termination",
  "receipt",
  "filing-presence",
  "finalize-kuali",
] as const;

const CHECKPOINT_KEY = [
  "workflow",
  "item",
  "node",
  "attempt",
  "claimGeneration",
] as const;



const EXPECTED_CHECKPOINTS = [
  { node: "resolve-action", attempt: 1, keyedBy: CHECKPOINT_KEY },
  { node: "document", attempt: 1, keyedBy: CHECKPOINT_KEY },
  { node: "plan", attempt: 1, keyedBy: CHECKPOINT_KEY },
  { node: "termination-type", attempt: 1, keyedBy: CHECKPOINT_KEY },
  { node: "name-search", attempt: 1, keyedBy: CHECKPOINT_KEY },
  { node: "subject", attempt: 1, keyedBy: CHECKPOINT_KEY },
  { node: "job-summary", attempt: 1, keyedBy: CHECKPOINT_KEY },
  { node: "employment", attempt: 1, keyedBy: CHECKPOINT_KEY },
  { node: "department-option", attempt: 1, keyedBy: CHECKPOINT_KEY },
  { node: "timecard-search", attempt: 1, keyedBy: CHECKPOINT_KEY },
  { node: "timecard", attempt: 1, keyedBy: CHECKPOINT_KEY },
  { node: "dates", attempt: 1, keyedBy: CHECKPOINT_KEY },
  { node: "comparison", attempt: 1, keyedBy: CHECKPOINT_KEY },
  { node: APPROVAL_NODE, attempt: 1, keyedBy: CHECKPOINT_KEY },
  { node: PENDING_SET_NODE, attempt: 1, keyedBy: CHECKPOINT_KEY },
] as const;

/** Zero, as a delta measured BEFORE and AFTER: the database legitimately holds
 * rows from earlier real proofs, so an absolute count would be false. */
const NO_WRITES = { writeIntents: 0, writeAttempts: 0, durableOutbox: 0 } as const;


const PREVIEW_RECEIPT_VERIFICATION = [
  { obligation: "node.resolve-action", verdict: "verified", mandatory: false },
  { obligation: "node.document", verdict: "verified", mandatory: false },
  { obligation: "node.plan", verdict: "verified", mandatory: false },
  { obligation: "node.termination-type", verdict: "verified", mandatory: false },
  { obligation: "node.name-search", verdict: "verified", mandatory: false },
  { obligation: "node.subject", verdict: "verified", mandatory: false },
  { obligation: "node.job-summary", verdict: "verified", mandatory: false },
  { obligation: "node.employment", verdict: "verified", mandatory: true },
  { obligation: "node.department-option", verdict: "verified", mandatory: true },
  { obligation: "node.timecard-search", verdict: "verified", mandatory: false },
  { obligation: "node.timecard", verdict: "verified", mandatory: false },
  { obligation: "node.dates", verdict: "verified", mandatory: true },
  { obligation: "node.comparison", verdict: "verified", mandatory: false },
  { obligation: "node.identity-approval", verdict: "absent", mandatory: false },
  { obligation: "node.approval", verdict: "verified", mandatory: true },
  { obligation: "node.pending-set", verdict: "verified", mandatory: false },
  { obligation: "node.clear-pending", verdict: "unknown", mandatory: true },
  { obligation: "node.file-termination", verdict: "unknown", mandatory: true },
  { obligation: "node.receipt", verdict: "unknown", mandatory: true },
  { obligation: "node.filing-presence", verdict: "unknown", mandatory: false },
  { obligation: "node.finalize-kuali", verdict: "unknown", mandatory: true },
  { obligation: "completion.terminal-result", verdict: "unknown", mandatory: true },
] as const;

const MANIFEST = {
  scenarioId: "separations/dry-run",
  workflow: "separations",

  arm: "dry-run-preview",
  transactionNode: TRANSACTION_NODE,
  recordedBy: "the current separations graph and public finalization subject registry",
  cases: [
    {
      caseId: "nothing-to-sweep",

      subjectLabel: "finalization-canary",
      subjectKind: "full-chain-dry-run",
      why: "D284's one retained historical test subject is now gone from the Kuali Action List, so "
        + "the command records `blocked` before resolving its environment reference or composing a browser. "
        + "Its last valid UCPath observation held no Pending transaction — §9.19 row ① read five, every one Approved — "
        + "so the pending-terminations sweep settles `already-present` at its live probe before "
        + "anything is staged. That is the arm D215 requires a rehearsal to reach FIRST: a preview "
        + "that skipped the probe would have reported a would-prepare it could not honour. Nothing "
        + "would be written by that declared rehearsal: it stops at `clear-pending`, so filing ②, "
        + "the filing-presence re-read, and finalization ③ are never entered.",
      nodesReached: [...FULL_PATH],
      nodesExcluded: [...EXCLUDED_NODES],
      checkpoints: [...EXPECTED_CHECKPOINTS],
      gateResults: [],
      durableDeltas: NO_WRITES,
      receipt: {
        result: "partial",
        confidence: "unknown",
        verification: [...PREVIEW_RECEIPT_VERIFICATION],
      },
      terminal: {
        lifecycle: "done",
        resultSchema: "RunDryRunPreviewResultSchema",
        kind: "dry-run-preview",
        externalCommit: "none",
        stoppedAtNodeId: TRANSACTION_NODE,
      },
      preview: { outcome: "already-present", proofSource: "live-probe" },
    },
  ],
};

/** Recursively frozen at module load, like every registry export in this tree. */
export const SEPARATIONS_DRY_RUN: DryRunScenarioManifest =
  parseDryRunScenarioManifest(MANIFEST);
