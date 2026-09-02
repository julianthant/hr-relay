/**
 * D265 §1.2.2 rule 2 — the *UCPath transaction* step's node fragments, in ref
 * write-safety's order: the pending-termination sweep (S30/S31 — legacy's first
 * mutation, unfenced and unverified), the termination filing itself, and the
 * receipt check that binds `(transactionNumber, approvalStatus)` as a PAIR
 * (D130 proved a **Denied** transaction carries a well-formed `T…`).
 *
 * A fragment owns a node's IDENTITY — id, contracts, label and, for a
 * transaction, its whole write policy (dry-run shape, probe policy, the
 * probe-to-fence budget) — and takes its WIRING (`dependsOn` + the binds) from
 * the graph that applies it (see `src/base/flow.ts`, "node fragments"). The
 * composition binds the filing from the reconciled folds; the harness in this
 * folder binds it from its own ingress (rule 3).
 */
import { defineWorkflowStepNodeFactory } from "../../../base/flow.js";
import { SWEEP_NODE, TERMINATION_NODE, RECEIPT_NODE } from "./node-ids.js";
import { SeparationsVerifyTerminationReceipt } from "../../../domain/contracts/separations/verify-termination-receipt.js";
import { UcpathCreateTermination } from "../../../domain/contracts/ucpath/create-termination.js";
import { UcpathDeletePendingTerminations } from "../../../domain/contracts/ucpath/delete-pending-terminations.js";
import { UcpathStagePendingTerminationSweep } from "../../../domain/contracts/ucpath/stage-pending-termination-sweep.js";
import { UcpathStageTermination } from "../../../domain/contracts/ucpath/stage-termination.js";
import { UCPATH_TRANSACTION_STEP } from "./step.js";
import { UCPATH_TRANSACTION_OMISSION } from "./omission.js";


const nodes = defineWorkflowStepNodeFactory(UCPATH_TRANSACTION_STEP);

/**
 * `probePolicy: "always"`: the sweep's probe is one page read that the
 * termination's probe needs anyway, and paying it on the first attempt too is
 * what closes the crash window before the first fence.
 *
 * Budget measured live 2026-08-13 (§9.7): probe search open 4.6 s + search run
 * 7.4 s + detail 4.9 s ≈ 17 s to read the grid, then the selection itself is
 * checkbox clicks. 90 s is ~5x that, and short enough that a stalled page
 * loses its selection rather than deleting on a stale probe.
 */
export const clearPendingNode = nodes.transaction(SWEEP_NODE, {
  label: "Clear Pending Terminations",
  prepare: UcpathStagePendingTerminationSweep,
  commit: UcpathDeletePendingTerminations,
  dryRun: "stop-after-prepare",
  probePolicy: "always",
  probeToFenceMaxMs: 90_000,
});

/**
 * The real HR write. Budget measured live 2026-08-13 (§9.7): ≈32.4 s of live
 * wizard staging on top of ≈17 s of probe, and 120 s is ~3.7x that.
 */
export const fileTerminationNode = nodes.transaction(TERMINATION_NODE, {
  label: "File Termination",
  prepare: UcpathStageTermination,
  commit: UcpathCreateTermination,
  dryRun: "stop-after-prepare",
  probePolicy: "always",
  probeToFenceMaxMs: 120_000,
});

/**
 * `always-rerun`, for `approval`'s reason: this node's job is to CHECK a proof,
 * and a replayed checkpoint would be the previous check's answer standing in
 * for the check. It is a pure fold over a durable proof, so re-running it costs
 * nothing and reaches no browser.
 */
export const receiptNode = nodes.task(RECEIPT_NODE, SeparationsVerifyTerminationReceipt, {
  label: "Termination Receipt",
  replay: "always-rerun",
});

/** The step's timeline category — key and label from `step.ts`, nodes from the fragments above. */
export const UCPATH_TRANSACTION_STEP_NODES = nodes.category([
  clearPendingNode,
  fileTerminationNode,
  receiptNode,
], { omission: UCPATH_TRANSACTION_OMISSION });
export { SWEEP_NODE, TERMINATION_NODE, RECEIPT_NODE } from "./node-ids.js";
