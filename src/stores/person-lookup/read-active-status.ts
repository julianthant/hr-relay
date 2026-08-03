import { defineTask } from "../../base/task.js";
import {
  ActiveStatusOutcomeSchema,
  ReadActiveStatus,
} from "../../domain/contracts/person-lookup/read-active-status.js";

export const readActiveStatusTask = defineTask(ReadActiveStatus, {
  sessions: [],
  async run({ input }) {
    const selected = input.person.selection.selected;
    if (selected === null) {
      return ActiveStatusOutcomeSchema.parse({
        state: "undetermined",
        reason: `UCPath person selection is ${input.person.selection.status}`,
      });
    }
    if (!selected.hdh && !input.keepNonHdh) {
      return ActiveStatusOutcomeSchema.parse({
        state: "undetermined",
        reason: "the resolved appointment is outside HDH and the run did not retain non-HDH appointments",
      });
    }
    if (selected.employeeStatus !== "active") {
      return ActiveStatusOutcomeSchema.parse({
        state: "inactive",
        reason: `UCPath reports employee status ${selected.employeeStatus}`,
        hdh: selected.hdh,
      });
    }
    if (input.crm.state === "found" && input.crm.record.emplId !== selected.emplId) {
      throw new Error(
        `person-lookup active-status received UCPath EID ${selected.emplId} but CRM EID ${input.crm.record.emplId}`,
      );
    }
    return ActiveStatusOutcomeSchema.parse({
      state: "active",
      reason: input.crm.state === "found"
        ? `UCPath reports active and CRM record ${input.crm.record.recordId} matches the selected EID`
        : "UCPath reports active; CRM has no onboarding record for the selected EID",
      hdh: selected.hdh,
    });
  },
});
