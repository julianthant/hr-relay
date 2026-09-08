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
 * dated line in `docs/rebuild/migrations/separations.md` — the line a `PROOF` tick on
 * the tree cites. Its sibling `structural.scenario.test.ts` is the T1a half and
 * asserts nothing about the world; everything here is a world fact and can only
 * be settled by a live rehearsal.
 *
 * **Subjects are LABELS.** No person's identifier appears in this file and none
 * may — and since D300 no document NUMBER does either: the label's value lives
 * outside git entirely. `config/test-data.json` (subjects) commits only the closed
 * reference, and the number itself is read from ignored
 * `config/test-data.local.json` through `src/control/test-data.ts` (D341,
 * §10.5), judged by the same 3-8 digit schema the
 * start box applies. The EID is derived live from that document; none is
 * committed here. Since D284
 * (2026-08-28) the registry holds ONE subject,
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
 * thirteen read/fold nodes, verifies the document-supplied EID against UCPath's
 * actual read-back, skips the inapplicable name-only operator gate without
 * recording a human decision, and reaches the FIRST transaction node. It then
 * reports the settlement the real path would reach and ends the run there
 * (D215). So the run DOES write spans, checkpoints and a real terminal
 * settlement; it writes neither a gate result nor the write-safety family. The
 * three zero deltas assert the latter. `file-termination`, `receipt` and
 * `finalize-kuali` are never entered at all, which `nodesExcluded` asserts from
 * the other side.
 *
 * **Every expectation below was READ FROM AUTHORITY, not composed**, and each
 * has a named source:
 *
 * - **The current node path, checkpoint rows and receipt vocabulary come from
 *   the GRAPH** (`src/workflows/separations/descriptor.ts`, twenty-one runtime
 *   nodes per `descriptorRuntimeNodes`, re-checked 2026-09-02). The earlier
 *   ALWAYS-GATE path was TRANSCRIBED from the 2026-08-27
 *   `dryRun=true` full-chain proof on document 4502 recorded at
 *   `docs/rebuild/migrations/separations.md` §9.27 addendum 7 — run
 *   `fd415e49-54bb-4ccd-bec4-ad1cba94a4f6`, trace `sp-053429-fd41`, terminal
 *   `done` at the D215 preview terminal stopped at `clear-pending`, and
 *   `write_intents` 0 / `write_attempts` 0 / `durable_outbox` 0 read over the
 *   whole database. Its fifteen checkpoint rows remain historical evidence of
 *   the superseded gate/resume path; the current fourteen-row declaration
 *   removes the gate-induced second `timecard-search`. Addendum 7 records only
 *   ONE receipt (`b7e7b603-6099-52d5-a065-27112c289a07`, `partial`, one
 *   warning) with no verification rows of its own; the twenty-row
 *   `PREVIEW_RECEIPT_VERIFICATION` vocabulary below is instead derived from
 *   the graph's twenty-one runtime nodes plus the terminal obligation, as its
 *   own comment states. The current vocabulary marks the condition-false gate
 *   absent and non-mandatory; no operator decision is invented. The older run
 *   remains evidence about the graph before the 2026-09-02 supplied-EID policy
 *   correction, not proof of the corrected path.
 * - **The `preview` arm is a fact about the SUBJECT**, and it comes from
 *   §9.19's row-① finding on 4537 (2026-08-19): "UCPath holds five
 *   transactions for this EID, every one `Approved`, zero `Pending`; the probe
 *   settles `already-present` at beat ①" — combined with the probe's declared
 *   polarity in `src/stores/ucpath/tasks/match-pending-terminations.ts`
 *   (`present` means "there is nothing to sweep", so the sweep settles
 *   `already-present` and clicks nothing) and `clearPendingNode`'s
 *   `probePolicy: "always"` / `dryRun: "stop-after-prepare"`
 *   (`clearPendingNode` in `src/workflows/separations/workflow.ts`). `proofSource`
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
 * conditional name-only identity gate, the identity authority verification,
 * the exact pending-set fold, and the first of three transaction nodes — where
 * D215 stops a rehearsal.
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
const PENDING_SET_NODE = "pending-set";
const TRANSACTION_NODE = "clear-pending";

const FULL_PATH = [...READ_NODES, APPROVAL_NODE, PENDING_SET_NODE, TRANSACTION_NODE] as const;

/**
 * The two transaction nodes downstream of the preview terminal, plus the
 * receipt task that sits between them. A rehearsal that entered ANY of them
 * would have gone past the stop, so naming them is the "it did more than
 * expected" half the zero deltas cannot express on their own.
 */
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

/**
 * The fifteen rows, in the order the evidence collector emits them. The
 * document-supplied path never parks, so `timecard-search` runs once. The
 * `approval` node still uses `always-rerun`: it must re-derive machine authority
 * from current evidence rather than replay a checkpoint across an input/source
 * change.
 */
const EXPECTED_CHECKPOINTS = [
  { node: "resolve-action", attempt: 2, keyedBy: CHECKPOINT_KEY },
  { node: "document", attempt: 2, keyedBy: CHECKPOINT_KEY },
  { node: "plan", attempt: 2, keyedBy: CHECKPOINT_KEY },
  { node: "termination-type", attempt: 2, keyedBy: CHECKPOINT_KEY },
  { node: "name-search", attempt: 2, keyedBy: CHECKPOINT_KEY },
  { node: "subject", attempt: 2, keyedBy: CHECKPOINT_KEY },
  { node: "job-summary", attempt: 2, keyedBy: CHECKPOINT_KEY },
  { node: "employment", attempt: 2, keyedBy: CHECKPOINT_KEY },
  { node: "department-option", attempt: 2, keyedBy: CHECKPOINT_KEY },
  { node: "timecard-search", attempt: 2, keyedBy: CHECKPOINT_KEY },
  { node: "timecard", attempt: 2, keyedBy: CHECKPOINT_KEY },
  { node: "dates", attempt: 2, keyedBy: CHECKPOINT_KEY },
  { node: "comparison", attempt: 2, keyedBy: CHECKPOINT_KEY },
  { node: APPROVAL_NODE, attempt: 2, keyedBy: CHECKPOINT_KEY },
  { node: PENDING_SET_NODE, attempt: 2, keyedBy: CHECKPOINT_KEY },
] as const;

/** Zero, as a delta measured BEFORE and AFTER: the database legitimately holds
 * rows from earlier real proofs, so an absolute count would be false. */
const NO_WRITES = { writeIntents: 0, writeAttempts: 0, durableOutbox: 0 } as const;

/**
 * The receipt service's complete ordered authority vocabulary for a current
 * supplied-EID preview of this graph.
 *
 * Every graph node is present. The conditional gate is `absent` and
 * non-mandatory; the stopped-at transaction and the three nodes downstream of
 * it are `unknown`, as is the terminal result.
 * `unknown` is the load-bearing word: a dry run may never report a write-side
 * obligation as `verified`, because nothing was written to verify. This
 * composition declares no cross-source `write.*`/`identity.*` obligations of
 * its own; its evidence is node-scoped, which is why the list is exactly the
 * twenty-one runtime nodes plus the terminal.
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
  // D318 — the transaction-bearing graph declares the preview arm explicitly.
  arm: "dry-run-preview",
  transactionNode: TRANSACTION_NODE,
  recordedBy: "the 2026-09-02 supplied-EID policy correction and current separations graph; "
    + "docs/rebuild/migrations/separations.md §9.27 addendum 7 remains the historical dryRun=true subject "
    + "evidence from doc 4502, while D284's closed doc 4537 reference remains the registered subject",
  cases: [
    {
      caseId: "nothing-to-sweep",
      // The value lives outside git: config/test-data.json (subjects) names the
      // closed reference and ignored `config/test-data.local.json` carries the
      // number (D300/D341); the ingress is
      // ONE typed document number and every person fact is derived live from
      // it (D261).
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
