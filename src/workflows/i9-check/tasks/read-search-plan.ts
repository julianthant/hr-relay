import { defineTask } from "../../../workflow-kit/task.js";
import { ReadSearchPlan } from "../../../models/workflows/i9-check/check.js";

export const readSearchPlanTask = defineTask(ReadSearchPlan, {
  sessions: [], async run({ input, ctx }) {
    const useMatch = input.person.firstName !== undefined && input.person.lastName !== undefined
      && (input.person.dob !== undefined || input.person.ssn !== undefined);
    ctx.recordData({ direction: "read", field: "useMatch", value: useMatch });
    return { useMatch };
  },
});
