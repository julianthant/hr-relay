/**
 * The T1b dry-run scenario manifest shape (ref guards-and-tests §10.4).
 *
 * A dry-run scenario is a DECLARATION, not a test file: it is
 * `tests/scenario/workflows/<workflow-id>/dry-run.scenario.ts`, it is
 * deliberately not named `.test.` so no vitest project can collect it, and it
 * is executed by `npm run cli -- dry-run-scenario <workflow> --subject <label>`
 * against the real systems. This module is its TYPE and nothing else — no
 * runner, no assertions, no defaults. A manifest that silently acquired a
 * default would be a manifest asserting something nobody wrote down, which is
 * the failure mode §10.4's double-entry exists to prevent.
 *
 * Everything is `readonly`, and each field is deliberately narrow:
 *
 * - the three durable deltas are the literal `0`, so "we relaxed the no-write
 *   proof" cannot be spelled at all rather than merely being noticed in review;
 * - the receipt's `confidence` omits `verified` and its `result` omits
 *   `verified-done`, because a REHEARSAL never earns them (D237/D238) and a
 *   manifest that could claim them would be the wrong kind of unrepresentable;
 * - the terminal is a union whose `failed` arm must NAME the open item that
 *   makes it the honest expectation, so a case expecting red cannot pass for a
 *   case expecting green.
 *
 * Subjects are named by LABEL only. The value of a label lives outside git —
 * `config/test-subjects.json` for the non-sensitive half, `.env` through
 * `src/domain/secrets.ts` for a real person's identifier (§10.5) — and a label
 * the runner cannot resolve makes its case `blocked: needs <label>`, never
 * `failed`.
 */

/** What a subject is FOR — the case dimension, not the person (§10.5). */
export type DryRunSubjectKind =
  | "ordinary"
  | "already-present"
  | "no-active-job"
  | "ambiguous-name"
  | "subject-mismatch"
  | "name-differs"
  | "concurrent-jobs";

/**
 * One `run_checkpoints` row the run must have written, keyed the way authority
 * keys it (D214/D221). `keyedBy` is the assertion that the row is addressed by
 * the STABLE tuple rather than by position — `claimGeneration` appears only for
 * a node whose row is generation-scoped.
 */
export interface DryRunCheckpointExpectation {
  readonly node: string;
  readonly attempt: number;
  readonly keyedBy: readonly ("workflow" | "item" | "node" | "attempt" | "claimGeneration")[];
}

/**
 * The `gate_results` row a gated workflow must produce. `envelope.dryRun` does
 * not skip a gate: the rehearsal takes a REAL approval through the real command
 * endpoint, so this row is real evidence (D202/D203/D204).
 */
export interface DryRunGateExpectation {
  readonly gate: string;
  readonly decision: string;
  readonly resolvedBy: string;
  /** The decision leaf the operator must click, named as the surface names it. */
  readonly leaf: string;
}

/** One node's row in the receipt's verification table. */
export interface DryRunVerificationExpectation {
  readonly node: string;
  readonly verdict: "present" | "absent" | "unknown" | "ambiguous";
  readonly mandatory: boolean;
}

/** A declared cross-source obligation and the verdict the rehearsal must reach. */
export interface DryRunObligationExpectation {
  readonly obligation: string;
  readonly verdict: "met" | "unmet" | "unknown";
  readonly why: string;
}

/**
 * The receipt shape `buildRunEvidenceReceipt` must derive. `verified` and
 * `verified-done` are absent from both unions on purpose: a rehearsal derives
 * `partial` / `unknown` and never `verified` (§10.4).
 */
export interface DryRunReceiptExpectation {
  readonly result: "partial" | "done-with-warnings" | "failed" | "cancelled";
  readonly confidence: "partial" | "unknown";
  readonly verification: readonly DryRunVerificationExpectation[];
  readonly obligations: readonly DryRunObligationExpectation[];
}

/**
 * The preview terminal. A dry run DOES reach a durable terminal state, and the
 * manifest says which — including that `run_results` is bound to
 * `RunDryRunPreviewResultSchema`'s OWN schema hash and never the descriptor's
 * declared result hash, so a preview can never be read as a completed workflow.
 *
 * The `failed` arm exists because §10.4 records one as-built defect:
 * `TransactionDryRunPreviewSchema`'s `subject: { state: "mismatch" }` arm is
 * unreachable — `executeDryRun` wraps any binding-proof failure into a generic
 * error — so a mismatch case must expect `failed` today, WITH the reason and
 * the open item named, until the arm is either reached or removed.
 */
export type DryRunTerminalExpectation =
  | {
    readonly lifecycle: "done";
    readonly resultSchema: "RunDryRunPreviewResultSchema";
    readonly kind: "dry-run-preview";
    readonly externalCommit: "none";
    readonly stoppedAtNodeId: string;
  }
  | {
    readonly lifecycle: "failed";
    readonly reason: string;
    /** What must change for this case to expect `done` — never left implicit. */
    readonly openItem: string;
  };

/**
 * Which arm the transaction settled to, and why (D215). `already-present` names
 * whether beat ①'s durable lookup or its live probe settled first;
 * `would-prepare` is the arm a real run would have fenced from, and it reports
 * the observed subject on its `transaction.previewed` span — `not-observed`
 * when nothing was staged, which is D215's rule from the other side.
 */
export type DryRunPreviewExpectation =
  | {
    readonly outcome: "would-prepare";
    readonly subject: "match" | "not-observed";
    readonly staged: boolean;
  }
  | {
    readonly outcome: "already-present";
    readonly proofSource: "durable-intent" | "live-probe";
  }
  | {
    readonly outcome: "not-reached";
    readonly reason: string;
  };

/** The three counts §10.4 asserts as a DELTA across the run, all of them zero. */
export interface DryRunDurableDeltas {
  readonly writeIntents: 0;
  readonly writeAttempts: 0;
  readonly durableOutbox: 0;
}

/** One case: one subject LABEL, one kind, and everything it must produce. */
export interface DryRunScenarioCase {
  readonly caseId: string;
  readonly subjectLabel: string;
  readonly subjectKind: DryRunSubjectKind;
  /** Why this subject kind is a case this workflow must handle. */
  readonly why: string;
  /** The node ids the run must reach, in order. */
  readonly nodesReached: readonly string[];
  /** The node ids the run must NOT reach — "it did more" is the interesting half. */
  readonly nodesExcluded: readonly string[];
  readonly checkpoints: readonly DryRunCheckpointExpectation[];
  readonly gateResults: readonly DryRunGateExpectation[];
  readonly durableDeltas: DryRunDurableDeltas;
  readonly receipt: DryRunReceiptExpectation;
  readonly terminal: DryRunTerminalExpectation;
  readonly preview: DryRunPreviewExpectation;
}

export interface DryRunScenarioManifest {
  readonly scenarioId: string;
  readonly workflow: string;
  /** The transaction node whose arm every case reports. */
  readonly transactionNode: string;
  /** The doc section this manifest is the executable form of. */
  readonly recordedBy: string;
  readonly cases: readonly DryRunScenarioCase[];
}
