import { defineTask } from "../../../workflow-kit/task.js";
import { OnboardingReadWritePlan } from "../../../models/workflows/onboarding/read-write-plan.js";
import { ERROR_CATALOG } from "../../../models/failures/error-catalog.js";
import { readOnboardingWritePlan } from "../../../rules/onboarding/write-plan.js";
export const readWritePlanTask = defineTask(OnboardingReadWritePlan, {
  sessions: [],
  async run({ input, ctx }) {
    try {
      const output = readOnboardingWritePlan(input);
      ctx.recordData([{ direction: "read", field: "roster", value: output.roster }, { direction: "read", field: "hire", value: output.hire }, { direction: "read", field: "i9", value: output.i9 },
        { direction: "read", field: "subject", value: output.subject }, { direction: "read", field: "comments", value: output.comments }]);
      return output;
    } catch (cause) { return ctx.fail("ONBOARDING_WRITE_REVIEW_REFUSED", ERROR_CATALOG.ONBOARDING_WRITE_REVIEW_REFUSED.text, { cause }); }
  },
});
