import { UcpathContactRefusedError } from "../../../models/systems/ucpath/emergency-contacts.js";
import { PlanApprovedEmergencyContact } from "../../../models/workflows/emergency-contact-member/read-contact-plan.js";
import { contactEffect,contactPlanChanges,planEmergencyContact } from "../../../rules/ucpath/emergency-contact.js";
import { defineTask } from "../../../workflow-kit/task.js";

export const planApprovedEmergencyContactTask = defineTask(PlanApprovedEmergencyContact, {
  sessions: [], async run({ input, ctx }) {
    try {
      const plan = planEmergencyContact(input.contacts, contactEffect(input.contact));
      const changes = contactPlanChanges(plan);
      const output = { target: { ...input.contact, plan }, changes,
        demotionLine: plan.state === "prepare" && plan.demotion !== null ? changes[0] : "No existing primary needs demotion",
        contactLine: changes.length === 1 ? changes[0] : changes[1] };
      await ctx.confirmed?.read({ id: "read-demotion", targetId: "read-demotion" }, async () => output.demotionLine,
        { action: { id: "verify-demotion", targetId: "verify-demotion" }, purpose: "read-validation",
          observe: async () => plan.state === "prepare" && plan.demotion !== null ? contactPlanChanges(plan)[0] : "No existing primary needs demotion",
          matches: observed => observed === output.demotionLine });
      await ctx.confirmed?.read({ id: "read-contact", targetId: "read-contact" }, async () => output.contactLine,
        { action: { id: "verify-contact", targetId: "verify-contact" }, purpose: "read-validation",
          observe: async () => contactPlanChanges(plan).at(-1) ?? null, matches: observed => observed === output.contactLine });
      ctx.recordData([{ direction: "read", field: "target", value: output.target }, { direction: "read", field: "changes", value: output.changes },
        { direction: "read", field: "demotionLine", value: output.demotionLine }, { direction: "read", field: "contactLine", value: output.contactLine }]);
      return output;
    } catch (cause) {
      if (cause instanceof UcpathContactRefusedError && (cause.code === "contact-plan-refused" || cause.code === "relationship-unmapped"
        || cause.code === "address-choice-unresolved")) return ctx.fail(cause.code, "The approved contact plan could not be derived.", { cause });
      throw cause;
    }
  },
});
