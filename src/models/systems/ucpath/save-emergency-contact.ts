import { z } from "zod";
import { taskId,TaskIdSchema } from "../../../rules/identity/ids.js";
import { defineTaskContract } from "../../task/task-contract.js";
import { contactOperation,emergencyContactIdempotencyKey,proofExample,subject,writeScenarios } from "./contact-contract.js";
import {
UcpathContactEffectProofSchema,
UcpathContactWriteTargetSchema
} from "./emergency-contacts.js";
export const UcpathSaveEmergencyContact = defineTaskContract({
  id: taskId("ucpath/save-emergency-contact"), title: "Save Emergency Contact unavailable", effect: "commit", operation: contactOperation("save-contact-unavailable", "Contact Save is unavailable"),
  input: UcpathContactWriteTargetSchema, output: z.strictObject({ proof: UcpathContactEffectProofSchema }),
  errorCodes: ["CONTACT_SAVE_UNAVAILABLE"], subject: { ...subject, requiredAt: "after-prepare-before-fence" }, scenarios: writeScenarios,
  writeSafety: {
    completion: { kind: "save-verify", verify: { taskId: TaskIdSchema.parse("ucpath/verify-emergency-contact-plan"), effect: "read" },
      proofSchema: UcpathContactEffectProofSchema, proofFromOutput: (output: { proof: z.output<typeof UcpathContactEffectProofSchema> }) => output.proof,
      proofFromPresentProbe: ({ proof }: { proof: z.output<typeof UcpathContactEffectProofSchema> }) => proof, outputFromProof: (proof: z.output<typeof UcpathContactEffectProofSchema>) => ({ proof }) },
    idempotency: { probe: { taskId: TaskIdSchema.parse("ucpath/match-emergency-contact-plan"), effect: "read" }, key: emergencyContactIdempotencyKey,
      recoveryAbsence: { kind: "operator-only", reason: "Contact Save has no accepted live saved-effect recovery authority." } },
  }, example: { proof: proofExample },
});
