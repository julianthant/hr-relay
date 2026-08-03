import { defineTask } from "../../../base/task.js";
import {
  CrmReadOnboardingDates,
  ReadOnboardingDatesOutputSchema,
} from "../../../domain/contracts/crm/read-onboarding-dates.js";
import { crmDriver } from "../driver/declaration.js";

/** Ported semantic operation: legacy 793abe1, src/systems/crm/onboarding-records.ts. */
export const readOnboardingDatesTask = defineTask(crmDriver, CrmReadOnboardingDates, {
  sessions: [{ system: "crm", access: "read", session: "reuse-worker" }],
  retry: { attempts: 2, backoffMs: 2_000, retryOn: "transient" },
  async run({ input, ctx }) {
    return ReadOnboardingDatesOutputSchema.parse(await ctx.driver.readOnboardingDates(input));
  },
});
