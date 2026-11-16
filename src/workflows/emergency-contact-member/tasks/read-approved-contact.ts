import { ERROR_CATALOG } from "../../../models/failures/error-catalog.js";
import { MapApprovedEmergencyContact } from "../../../models/workflows/emergency-contact-member/read-approved-contact.js";
import { approvedEmergencyContact } from "../../../rules/ucpath/emergency-contact.js";
import { defineTask } from "../../../workflow-kit/task.js";

export const mapApprovedEmergencyContactTask = defineTask(MapApprovedEmergencyContact, {
  sessions: [], async run({ input, ctx }) {
    let contact: ReturnType<typeof approvedEmergencyContact>;
    try { contact = approvedEmergencyContact(input.record); }
    catch (cause) { return ctx.fail("CONTACT_APPROVED_FIELDS_INVALID", ERROR_CATALOG.CONTACT_APPROVED_FIELDS_INVALID.text, { cause }); }
    ctx.recordData(Object.entries(contact).map(([field, value]) => ({ direction: "read" as const, field, value })));
    return contact;
  },
});
