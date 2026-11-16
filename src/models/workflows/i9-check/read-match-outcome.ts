import { z } from "zod";
import { taskId } from "../../../rules/identity/ids.js";
import { defineTaskContract } from "../../task/task-contract.js";
import { SearchPersonMatchOutputSchema } from "../../systems/ucpath/search-person-match.js";
import { I9_CHECK_TASK_POLICY, I9IdentitySchema } from "./check.js";

export const ReadMatchOutcome = defineTaskContract({
  ...I9_CHECK_TASK_POLICY, id: taskId("workflow:i9-check/read-match-outcome"), title: "Resolve identifier match",
  input: z.strictObject({ match: SearchPersonMatchOutputSchema.optional() }),
  output: z.strictObject({ identity: I9IdentitySchema, shouldLookup: z.boolean() }),
  example: { identity: { status: "not-found", candidateCount: 0 }, shouldLookup: true },
});
