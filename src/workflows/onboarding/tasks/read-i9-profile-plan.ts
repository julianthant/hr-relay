import { defineTask } from "../../../workflow-kit/task.js";
import { OnboardingReadI9ProfilePlan } from "../../../models/workflows/onboarding/i9-profile.js";
import { readI9ProfilePlan } from "../../../rules/onboarding/i9-profile.js";
import type { JsonValue } from "../../../rules/validation/canonical-json.js";

export const readI9ProfilePlanTask = defineTask(OnboardingReadI9ProfilePlan, {
  sessions: [],
  async run({ input, ctx }) {
    const output = readI9ProfilePlan(input);
    ctx.recordData(Object.entries<JsonValue>(output).map(([field, value]) => ({ direction: "read" as const, field, value })));
    return output;
  },
});
