import { defineTask } from "../../../workflow-kit/task.js";
import { OnboardingReadHirePlan } from "../../../models/workflows/onboarding/read-hire-plan.js";
import { readHirePlan } from "../../../rules/onboarding/read-hire-plan.js";
import { RosterNameUnresolvedError } from "../../../rules/onboarding/roster-name.js";

export const readHirePlanTask = defineTask(OnboardingReadHirePlan, {
  sessions: [],
  async run({ input, ctx }) {
    let output;
    try { output = readHirePlan(input); } catch (cause) {
      if (cause instanceof RosterNameUnresolvedError) return ctx.fail("ONBOARDING_NAME_UNRESOLVED",
        "Relay cannot tell the first, middle and last name apart in this person's roster Legal Name or Lived Name. Write it in the roster as Last, First Middle, or add the middle name to the CRM record, then run again.", { cause });
      return ctx.fail("ONBOARDING_DATA_INVALID", "CRM hire data failed validation. Review the source fields and run overrides.", { cause });
    }
    ctx.recordData(Object.entries(output).map(([field, value]) => ({ direction: "read" as const, field, value })));
    return output;
  },
});
