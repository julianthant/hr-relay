import { defineWorkflowStore } from "../../base/store.js";
import { matchIdentityTask } from "./tasks/match-identity.js";
import { matchTerminationTypeTask } from "./tasks/match-termination-type.js";
import { verifyIdentityApprovalTask } from "./tasks/verify-identity-approval.js";

/**
 * The `separations` pure workflow mini-store (`separations.md` §2.5):
 * sessionless, artifact-free, provider-free folds over facts a run already
 * read. Date reconciliation, the comment builders, the Kronos window
 * computation and the name-similarity classification land here as their chunks
 * are built; the termination-type resolution is the first, because §4a's
 * refusal has to exist before anything can consume a Kuali separation document.
 */
export const separationsStore = defineWorkflowStore("separations", {
  resolveTerminationType: matchTerminationTypeTask,
  matchIdentity: matchIdentityTask,
  verifyIdentityApproval: verifyIdentityApprovalTask,
});
