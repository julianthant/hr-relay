import { defineTask } from "../../../workflow-kit/task.js";
import { ReadActiveStatus } from "../../../models/workflows/person-lookup/read-active-status.js";

import { PersonLookupIdentityError } from "../../../models/workflows/person-lookup/errors.js";
import { derivePersonLookupOutcome } from "../../../rules/matching/person-lookup.js";
export const readActiveStatusTask = defineTask(ReadActiveStatus, {
  sessions: [],
  async run({ input, ctx }) {
    let output;
    try { output = derivePersonLookupOutcome(input); }
    catch (error) {
      if (!(error instanceof PersonLookupIdentityError)) throw error;
      return ctx.fail(error.code, error.message, { cause: error });
    }
    ctx.log.info("Employment status", { status: output.state, reason: output.reason, department: output.details.department ?? "", "HDH department": output.hdh === false ? "No" : output.hdh === true ? "Yes" : "Unknown" });
    ctx.recordData(Object.entries(output).map(([field, value]) => ({ direction: "read" as const, field, value })));
    return output;
  },
});
