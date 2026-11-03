import { defineTask } from "../../../../workflow-kit/task.js";
import { CrmHireDataSchema, CrmReadHireData } from "../../../../models/systems/crm/read-hire-data.js";
import { crmDriver } from "../driver-declaration.js";

export const readHireDataTask = defineTask(crmDriver, CrmReadHireData, {
  sessions: [{ system: "crm", access: "read", session: "reuse-worker" }],
  async run({ input, ctx }) {
    let output;
    try {
      output = CrmHireDataSchema.parse(await ctx.driver.readHireData(input));
      if (output.requestedEmail.toLowerCase() !== input.email.toLowerCase()) {
        throw new Error("CRM hire extraction has inconsistent identity evidence");
      }
    } catch (cause) {
      if (ctx.signal.aborted) throw cause;
      return ctx.fail("ONBOARDING_CRM_READ_FAILED", "CRM hire data could not be verified. Review the record before starting a new run.", { cause });
    }
    ctx.recordData(Object.entries(output).map(([field, value]) => ({ direction: "read" as const, field, value })));
    return output;
  },
});
