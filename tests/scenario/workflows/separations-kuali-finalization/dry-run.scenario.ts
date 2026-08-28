/**
 * `separations-kuali-finalization` — the T1b dry-run scenario manifest
 * (ref guards-and-tests §10.4; D266's first pair in the tree).
 *
 * **This file is a declaration, not a test.** It is deliberately not named
 * `.test.` so no vitest project collects it, because running it starts a
 * browser and reaches live UCPath and live Kuali. It is executed by
 * `npm run cli -- dry-run-scenario separations-kuali-finalization --subject <label>`,
 * once per case, and each run writes a `dry_run_scenario_results` row plus a
 * dated line in `docs/migrations/separations.md` — the line a `PROOF` tick on
 * the tree cites. Its sibling `structural.scenario.test.ts` is the T1a half and
 * asserts nothing about the world; everything here is a world fact and can only
 * be settled by a live rehearsal.
 *
 * **Subjects are LABELS.** No person's identifier appears in this file and none
 * may: the label's value lives outside git — `config/test-subjects.json` for
 * the non-sensitive half (a Kuali document number, a transaction number),
 * `.env` through `src/domain/secrets.ts` for a real EID (§10.5). Since D284
 * (2026-08-28) the registry holds ONE subject, `finalization-canary` / Kuali
 * doc 4537, with one arm per workflow; this manifest's one case addresses that
 * subject's `separations-kuali-finalization` arm, whose kind is `ordinary`. A
 * label the registry cannot resolve makes its case `blocked: needs <label>`,
 * never `failed`, because a canary that left the university is not a defect
 * in this workflow (§9.16 recorded exactly that happening twice).
 *
 * **A run of this manifest TODAY records `blocked`, not `failed`, and not
 * `met`.** 4537's arm declares two canonical leaves as `pending` — its
 * `transactionNumber` does not exist until the UCPath filing ② files it, and
 * its `timekeeperComments` are composed by the chain — so
 * `resolveSeparationsKualiFinalizationTestTarget` returns `blocked` BY NAME
 * (label, workflow, field, observation date) before any secret is read and
 * before a browser starts. The case below is the expectation for the day ②
 * has filed and the registry's `pending` block is gone.
 *
 * **Cases this manifest deliberately does NOT carry (D284).** One live subject
 * cannot truthfully be `already-present`, `no-active-job` and
 * `subject-mismatch` at once, so those arms are no longer manifest cases; the
 * scenario matrix's negative branches are owned by the structural T1a file
 * beside this one and by the unit tests, on synthetic subjects. One of them
 * carried a recorded as-built defect worth keeping in view, so it is restated
 * here rather than lost with the case: `TransactionDryRunPreviewSchema`'s
 * `subject: { state: "mismatch" }` arm is UNREACHABLE — `executeDryRun` wraps
 * any binding-proof failure, including a genuine mismatch, into a generic
 * error (`src/core/write-sequencer.ts:1873-1892`), and `state: "mismatch"` is
 * constructed nowhere in `src/` or `tests/`. It is fail-closed rather than
 * dangerous; it stays an open item in ref guards-and-tests §10.4, with no live
 * subject behind it.
 *
 * **What a dry run of THIS workflow actually does**, so the expectations below
 * are not guesses (`src/core/write-sequencer.ts`, `src/core/run-executor.ts`):
 * the four read/fold nodes execute and checkpoint normally, the gate parks and
 * takes a REAL operator approval through the real command endpoint, and only
 * `finalize-kuali` branches on `envelope.dryRun` — its declared
 * `dryRun: "stop-after-prepare"` runs beat ①'s durable-intent lookup, then the
 * live probe, then the real prepare against a live Kuali document (all twelve
 * controls staged and read back) with no fence minted and no `commit` invoked,
 * and ends the run. So the run DOES write spans, checkpoints, a gate row and a
 * real terminal settlement; what it never writes is the write-safety family,
 * which is what the three zero deltas assert.
 *
 * The Kuali caveat this manifest is the instrument for: a Build document holds
 * staged edits in its own in-page form model until an explicit `Save`. Legacy
 * makes that claim about its drafts and **S61** records the claim as *stated,
 * never verified*. The `would-prepare` case re-opens the document after the
 * rehearsal, which is the verification legacy never did.
 */
import {
  parseDryRunScenarioManifest,
  type DryRunScenarioManifest,
} from "../../../../src/domain/trust/dry-run-scenario.js";

/** The graph, in execution order. Three roots, a gate, a check, one write. */
const READ_NODES = ["job-summary", "name-search", "department-option", "comparison"] as const;
const GATE_NODE = "identity-approval";
const APPROVAL_NODE = "approval";
const TRANSACTION_NODE = "finalize-kuali";

const FULL_PATH = [...READ_NODES, GATE_NODE, APPROVAL_NODE, TRANSACTION_NODE] as const;

/**
 * The four read/fold nodes checkpoint (`replay: "checkpoint"`); `approval` is
 * `replay: "always-rerun"` and still records this claim generation's output,
 * though no later claim may reuse it. The
 * transaction node writes none on a rehearsal — which is the `durableDeltas`
 * assertion from the other side.
 */
const READ_CHECKPOINTS = READ_NODES.map((node) => ({
  node,
  attempt: 1,
  keyedBy: ["workflow", "item", "node", "attempt", "claimGeneration"] as const,
}));
const EXPECTED_CHECKPOINTS = [
  ...READ_CHECKPOINTS,
  {
    node: APPROVAL_NODE,
    attempt: 1,
    keyedBy: ["workflow", "item", "node", "attempt", "claimGeneration"] as const,
  },
] as const;

/** Zero, as a delta measured BEFORE and AFTER: the database legitimately holds
 * rows from earlier real proofs, so an absolute count would be false. */
const NO_WRITES = { writeIntents: 0, writeAttempts: 0, durableOutbox: 0 } as const;

/** The gate is unconditional here (§4d): no preset, prefill, resume path or run
 * mode disables it, and `envelope.dryRun` is not an exception. */
const IDENTITY_GATE = {
  gate: GATE_NODE,
  decision: "approved",
  resolvedBy: "local-operator",
} as const;

/** The receipt service's complete ordered authority vocabulary for a preview.
 * Every graph node is present: the five checkpointed nodes and resolved gate
 * are verified, while the transaction has no checkpoint. The terminal result
 * and four cross-source comparisons are unknown; literal reload read-back is
 * absent. These are authority verdicts, not a lossy met/unmet projection. */
const PREVIEW_RECEIPT_VERIFICATION = [
  { obligation: "node.job-summary", verdict: "verified", mandatory: false },
  { obligation: "node.name-search", verdict: "verified", mandatory: false },
  { obligation: "node.department-option", verdict: "verified", mandatory: true },
  { obligation: "node.comparison", verdict: "verified", mandatory: false },
  { obligation: "node.identity-approval", verdict: "verified", mandatory: false },
  { obligation: "node.approval", verdict: "verified", mandatory: true },
  { obligation: "node.finalize-kuali", verdict: "unknown", mandatory: true },
  { obligation: "completion.terminal-result", verdict: "unknown", mandatory: true },
  { obligation: "write.timekeeper-matches-request", verdict: "unknown", mandatory: true },
  { obligation: "identity.eid-agrees-across-sources", verdict: "unknown", mandatory: true },
  { obligation: "write.document-matches-request", verdict: "unknown", mandatory: true },
  { obligation: "write.transaction-matches-request", verdict: "unknown", mandatory: true },
  { obligation: "write.proof-is-a-read-back", verdict: "absent", mandatory: true },
] as const;

const MANIFEST = {
  scenarioId: "separations-kuali-finalization/dry-run",
  workflow: "separations-kuali-finalization",
  transactionNode: TRANSACTION_NODE,
  recordedBy: "docs/migrations/separations.md §9.22 (the hand-run double-entry this file replaces)",
  cases: [
    {
      caseId: "ordinary",
      // The value lives outside git: config/test-subjects.json names the
      // document, .env carries the EID through src/domain/secrets.ts.
      subjectLabel: "finalization-canary",
      subjectKind: "ordinary",
      why: "The common case and the one §4f2's named canary exists for: an unfinalized RRSS document "
        + "for a subject with one active UCPath job, rehearsed once its termination has been filed by "
        + "the UCPath filing ② so that the transaction number the finalization stages actually exists. "
        + "Until then the registry declares that number `pending` and this case is `blocked` by name.",
      nodesReached: [...FULL_PATH],
      // Nothing sits downstream of the transaction node in this graph, so the
      // "it did more than expected" half is carried by the zero deltas and by
      // `staged: true` meaning staged-and-read-back rather than saved.
      nodesExcluded: [],
      checkpoints: [...EXPECTED_CHECKPOINTS],
      gateResults: [IDENTITY_GATE],
      durableDeltas: NO_WRITES,
      receipt: {
        result: "partial",
        confidence: "unknown",
        verification: PREVIEW_RECEIPT_VERIFICATION,
      },
      terminal: {
        lifecycle: "done",
        resultSchema: "RunDryRunPreviewResultSchema",
        kind: "dry-run-preview",
        externalCommit: "none",
        stoppedAtNodeId: TRANSACTION_NODE,
      },
      preview: { outcome: "would-prepare", subject: "match", staged: true },
    },
  ],
};

/** Recursively frozen at module load, like every registry export in this tree. */
export const SEPARATIONS_KUALI_FINALIZATION_DRY_RUN: DryRunScenarioManifest =
  parseDryRunScenarioManifest(MANIFEST);
