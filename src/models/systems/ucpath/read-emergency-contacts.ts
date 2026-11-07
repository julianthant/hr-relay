import { taskId } from "../../../rules/identity/ids.js";
import { defineTaskContract } from "../../task/task-contract.js";
import { UcpathContactReadOutputSchema,UcpathContactSubjectSchema,example,freshness,provenance,scenarios,subject } from "./contact-contract.js";
import {
UCPATH_CONTACT_REFUSAL_CODES
} from "./emergency-contacts.js";
export const UcpathReadEmergencyContacts = defineTaskContract({
  id: taskId("ucpath/read-emergency-contacts"), title: "Read Emergency Contacts", effect: "read",
  input: UcpathContactSubjectSchema, output: UcpathContactReadOutputSchema,
  errorCodes: UCPATH_CONTACT_REFUSAL_CODES,
  subject: { ...subject, requiredAt: "before-subject-read" }, freshness, provenance, scenarios, example,
});
