import { taskId } from "../../../rules/identity/ids.js";
import { defineTaskContract } from "../../task/task-contract.js";
import { UcpathContactComparisonSchema,UcpathContactTargetSchema,example,freshness,provenance,scenarios,subject } from "./contact-contract.js";
import {
UCPATH_CONTACT_REFUSAL_CODES
} from "./emergency-contacts.js";
export const UcpathMatchEmergencyContact = defineTaskContract({
  id: taskId("ucpath/match-emergency-contact"), title: "Compare Emergency Contact Effect", effect: "read",
  input: UcpathContactTargetSchema, output: UcpathContactComparisonSchema,
  errorCodes: UCPATH_CONTACT_REFUSAL_CODES,
  subject: { ...subject, requiredAt: "before-subject-read" }, freshness, provenance, scenarios,
  example: { state: "absent", ...example },
});
