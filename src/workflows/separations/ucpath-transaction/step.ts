/**
 * D265 §1.2.2 rule 2 — this folder IS one declared step of `separations`'
 * timeline, and this file is where the step's name is written once.
 *
 * The write half in UCPath — the pending-termination sweep, the termination itself, and the receipt. Legacy's standalone transaction-check folds in here: the pending check is the sweep transaction plus the in-write probes, not a step.
 *
 * The composition (`../descriptor.ts`) spreads this pair into its `timeline`
 * entry and adds the nodes; the harness in this folder reads `.key` for its
 * `chunk-harness.step`. Nobody re-types either string.
 */
import { defineWorkflowStep } from "../../../base/workflow.js";

export const UCPATH_TRANSACTION_STEP = defineWorkflowStep({
  key: "ucpath-transaction",
  label: "UCPath transaction",
});
