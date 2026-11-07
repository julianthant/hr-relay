import { z } from "zod";
import { defineTaskContract, ContractFieldPathSchema } from "../../task/task-contract.js";
import { taskId, TaskIdSchema } from "../../../rules/identity/ids.js";
import { I9ProfileTargetSchema, I9ProfileProofSchema, I9_PROFILE_SUBJECT, I9_PROFILE_PROOF_EXAMPLE, i9ProfileKey } from "../../ui/i9-creation.js";

const Output = z.strictObject({ receipt: I9ProfileProofSchema });
export const I9CreateProfile = defineTaskContract({
  id: taskId("i9/create-profile"), title: "Save I-9 profile", effect: "commit",
  input: I9ProfileTargetSchema, output: Output, errorCodes: ["I9_WRITE_REFUSED"],
  subject: { kind: "person", expected: { fromInput: ContractFieldPathSchema.parse("expectedName"), identity: "name" },
    observe: I9_PROFILE_SUBJECT, match: "normalized-exact-name", requiredAt: "after-prepare-before-fence" },
  scenarios: ["onboarding/write-transactions"],
  writeSafety: {
    completion: { kind: "save-verify", verify: { taskId: TaskIdSchema.parse("i9/verify-profile"), effect: "read" },
      proofSchema: I9ProfileProofSchema, proofFromOutput: (output: z.output<typeof Output>) => output.receipt,
      proofFromPresentProbe: (verdict: { proof: z.output<typeof I9ProfileProofSchema> }) => verdict.proof,
      outputFromProof: (proof: z.output<typeof I9ProfileProofSchema>) => ({ receipt: proof }) },
    idempotency: { probe: { taskId: TaskIdSchema.parse("i9/match-profile"), effect: "read" },
      key: i9ProfileKey,
      recoveryAbsence: { kind: "operator-only", reason: "I-9 save propagation has no verified negative-recovery window; an uncertain submit requires operator resolution" } },
  }, example: { receipt: I9_PROFILE_PROOF_EXAMPLE },
});
