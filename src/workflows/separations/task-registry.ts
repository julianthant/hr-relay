import { defineWorkflowStore } from "../../workflow-kit/task-registry.js";
import { matchDepartmentOptionTask } from "./tasks/match-department-option.js";
import { matchIdentityTask } from "./tasks/match-identity.js";
import { matchTerminationTypeTask } from "./tasks/match-termination-type.js";
import { matchActiveEmploymentTask } from "./tasks/match-active-employment.js";
import { matchSeparationSubjectTask } from "./tasks/match-separation-subject.js";
import { readSeparationDatesTask } from "./tasks/read-separation-dates.js";
import { readSeparationPlanTask } from "./tasks/read-separation-plan.js";
import { verifyIdentityApprovalTask } from "./tasks/verify-identity-approval.js";
import { verifyTerminationReceiptTask } from "./tasks/verify-termination-receipt.js";

/** The `separations` pure workflow mini-store (`separations.md` §2.5): sessionless folds over facts already read. Each can REFUSE, so it is a task with a durable code, not a derive. */
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
