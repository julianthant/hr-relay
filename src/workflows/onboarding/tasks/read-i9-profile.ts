import { defineTask } from "../../../workflow-kit/task.js";
import { OnboardingReadI9Lookup, OnboardingReadI9ProfilePlan } from "../../../models/workflows/onboarding/i9-profile.js";
import { readOnboardingI9Lookup, readI9ProfilePlan } from "../../../rules/onboarding/i9-profile.js";

export const readI9LookupTask = defineTask(OnboardingReadI9Lookup, {
  sessions: [],
  async run({ input, ctx }) {
    let output;
    try { output = readOnboardingI9Lookup(input); } catch (cause) {
      return ctx.fail("ONBOARDING_I9_LOOKUP_UNRESOLVED", "The delegated I-9 lookup did not establish a result for this hire. No profile will be created.", { cause });
    }
    ctx.recordData(Object.entries(output).map(([field, value]) => ({ direction: "read" as const, field, value })));
    return output;
  },
});

export const readI9ProfilePlanTask = defineTask(OnboardingReadI9ProfilePlan, {
  sessions: [],
  async run({ input, ctx }) {
    const output = readI9ProfilePlan(input);
    ctx.recordData(Object.entries(output).map(([field, value]) => ({ direction: "read" as const, field, value })));
    return output;
  },
});
