import { defineTask } from "../../../../workflow-kit/task.js";
import {
  CrmReadOnboardingDates,
  ReadOnboardingDatesOutputSchema,
} from "../../../../models/systems/crm/read-onboarding-dates.js";
import {
  CrmSubjectBindingSchema,
} from "../../../../models/ui/crm-onboarding.js";
import { directIdentifierDisplay } from "../../../../rules/redaction/redaction.js";
import { crmDriver } from "../driver-declaration.js";


export const readOnboardingDatesTask = defineTask(crmDriver, CrmReadOnboardingDates, {
  sessions: [{ system: "crm", access: "read", session: "reuse-worker" }],
  retry: { attempts: 2, backoffMs: 2_000, retryOn: "transient" },
  async run({ input, ctx }) {
    const read = await ctx.driver.readOnboardingDates(input);
    const parsedBinding = CrmSubjectBindingSchema.safeParse(read.binding);
    if (!parsedBinding.success) {
      return ctx.fail(
        "subject-mismatch",
        `CRM onboarding dates returned an invalid subject binding for EID ${directIdentifierDisplay(input.eid)}`,
        { subject: input.eid },
      );
    }
    const binding = parsedBinding.data;
    const bindingEid = binding.state === "displayed-record" ? binding.observedEid : binding.queriedEid;
    if (binding.expectedEid !== input.eid || bindingEid !== input.eid) {
      return ctx.fail(
        "subject-mismatch",
        `CRM onboarding dates expected EID ${directIdentifierDisplay(input.eid)} but bound ${directIdentifierDisplay(bindingEid)} as ${binding.state}`,
        { subject: input.eid },
      );
    }
    const output = ReadOnboardingDatesOutputSchema.parse(read.output);
    if (binding.state === "absent-query" && (output.employmentDate !== null || output.oathDate !== null)) {
      return ctx.fail("subject-mismatch", "Absent CRM query cannot return dates", { subject: input.eid });
    }
    if (output.emplId !== input.eid) {
      return ctx.fail(
        "subject-mismatch",
        `CRM onboarding dates for EID ${directIdentifierDisplay(input.eid)} returned output for ${directIdentifierDisplay(output.emplId)}`,
        { subject: input.eid },
      );
    }
    ctx.recordData(Object.entries<unknown>(output).map(([field, value]) => ({ direction: "read" as const, field, value })));
    return output;
  },
});
