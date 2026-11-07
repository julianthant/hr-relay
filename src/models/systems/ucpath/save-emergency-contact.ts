import { z } from "zod";
import { taskId,TaskIdSchema } from "../../../rules/identity/ids.js";
import { defineTaskContract } from "../../task/task-contract.js";
import { emergencyContactIdempotencyKey,proofExample,subject,writeScenarios } from "./contact-contract.js";
import {
UcpathContactEffectProofSchema,
UcpathContactWriteTargetSchema, UCPATH_CONTACT_REFUSAL_CODES
} from "./emergency-contacts.js";
export const UcpathSaveEmergencyContact = defineTaskContract({
  id: taskId("ucpath/save-emergency-contact"), title: "Save Emergency Contact", effect: "commit", operation: {
    version: 1, id: "save-contact", system: "ucpath", page: { screen: "ucpath.emergency-contact.editor" }, session: { kind: "browser", id: "contact-editor", system: "ucpath" },
    actions: [{ id: "save-contact", kind: "click", label: "Save the approved contact plan", target: "ucpath.emergency-contact.save" },
      { id: "verify-contact-observation", kind: "verify", label: "Verify the complete persisted contact plan" }],
  },
  input: UcpathContactWriteTargetSchema, output: z.strictObject({ proof: UcpathContactEffectProofSchema }),
  errorCodes: ["CONTACT_SAVE_UNAVAILABLE", "saved-effect-mismatch", ...UCPATH_CONTACT_REFUSAL_CODES], subject: { ...subject, requiredAt: "after-prepare-before-fence" }, scenarios: writeScenarios,
  writeSafety: {
    completion: { kind: "save-verify", verify: { taskId: TaskIdSchema.parse("ucpath/verify-emergency-contact-plan"), effect: "read" },
      proofSchema: UcpathContactEffectProofSchema, proofFromOutput: (output: { proof: z.output<typeof UcpathContactEffectProofSchema> }) => output.proof,
      proofFromPresentProbe: ({ proof }: { proof: z.output<typeof UcpathContactEffectProofSchema> }) => proof, outputFromProof: (proof: z.output<typeof UcpathContactEffectProofSchema>) => ({ proof }) },
    idempotency: { probe: { taskId: TaskIdSchema.parse("ucpath/match-emergency-contact-plan"), effect: "read" }, key: emergencyContactIdempotencyKey,
      recoveryAbsence: { kind: "operator-only", reason: "Contact Save has no accepted live saved-effect recovery authority." } },
  }, example: { proof: proofExample },
});
