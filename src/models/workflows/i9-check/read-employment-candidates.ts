import { z } from "zod";
import { EidSchema, taskId } from "../../../rules/identity/ids.js";
import { defineTaskContract } from "../../task/task-contract.js";
import { SearchPersonOrgOutputSchema } from "../../systems/ucpath/search-person-org.js";
import { I9_CHECK_TASK_POLICY } from "./check.js";

export const I9EmploymentCandidatesSchema = z.array(z.strictObject({
  emplId: EidSchema, name: z.string().min(1), hireDate: z.string(),
}));

export const ReadEmploymentCandidates = defineTaskContract({
  ...I9_CHECK_TASK_POLICY, id: taskId("workflow:i9-check/read-employment-candidates"), title: "Read employment candidates",
  input: z.strictObject({ search: SearchPersonOrgOutputSchema }),
  output: z.strictObject({ candidates: I9EmploymentCandidatesSchema }),
  example: { candidates: [{ emplId: "10000001", name: "Example, Person", hireDate: "06/15/2020" }] },
});
