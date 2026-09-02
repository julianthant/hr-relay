import { defineWorkflowRole } from "../../../domain/workflow/module-role.js";
import { separationsStore } from "../../../stores/separations/index.js";
import { ucpathStore } from "../../../stores/ucpath/index.js";
import { separationsIdentityCheckDescriptor } from "./descriptor.js";
import { IDENTITY_CHECK_STEP } from "./step.js";

/**
 * The server composition value. Two stores: the UCPath browser store for both
 * page visits, and the `separations` pure mini-store for the comparison fold and
 * the identity authority check — the second contributes no browser session by
 * construction, which lets a name-only run park at the gate owning nothing.
 */
export const separationsIdentityCheckModule = Object.freeze({
  descriptor: separationsIdentityCheckDescriptor,
  stores: Object.freeze([ucpathStore, separationsStore]),
  // A proving harness for one step of `separations`, never a peer workflow (D219) —
  // the step it proves is the folder it lives in, read from that folder's own
  // declaration rather than re-typed here (D265 §1.2.2 rule 3).
  role: defineWorkflowRole({ kind: "chunk-harness", of: "separations", step: IDENTITY_CHECK_STEP.key }),
});
