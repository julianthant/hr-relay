import { z } from "zod";
import { taskId } from "../../../rules/identity/ids.js";
import { defineTaskContract } from "../../task/task-contract.js";
import { UcpathContactReadOutputSchema,completeExample,scenarios,subject } from "./contact-contract.js";
import {
UCPATH_CONTACT_REFUSAL_CODES,
UcpathContactWriteTargetSchema
} from "./emergency-contacts.js";
export const UcpathStageEmergencyContact = defineTaskContract({
  id: taskId("ucpath/stage-emergency-contact"), title: "Stage Emergency Contact", effect: "prepare",
  input: UcpathContactWriteTargetSchema, output: UcpathContactReadOutputSchema.extend({ stagedPageState: z.literal("ucpath.emergency-contact.editor-ready") }),
  errorCodes: UCPATH_CONTACT_REFUSAL_CODES,
  subject: { ...subject, requiredAt: "after-prepare-before-fence" }, scenarios, checkpoint: "in-memory-only",
  example: { contacts: { ...completeExample, observation: "staged" }, stagedPageState: "ucpath.emergency-contact.editor-ready" },
});
