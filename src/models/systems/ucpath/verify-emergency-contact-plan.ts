import { taskId } from "../../../rules/identity/ids.js";
import { defineTaskContract } from "../../task/task-contract.js";
import { absent,contactOperation,freshness,provenance,subject,UcpathContactVerdictSchema,writeScenarios } from "./contact-contract.js";
import {
UCPATH_CONTACT_REFUSAL_CODES,
UcpathContactWriteTargetSchema
} from "./emergency-contacts.js";
export const UcpathVerifyEmergencyContact = defineTaskContract({
  id: taskId("ucpath/verify-emergency-contact-plan"), title: "Verify exact Emergency Contact effect", effect: "read", operation: contactOperation("verify-contact-plan", "Verify exact persisted protected contact effects"),
  input: UcpathContactWriteTargetSchema, output: UcpathContactVerdictSchema, errorCodes: UCPATH_CONTACT_REFUSAL_CODES,
  subject: { ...subject, requiredAt: "before-subject-read" }, freshness, provenance, scenarios: writeScenarios,
  example: UcpathContactVerdictSchema.parse(absent),
});
