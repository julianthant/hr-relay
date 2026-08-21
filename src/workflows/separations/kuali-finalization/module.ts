/**
 * The server composition value for `separations-kuali-finalization`: the
 * bundle-safe descriptor plus the three stores that implement every contract it
 * names — `ucpath` for the two identity reads, `kuali` for the transaction's
 * prepare/commit (and the probe and verifier its `writeSafety` points at), and
 * the pure `separations` mini-store for the identity comparison, the approval
 * check and §4e's department-option fold.
 */
import { defineWorkflowRole } from "../../../domain/workflow/module-role.js";
import { kualiStore } from "../../../stores/kuali/index.js";
import { separationsStore } from "../../../stores/separations/index.js";
import { ucpathStore } from "../../../stores/ucpath/index.js";
import { separationsKualiFinalizationDescriptor } from "./descriptor.js";
import { KUALI_FINALIZATION_STEP } from "./step.js";

export const separationsKualiFinalizationModule = Object.freeze({
  descriptor: separationsKualiFinalizationDescriptor,
  stores: Object.freeze([kualiStore, ucpathStore, separationsStore]),
  // A proving harness for one step of `separations`, never a peer workflow (D219) —
  // the step it proves is the folder it lives in, read from that folder's own
  // declaration rather than re-typed here (D265 §1.2.2 rule 3).
  role: defineWorkflowRole({ kind: "chunk-harness", of: "separations", step: KUALI_FINALIZATION_STEP.key }),
});
