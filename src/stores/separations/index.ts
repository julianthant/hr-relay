import { defineWorkflowStore } from "../../base/store.js";
import { matchDepartmentOptionTask } from "./tasks/match-department-option.js";
import { matchIdentityTask } from "./tasks/match-identity.js";
import { matchTerminationTypeTask } from "./tasks/match-termination-type.js";
import { matchActiveEmploymentTask } from "./tasks/match-active-employment.js";
import { matchSeparationSubjectTask } from "./tasks/match-separation-subject.js";
import { readSeparationDatesTask } from "./tasks/read-separation-dates.js";
import { readSeparationPlanTask } from "./tasks/read-separation-plan.js";
import { verifyIdentityApprovalTask } from "./tasks/verify-identity-approval.js";
import { verifyTerminationReceiptTask } from "./tasks/verify-termination-receipt.js";

/**
 * The `separations` pure workflow mini-store (`separations.md` §2.5):
 * sessionless, artifact-free, provider-free folds over facts a run already
 * read. Chunk 6's composition completes it — the date reconciliation, the
 * comment builders, the Kronos window computation, the S18/S19 subject fork,
 * S23/S24's employment selection and D130's receipt check all land here, beside
 * the termination-type resolution, the identity packet and the department fold
 * the earlier chunks left.
 *
 * Every one of them is a pure decision that can REFUSE, which is why each is a
 * task rather than a `derive`: a task has a durable `FailureRecord.code` and a
 * `derive` has only a thrown string.
 */
export const separationsStore = defineWorkflowStore("separations", {
  resolveTerminationType: matchTerminationTypeTask,
  matchIdentity: matchIdentityTask,
  verifyIdentityApproval: verifyIdentityApprovalTask,
  matchDepartmentOption: matchDepartmentOptionTask,
  readSeparationPlan: readSeparationPlanTask,
  matchSeparationSubject: matchSeparationSubjectTask,
  matchActiveEmployment: matchActiveEmploymentTask,
  readSeparationDates: readSeparationDatesTask,
  verifyTerminationReceipt: verifyTerminationReceiptTask,
});
