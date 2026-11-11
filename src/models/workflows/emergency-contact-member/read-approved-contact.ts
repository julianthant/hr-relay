import { taskId } from "../../../rules/identity/ids.js";
import { UcpathEmergencyContactInputSchema } from "../../systems/ucpath/emergency-contacts.js";
import { defineTaskContract } from "../../task/task-contract.js";
import { contactExample,policy } from "./contact-plan.js";
import { EmergencyContactMemberInputSchema } from "./input.js";
export const MapApprovedEmergencyContact = defineTaskContract({ ...policy,
  // Scopes the OnBase delegate, whose admission ages it on the wall clock; its values derive only from the run input.
  freshness: { defaultMaxAgeMs: Infinity, defaultOverride: "forbidden" }, id: taskId("workflow:emergency-contact-member/read-approved-contact"),
  title: "Map approved contact fields", input: EmergencyContactMemberInputSchema, output: UcpathEmergencyContactInputSchema,
  errorCodes: ["CONTACT_APPROVED_FIELDS_INVALID"], example: contactExample });
