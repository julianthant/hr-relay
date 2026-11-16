import { taskId } from "../../../rules/identity/ids.js";
import { UcpathEmergencyContactInputSchema } from "../../systems/ucpath/emergency-contacts.js";
import { defineTaskContract } from "../../task/task-contract.js";
import { contactExample,policy } from "./contact-plan.js";
import { EmergencyContactMemberInputSchema } from "./input.js";
export const MapApprovedEmergencyContact = defineTaskContract({ ...policy, id: taskId("workflow:emergency-contact-member/read-approved-contact"),
  title: "Map approved contact fields", input: EmergencyContactMemberInputSchema, output: UcpathEmergencyContactInputSchema,
  errorCodes: ["CONTACT_APPROVED_FIELDS_INVALID"], example: contactExample });
