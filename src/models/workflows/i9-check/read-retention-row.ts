import { z } from "zod";
import { taskId } from "../../../rules/identity/ids.js";
import { defineTaskContract } from "../../task/task-contract.js";
import { SearchPersonOrgOutputSchema } from "../../systems/ucpath/search-person-org.js";
import { I9CheckCanonicalInput } from "./input.js";
import { I9_CHECK_TASK_POLICY, I9CheckRowSchema, I9IdentitySchema } from "./check.js";

export const ReadRetentionRow = defineTaskContract({
  ...I9_CHECK_TASK_POLICY, id: taskId("workflow:i9-check/read-retention-row"), title: "Match roster and derive retention",
  input: z.strictObject({ input: I9CheckCanonicalInput, initial: I9IdentitySchema, search: SearchPersonOrgOutputSchema.optional() }),
  output: z.strictObject({ identity: I9IdentitySchema, row: I9CheckRowSchema }),
  example: { identity: { status: "not-found", candidateCount: 0 }, row: {
    recordId: "record-1", employeeName: "Example, Person", ppsEid: "", ucpathEmplId: "", hireDate: "",
    separationDate: "", foundInUcpath: "Not found in UCPath", action: "Shred", reviewerName: "Example Reviewer", notes: "",
  } },
});
