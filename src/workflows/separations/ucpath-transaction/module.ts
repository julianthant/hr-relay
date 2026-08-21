/**
 * The server composition value for `separations-ucpath-termination`: the
 * bundle-safe descriptor plus the two stores that implement every contract it
 * names — `ucpath` for the reads and both transactions, and the pure
 * `separations` mini-store for the two folds (identity match, §4a's map).
 */
import { defineWorkflowRole } from "../../../domain/workflow/module-role.js";
import { separationsStore } from "../../../stores/separations/index.js";
import { ucpathStore } from "../../../stores/ucpath/index.js";
import { separationsUcpathTerminationDescriptor } from "./descriptor.js";
import { UCPATH_TRANSACTION_STEP } from "./step.js";

export const separationsUcpathTerminationModule = Object.freeze({
  descriptor: separationsUcpathTerminationDescriptor,
  stores: Object.freeze([ucpathStore, separationsStore]),
  // A proving harness for one step of `separations`, never a peer workflow (D219) —
  // the step it proves is the folder it lives in, read from that folder's own
  // declaration rather than re-typed here (D265 §1.2.2 rule 3).
  role: defineWorkflowRole({ kind: "chunk-harness", of: "separations", step: UCPATH_TRANSACTION_STEP.key }),
});
