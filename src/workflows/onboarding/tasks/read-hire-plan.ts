import { defineTask } from "../../../workflow-kit/task.js";
import { OnboardingReadHirePlan } from "../../../models/workflows/onboarding/read-hire-plan.js";
import { readHirePlan } from "../../../rules/onboarding/read-hire-plan.js";

export const readHirePlanTask = defineTask(OnboardingReadHirePlan, {
  sessions: [],
  async run({ input, ctx }) {
    let output;
    try { output = readHirePlan(input); } catch (cause) {
      return ctx.fail("ONBOARDING_DATA_INVALID", "CRM hire data failed validation. Review the source fields and run overrides.", { cause });
    }
    ctx.recordData(Object.entries(output).map(([field, value]) => ({ direction: "read" as const, field, value })));
    return output;
  },
});
