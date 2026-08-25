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
 * `.env` through `src/domain/secrets.ts` for a real EID (§10.5). A label the
 * registry cannot resolve makes its case `blocked: needs <label>`, never
 * `failed`, because a canary that left the university is not a defect in this
 * workflow (§9.16 recorded exactly that happening twice).
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
 * never verified*. The `would-prepare` cases re-open the document after the
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
 * `replay: "always-rerun"` and therefore owns no reusable row, and the
 * transaction node writes none on a rehearsal — which is the `durableDeltas`
 * assertion from the other side.
 */
const READ_CHECKPOINTS = READ_NODES.map((node) => ({
  node,
  attempt: 1,
  keyedBy: ["workflow", "item", "node", "attempt", "claimGeneration"] as const,
}));

/** Zero, as a delta measured BEFORE and AFTER: the database legitimately holds
 * rows from earlier real proofs, so an absolute count would be false. */
const NO_WRITES = { writeIntents: 0, writeAttempts: 0, durableOutbox: 0 } as const;

/** The gate is unconditional here (§4d): no preset, prefill, resume path or run
 * mode disables it, and `envelope.dryRun` is not an exception. */
const IDENTITY_GATE = {
  gate: GATE_NODE,
  decision: "approved",
  resolvedBy: "local-operator",
  leaf: "resolve-gate-approved",
} as const;

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
        + "for a subject with one active UCPath job, whose termination has already been filed, so the "
        + "transaction number the finalization stages actually exists.",
      nodesReached: [...FULL_PATH],
      // Nothing sits downstream of the transaction node in this graph, so the
      // "it did more than expected" half is carried by the zero deltas and by
      // `staged: true` meaning staged-and-read-back rather than saved.
      nodesExcluded: [],
      checkpoints: [...READ_CHECKPOINTS],
      gateResults: [IDENTITY_GATE],
      durableDeltas: NO_WRITES,
      receipt: {
        result: "partial",
        confidence: "partial",
        verification: [
          { node: TRANSACTION_NODE, verdict: "absent", mandatory: true },
        ],
        obligations: [
          {
            obligation: "kuali-finalization-reload-read-back",
            verdict: "unknown",
            why: "A rehearsal stages and reads back the staged form; only a real save can be "
              + "verified by reloading the document, so the landing proof is UNRESOLVED rather "
              + "than absent — and that is what forbids `verified` (D237/D238).",
          },
        ],
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
    {
      caseId: "already-finalized",
      subjectLabel: "finalization-already-finalized",
      subjectKind: "already-present",
      why: "A document already carrying THIS finalization against THIS transaction number. Beat ①'s "
        + "probe settles it before anything is staged, which is the arm D215 requires a rehearsal to "
        + "reach first — a preview that skipped beat ① would fail on the ordinary subject instead.",
      nodesReached: [...FULL_PATH],
      nodesExcluded: [],
      checkpoints: [...READ_CHECKPOINTS],
      gateResults: [IDENTITY_GATE],
      durableDeltas: NO_WRITES,
      receipt: {
        result: "partial",
        confidence: "partial",
        verification: [
          { node: TRANSACTION_NODE, verdict: "present", mandatory: true },
        ],
        obligations: [
          {
            obligation: "kuali-finalization-reload-read-back",
            verdict: "met",
            why: "The probe read the finalization off the document itself, so the obligation is "
              + "discharged by observation — and `already-present` still never means WE filed it.",
          },
        ],
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
    {
      caseId: "no-active-job",
      subjectLabel: "finalization-no-active-job",
      subjectKind: "no-active-job",
      why: "The refusal that must land BEFORE a human is asked: UCPath shows no active employment, so "
        + "`comparison` refuses and the gate is never opened. Live-proved once already — §9.17 item 2, "
        + "run `ee9824f7`, `NO_ACTIVE_EMPLOYMENT` — and this case is what keeps it proved.",
      nodesReached: [...READ_NODES],
      nodesExcluded: [GATE_NODE, APPROVAL_NODE, TRANSACTION_NODE],
      checkpoints: [...READ_CHECKPOINTS],
      gateResults: [],
      durableDeltas: NO_WRITES,
      receipt: {
        result: "failed",
        confidence: "unknown",
        verification: [],
        obligations: [
          {
            obligation: "kuali-finalization-reload-read-back",
            verdict: "unknown",
            why: "The write node was never reached, so nothing observed the document at all.",
          },
        ],
      },
      terminal: {
        lifecycle: "failed",
        reason: "`comparison` refuses `NO_ACTIVE_EMPLOYMENT` before the gate, so the run has no "
          + "preview to settle: a refusal ahead of the gate is a failed run, not a rehearsal.",
        openItem: "None — this arm is correct as built. It expects `failed` because failing is the "
          + "right outcome here, not because something is unfinished.",
      },
      preview: {
        outcome: "not-reached",
        reason: "The transaction node is downstream of the gate, and the gate was never opened.",
      },
    },
    {
      caseId: "subject-mismatch",
      subjectLabel: "finalization-subject-mismatch",
      subjectKind: "subject-mismatch",
      why: "A document whose displayed EID is not the approved subject's. Ref write-safety beat ③ is the "
        + "last thing that can stop this write, and a rehearsal must exercise it too — the whole point "
        + "of staging on a POOLED page is that the page can move underneath the run.",
      nodesReached: [...FULL_PATH],
      nodesExcluded: [],
      checkpoints: [...READ_CHECKPOINTS],
      gateResults: [IDENTITY_GATE],
      durableDeltas: NO_WRITES,
      receipt: {
        result: "failed",
        confidence: "unknown",
        verification: [
          { node: TRANSACTION_NODE, verdict: "unknown", mandatory: true },
        ],
        obligations: [
          {
            obligation: "kuali-finalization-reload-read-back",
            verdict: "unknown",
            why: "The binding proof threw before anything was fenced, so nothing was written and "
              + "nothing could be read back.",
          },
        ],
      },
      /*
       * §10.4's recorded as-built defect, carried here rather than left to be
       * discovered on the day somebody runs this case:
       * `TransactionDryRunPreviewSchema`'s `subject: { state: "mismatch" }` arm
       * is UNREACHABLE — `executeDryRun` wraps any binding-proof failure,
       * including a genuine mismatch, into a generic error
       * (`src/core/write-sequencer.ts:1873-1892`), and `state: "mismatch"` is
       * constructed nowhere in `src/` or `tests/`. It is fail-closed rather
       * than dangerous, so this case expects `failed` TODAY, by name.
       */
      terminal: {
        lifecycle: "failed",
        reason: "`executeDryRun` wraps the binding-proof throw into a generic error, so the run "
          + "terminalizes `failed` instead of previewing a refusal.",
        openItem: "`TransactionDryRunPreviewSchema`'s `subject: { state: \"mismatch\" }` arm is "
          + "unreachable (ref guards-and-tests §10.4). When the arm is either reached or removed, this "
          + "case moves to `done` with `preview.subject: \"mismatch\"`, or the arm goes.",
      },
      preview: {
        outcome: "not-reached",
        reason: "The rehearsal threw at the binding proof, so no preview value was produced at all — "
          + "which is exactly the defect the `openItem` above names.",
      },
    },
  ],
};

/** Recursively frozen at module load, like every registry export in this tree. */
export const SEPARATIONS_KUALI_FINALIZATION_DRY_RUN: DryRunScenarioManifest =
  parseDryRunScenarioManifest(MANIFEST);
