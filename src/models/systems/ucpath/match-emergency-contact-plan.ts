import { taskId } from "../../../rules/identity/ids.js";
import { defineTaskContract } from "../../task/task-contract.js";
import { absent,contactOperation,freshness,provenance,subject,UcpathContactVerdictSchema,writeScenarios } from "./contact-contract.js";
import {
UCPATH_CONTACT_REFUSAL_CODES,
UcpathContactWriteTargetSchema
} from "./emergency-contacts.js";
export const UcpathProbeEmergencyContact = defineTaskContract({
  id: taskId("ucpath/match-emergency-contact-plan"), title: "Probe exact Emergency Contact plan", effect: "read", operation: contactOperation("probe-contact-plan", "Verify the complete persisted contact outcome"),
  input: UcpathContactWriteTargetSchema, output: UcpathContactVerdictSchema, errorCodes: UCPATH_CONTACT_REFUSAL_CODES,
  subject: { ...subject, requiredAt: "before-subject-read" }, freshness, provenance, scenarios: writeScenarios,
  example: UcpathContactVerdictSchema.parse(absent),
});
