import { defineTask } from "../../../workflow-kit/task.js";
import { OnboardingReadI9Lookup } from "../../../models/workflows/onboarding/read-i9-lookup.js";
import { readOnboardingI9Lookup } from "../../../rules/onboarding/i9-profile.js";
import type { JsonValue } from "../../../rules/validation/canonical-json.js";

export const readI9LookupTask = defineTask(OnboardingReadI9Lookup, {
  sessions: [],
  async run({ input, ctx }) {
    let output;
    try { output = readOnboardingI9Lookup(input); } catch (cause) {
      return ctx.fail("ONBOARDING_I9_LOOKUP_UNRESOLVED", "The delegated I-9 lookup did not establish a result for this hire. No profile will be created.", { cause });
    }
    ctx.recordData(Object.entries<JsonValue>(output).map(([field, value]) => ({ direction: "read" as const, field, value })));
    return output;
  },
});
