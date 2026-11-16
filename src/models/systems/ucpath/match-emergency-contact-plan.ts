import { taskId } from "../../../rules/identity/ids.js";
import { defineTaskContract } from "../../task/task-contract.js";
import { absent,freshness,provenance,subject,UcpathContactVerdictSchema,writeScenarios } from "./contact-contract.js";
import {
UCPATH_CONTACT_REFUSAL_CODES,
UcpathContactWriteTargetSchema
} from "./emergency-contacts.js";
export const UcpathProbeEmergencyContact = defineTaskContract({
  id: taskId("ucpath/match-emergency-contact-plan"), title: "Probe exact Emergency Contact plan", effect: "read",
  input: UcpathContactWriteTargetSchema, output: UcpathContactVerdictSchema, errorCodes: UCPATH_CONTACT_REFUSAL_CODES,
  subject: { ...subject, requiredAt: "before-subject-read" }, freshness, provenance, scenarios: writeScenarios,
  example: UcpathContactVerdictSchema.parse(absent),
});
