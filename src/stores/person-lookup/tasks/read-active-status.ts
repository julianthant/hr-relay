import { defineTask } from "../../../base/task.js";
import {
  ActiveStatusOutcomeSchema,
  ReadActiveStatus,
} from "../../../domain/contracts/person-lookup/read-active-status.js";
import { directIdentifierDisplay } from "../../../domain/redaction.js";

export const readActiveStatusTask = defineTask(ReadActiveStatus, {
  sessions: [],
  async run({ input, ctx }) {
    const finish = (candidate: unknown) => {
      const output = ActiveStatusOutcomeSchema.parse(candidate);
      ctx.recordData([
        { direction: "read", field: "state", value: output.state },
        { direction: "read", field: "reason", value: output.reason },
        ...("hdh" in output
          ? [{ direction: "read" as const, field: "hdh" as const, value: output.hdh }]
          : []),
      ]);
      return output;
    };
    const selected = input.person.selection.selected;
    if (selected === null) {
      return finish({
        state: "undetermined",
        reason: `UCPath person selection is ${input.person.selection.status}`,
      });
    }
    const crmEid = input.crm.state === "found" ? input.crm.record.emplId : input.crm.queriedEid;
    if (crmEid !== selected.emplId) {
      return ctx.fail(
        "inconsistent-inputs",
        `person-lookup active-status received UCPath EID ${directIdentifierDisplay(selected.emplId)} but CRM EID ${directIdentifierDisplay(crmEid)}`,
        { subject: selected.emplId },
      );
    }
    if (!selected.hdh && !input.keepNonHdh) {
      return finish({
        state: "undetermined",
        reason: "the resolved appointment is outside HDH and the run did not retain non-HDH appointments",
      });
    }
    if (selected.employeeStatus !== "active") {
      return finish({
        state: "inactive",
        reason: `UCPath reports employee status ${selected.employeeStatus}`,
        hdh: selected.hdh,
      });
    }
    return finish({
      state: "active",
      reason: input.crm.state === "found"
        ? `UCPath reports active and CRM record ${input.crm.record.recordId} matches the selected EID`
        : "UCPath reports active; CRM has no onboarding record for the selected EID",
      hdh: selected.hdh,
    });
  },
});
