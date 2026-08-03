import { defineTask } from "../../../base/task.js";
import {
  CrmReadOnboardingDates,
  ReadOnboardingDatesOutputSchema,
} from "../../../domain/contracts/crm/read-onboarding-dates.js";
import {
  CrmSubjectBindingSchema,
} from "../../../domain/ui/crm-onboarding.js";
import { crmDriver } from "../declaration.js";

/** Ported semantic operation: legacy 793abe1, src/systems/crm/onboarding-records.ts. */
export const readOnboardingDatesTask = defineTask(crmDriver, CrmReadOnboardingDates, {
  sessions: [{ system: "crm", access: "read", session: "reuse-worker" }],
  retry: { attempts: 2, backoffMs: 2_000, retryOn: "transient" },
  async run({ input, ctx }) {
    const read = await ctx.driver.readOnboardingDates(input);
    const parsedBinding = CrmSubjectBindingSchema.safeParse(read.binding);
    if (!parsedBinding.success) {
      return ctx.fail(
        "subject-mismatch",
        `CRM onboarding dates returned an invalid subject binding for EID ${input.eid}`,
        { subject: input.eid },
      );
    }
    const binding = parsedBinding.data;
    const bindingEid = binding.state === "displayed-record" ? binding.observedEid : binding.queriedEid;
    if (binding.expectedEid !== input.eid || bindingEid !== input.eid) {
      return ctx.fail(
        "subject-mismatch",
        `CRM onboarding dates expected EID ${input.eid} but bound ${bindingEid} as ${binding.state}`,
        { subject: input.eid },
      );
    }
    const output = ReadOnboardingDatesOutputSchema.parse(read.output);
    if (binding.state === "absent-query"
      && [output.invitedOn, output.startsOn, output.completedOn]
        .some(({ state }) => state === "present")) {
      return ctx.fail(
        "subject-mismatch",
        `CRM onboarding dates reported values for EID ${input.eid} after proving the query absent`,
        { subject: input.eid },
      );
    }
    if (output.emplId !== input.eid) {
      return ctx.fail(
        "subject-mismatch",
        `CRM onboarding dates for EID ${input.eid} returned output for ${output.emplId}`,
        { subject: input.eid },
      );
    }
    return output;
  },
});
