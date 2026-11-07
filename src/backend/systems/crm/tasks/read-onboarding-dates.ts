import { defineTask } from "../../../../workflow-kit/task.js";
import {
  CrmReadOnboardingDates,
  PersonLookupCrmDatesBindingError,
  ReadOnboardingDatesOutputSchema,
} from "../../../../models/systems/crm/read-onboarding-dates.js";
import {
  CrmDatesBindingSchema,
} from "../../../../models/ui/crm-onboarding.js";
import { crmDriver } from "../driver-declaration.js";


export const readOnboardingDatesTask = defineTask(crmDriver, CrmReadOnboardingDates, {
  sessions: [{ system: "crm", access: "read", session: "reuse-worker" }],
  retry: { attempts: 2, backoffMs: 2_000, retryOn: "transient" },
  async run({ input, ctx }) {
    const read = await ctx.driver.readOnboardingDates(input);
    const failBinding = (): never => { const error = new PersonLookupCrmDatesBindingError(); return ctx.fail(error.code, error.message, { subject: input.eid }); };
    const parsedBinding = CrmDatesBindingSchema.safeParse(read.binding);
    if (!parsedBinding.success) return failBinding();
    const binding = parsedBinding.data;
    const output = ReadOnboardingDatesOutputSchema.parse(read.output);
    if (binding.state === "not-read") {
      if (input.name !== undefined || binding.expectedEid !== input.eid || output.state !== "no-confident-record"
        || output.emplId !== input.eid || output.employmentDate !== null || output.oathDate !== null) return failBinding();
    } else {
      const bindingEid = binding.state === "displayed-record" ? binding.observedEid : binding.queriedEid;
      if (binding.expectedEid !== input.eid || bindingEid !== input.eid || output.emplId !== input.eid
        || binding.state === "absent-query" && (output.employmentDate !== null || output.oathDate !== null)) return failBinding();
    }
    ctx.recordData(Object.entries<unknown>(output).map(([field, value]) => ({ direction: "read" as const, field, value })));
    return output;
  },
});
