/**
 * `separations` — the T1b dry-run scenario manifest
 * (ref guards-and-tests §10.4/§10.9; the second pair in the tree after
 * `separations-kuali-finalization`).
 *
 * **This file is a declaration, not a test.** It is deliberately not named
 * `.test.` so no vitest project collects it, because running it starts a
 * browser and reaches live Kuali, live UCPath and live New Kronos. It is
 * executed by `npm run cli -- dry-run-scenario separations --subject <label>`,
 * once per case, and each run writes a `dry_run_scenario_results` row plus a
 * dated line in `docs/migrations/separations.md` — the line a `PROOF` tick on
 * the tree cites. Its sibling `structural.scenario.test.ts` is the T1a half and
 * asserts nothing about the world; everything here is a world fact and can only
 * be settled by a live rehearsal.
 *
 * **Subjects are LABELS.** No person's identifier appears in this file and none
 * may: the label's value lives outside git — `config/test-subjects.json` for
 * the non-sensitive half (the Kuali document number), `.env` through
 * `src/domain/secrets.ts` for a real EID, of which this workflow's arm carries
 * NONE (§10.5). Since D284 (2026-08-28) the registry holds ONE subject,
 * `finalization-canary` / Kuali doc 4537, with one arm per workflow; this
 * manifest's one case addresses that subject's `separations` arm, whose kind is
 * `full-chain-dry-run`. A label the registry cannot resolve makes its case
 * `blocked: needs <label>`, never `failed`, because a canary that left the
 * university is not a defect in this workflow.
 *
 * **What a dry run of THIS workflow actually does**, so the expectations below
 * are not guesses. The composition declares THREE transaction nodes —
 * `clear-pending`, `file-termination`, `finalize-kuali` — and
 * `workflowDryRunSupport(separationsDescriptor)` therefore reports
 * `{ state: "supported", stopsAt: "clear-pending" }`: a rehearsal runs the
 * thirteen read/fold nodes, parks at the ALWAYS-GATE and takes a REAL operator
 * approval through the real command kernel, then reaches the FIRST transaction
 * node, reports the settlement the real path would reach, and ends the run
 * there (D215). So the run DOES write spans, checkpoints, a gate row and a real
 * terminal settlement; what it never writes is the write-safety family, which
 * is what the three zero deltas assert. `file-termination`, `receipt` and
 * `finalize-kuali` are never entered at all, which `nodesExcluded` asserts from
 * the other side.
 *
 * **Every expectation below was READ FROM AUTHORITY, not composed**, and each
 * has a named source:
 *
 * - **The node path, the checkpoint rows, the gate row and the receipt
 *   vocabulary come from the GRAPH** (`src/workflows/separations/descriptor.ts`,
 *   nineteen runtime nodes per `descriptorRuntimeNodes`, re-checked
 *   2026-08-28 — unchanged) and were TRANSCRIBED from the 2026-08-27
 *   `dryRun=true` full-chain proof on document 4502 recorded at
 *   `docs/migrations/separations.md` §9.27 addendum 7 — run
 *   `fd415e49-54bb-4ccd-bec4-ad1cba94a4f6`, trace `sp-053429-fd41`, terminal
 *   `done` at the D215 preview terminal stopped at `clear-pending`, and
 *   `write_intents` 0 / `write_attempts` 0 / `durable_outbox` 0 read over the
 *   whole database. The fifteen checkpoint rows and the twenty-row receipt
 *   vocabulary below are that run's own `run_checkpoints` and
 *   `evidence_receipts` rows. They are facts about the graph, not about a
 *   subject, which is why a run on 4502 can stand as the source for 4537.
 * - **The `preview` arm is a fact about the SUBJECT**, and it comes from
 *   §9.19's row-① finding on 4537 (2026-08-19): "UCPath holds five
 *   transactions for this EID, every one `Approved`, zero `Pending`; the probe
 *   settles `already-present` at beat ①" — combined with the probe's declared
 *   polarity in `src/stores/ucpath/tasks/match-pending-terminations.ts`
 *   (`present` means "there is nothing to sweep", so the sweep settles
 *   `already-present` and clicks nothing) and `clearPendingNode`'s
 *   `probePolicy: "always"` / `dryRun: "stop-after-prepare"`
 *   (`src/workflows/separations/ucpath-transaction/nodes.ts`). `proofSource`
 *   is `live-probe` because beat ①'s durable-intent lookup comes first (D215)
 *   and no run has ever written an intent row for this subject. The 2026-08-28
 *   read-only re-verification (§9.31) read the KUALI form — transaction number
 *   still empty, the UCPath filing ② not yet run — and did not re-read UCPath;
 *   nothing filed ② in between, so the arm stands on §9.19 until a live
 *   rehearsal settles it again.
 */
import {
  parseDryRunScenarioManifest,
  type DryRunScenarioManifest,
} from "../../../../src/domain/trust/dry-run-scenario.js";

/**
 * The graph, in the order a run REACHES it. Thirteen read/fold nodes, the
 * unconditional identity gate, the post-gate approval verification, and the
 * first of three transaction nodes — where D215 stops a rehearsal.
 */
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
const TRANSACTION_NODE = "clear-pending";

const FULL_PATH = [...READ_NODES, GATE_NODE, APPROVAL_NODE, TRANSACTION_NODE] as const;

/**
 * The two transaction nodes downstream of the preview terminal, plus the
 * receipt task that sits between them. A rehearsal that entered ANY of them
 * would have gone past the stop, so naming them is the "it did more than
 * expected" half the zero deltas cannot express on their own.
 */
const DOWNSTREAM_NODES = ["file-termination", "receipt", "finalize-kuali"] as const;

const CHECKPOINT_KEY = [
  "workflow",
  "item",
  "node",
  "attempt",
  "claimGeneration",
] as const;

/**
 * The fifteen rows, in the order the evidence collector emits them (sorted by
 * position in `nodesReached`, stably, so the two `timecard-search` rows stay
 * adjacent in write order).
 *
 * `timecard-search` appears TWICE at attempt 1 and that is the point: it is the
 * graph's `always-rerun` node, so the gate park and the resume are two claim
 * GENERATIONS of one attempt (D214) and the live Kronos read is taken again
 * after the operator decides rather than replayed from before. `approval` is
 * the other `always-rerun` node and records only the resume generation, because
 * it does not exist until the gate is resolved.
 */
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
  { node: "timecard-search", attempt: 1, keyedBy: CHECKPOINT_KEY },
  { node: "timecard", attempt: 1, keyedBy: CHECKPOINT_KEY },
  { node: "dates", attempt: 1, keyedBy: CHECKPOINT_KEY },
  { node: "comparison", attempt: 1, keyedBy: CHECKPOINT_KEY },
  { node: APPROVAL_NODE, attempt: 1, keyedBy: CHECKPOINT_KEY },
] as const;

/** Zero, as a delta measured BEFORE and AFTER: the database legitimately holds
 * rows from earlier real proofs, so an absolute count would be false. */
const NO_WRITES = { writeIntents: 0, writeAttempts: 0, durableOutbox: 0 } as const;

/** The gate is unconditional (§4d): no preset, prefill, resume path or run mode
 * disables it, and `envelope.dryRun` is not an exception. */
const IDENTITY_GATE = {
  gate: GATE_NODE,
  decision: "approved",
  resolvedBy: "local-operator",
} as const;

/**
 * The receipt service's complete ordered authority vocabulary for a preview of
 * this graph, transcribed from receipt `b7e7b603-6099-52d5-a065-27112c289a07`.
 *
 * Every graph node is present. The fifteen nodes the rehearsal reached are
 * `verified`; the four it did not settle — the stopped-at transaction and the
 * three nodes downstream of it — are `unknown`, as is the terminal result.
 * `unknown` is the load-bearing word: a dry run may never report a write-side
 * obligation as `verified`, because nothing was written to verify. This
 * composition declares no cross-source `write.*`/`identity.*` obligations of
 * its own; its evidence is node-scoped, which is why the list is exactly the
 * nineteen runtime nodes plus the terminal.
 */
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
  { obligation: "node.identity-approval", verdict: "verified", mandatory: false },
  { obligation: "node.approval", verdict: "verified", mandatory: true },
  { obligation: "node.clear-pending", verdict: "unknown", mandatory: true },
  { obligation: "node.file-termination", verdict: "unknown", mandatory: true },
  { obligation: "node.receipt", verdict: "unknown", mandatory: true },
  { obligation: "node.finalize-kuali", verdict: "unknown", mandatory: true },
  { obligation: "completion.terminal-result", verdict: "unknown", mandatory: true },
] as const;

const MANIFEST = {
  scenarioId: "separations/dry-run",
  workflow: "separations",
  transactionNode: TRANSACTION_NODE,
  recordedBy: "docs/migrations/separations.md §9.27 addendum 7 "
    + "(the 2026-08-27 dryRun=true full-chain proof on doc 4502 — the TRANSCRIPTION source of every "
    + "graph expectation); the SUBJECT is doc 4537 (§9.19 mapped 2026-08-19, re-read read-only "
    + "2026-08-28 in §9.31; D284)",
  cases: [
    {
      caseId: "nothing-to-sweep",
      // The value lives outside git: config/test-subjects.json names the
      // document; no EID crosses this workflow's arm at all (D261 — the
      // ingress is ONE typed document number).
      subjectLabel: "finalization-canary",
      subjectKind: "full-chain-dry-run",
      why: "The one active test subject (D284): the open, editable RRSS document the composed chain "
        + "will drive through its controlled commits, rehearsed from its typed document number. Its "
        + "UCPath record holds no Pending transaction — §9.19 row ① read five, every one Approved — "
        + "so the pending-terminations sweep settles `already-present` at its live probe before "
        + "anything is staged. That is the arm D215 requires a rehearsal to reach FIRST: a preview "
        + "that skipped the probe would have reported a would-prepare it could not honour. Nothing "
        + "is written: the rehearsal stops at `clear-pending`, so the filing ② the subject still "
        + "owes and the finalization ③ are never entered.",
      nodesReached: [...FULL_PATH],
      nodesExcluded: [...DOWNSTREAM_NODES],
      checkpoints: [...EXPECTED_CHECKPOINTS],
      gateResults: [IDENTITY_GATE],
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
