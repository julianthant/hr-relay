import { defineTask } from "../../../base/task.js";
import {
  CrmReadOnboardingRecord,
  ReadOnboardingRecordOutputSchema,
} from "../../../domain/contracts/crm/read-onboarding-record.js";
import {
  CrmSubjectBindingSchema,
} from "../../../domain/ui/crm-onboarding.js";
import { directIdentifierDigestReference } from "../../../domain/redaction.js";
import { crmDriver } from "../declaration.js";

/** Ported semantic operation: legacy 793abe1, src/systems/crm/onboarding-records.ts. */
export const readOnboardingRecordTask = defineTask(crmDriver, CrmReadOnboardingRecord, {
  sessions: [{ system: "crm", access: "read", session: "reuse-worker" }],
  retry: { attempts: 2, backoffMs: 2_000, retryOn: "transient" },
  async run({ input, ctx }) {
    const read = await ctx.driver.readOnboardingRecord(input);
    const parsedBinding = CrmSubjectBindingSchema.safeParse(read.binding);
    if (!parsedBinding.success) {
      return ctx.fail(
        "subject-mismatch",
        `CRM onboarding record returned an invalid subject binding for EID ${directIdentifierDigestReference(input.eid)}`,
        { subject: input.eid },
      );
    }
    const binding = parsedBinding.data;
    const output = ReadOnboardingRecordOutputSchema.parse(read.output);
    const outputEid = output.state === "found" ? output.record.emplId : output.queriedEid;
    const bindingEid = binding.state === "displayed-record" ? binding.observedEid : binding.queriedEid;
    if (binding.expectedEid !== input.eid
      || bindingEid !== input.eid
      || (output.state === "found") !== (binding.state === "displayed-record")) {
      return ctx.fail(
        "subject-mismatch",
        `CRM onboarding record expected EID ${directIdentifierDigestReference(input.eid)} but bound ${directIdentifierDigestReference(bindingEid)} as ${binding.state}`,
        { subject: input.eid },
      );
    }
    if (outputEid !== input.eid) {
      return ctx.fail(
        "subject-mismatch",
        `CRM onboarding record for EID ${directIdentifierDigestReference(input.eid)} returned output for ${directIdentifierDigestReference(outputEid)}`,
        { subject: input.eid },
      );
    }
    ctx.recordData(output.state === "found"
      ? [
          { direction: "read", field: "state", value: output.state },
          { direction: "read", field: "record", value: output.record },
        ]
      : [
          { direction: "read", field: "state", value: output.state },
          { direction: "read", field: "queriedEid", value: output.queriedEid },
          { direction: "read", field: "reason", value: output.reason },
        ]);
    return output;
  },
});
