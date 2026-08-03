import { defineTask } from "../../../base/task.js";
import {
  CrmReadOnboardingRecord,
  ReadOnboardingRecordOutputSchema,
} from "../../../domain/contracts/crm/read-onboarding-record.js";
import { crmDriver } from "../driver/declaration.js";

/** Ported semantic operation: legacy 793abe1, src/systems/crm/onboarding-records.ts. */
export const readOnboardingRecordTask = defineTask(crmDriver, CrmReadOnboardingRecord, {
  sessions: [{ system: "crm", access: "read", session: "reuse-worker" }],
  retry: { attempts: 2, backoffMs: 2_000, retryOn: "transient" },
  async run({ input, ctx }) {
    return ReadOnboardingRecordOutputSchema.parse(await ctx.driver.readOnboardingRecord(input));
  },
});
