import { z } from "zod";
import { defineTaskContract, ContractFieldPathSchema } from "../../task/task-contract.js";
import { taskId, TaskIdSchema } from "../../../rules/identity/ids.js";
import { I9RemoteTargetSchema, I9RemoteProofSchema, I9_PROFILE_SUBJECT, I9_REMOTE_PROOF_EXAMPLE, i9RemoteKey } from "../../ui/i9-creation.js";

const Output = z.strictObject({ receipt: I9RemoteProofSchema });
export const I9CreateRemoteRecord = defineTaskContract({
  id: taskId("i9/create-remote-record"), title: "Create remote I-9 record", effect: "commit",
  input: I9RemoteTargetSchema, output: Output, errorCodes: ["I9_WRITE_REFUSED"],
  subject: { kind: "person", expected: { fromInput: ContractFieldPathSchema.parse("expectedName"), identity: "name" },
    observe: I9_PROFILE_SUBJECT, match: "normalized-exact-name", requiredAt: "after-prepare-before-fence" },
  scenarios: ["onboarding/write-transactions"],
  writeSafety: {
    completion: { kind: "save-verify", verify: { taskId: TaskIdSchema.parse("i9/verify-remote-record"), effect: "read" },
      proofSchema: I9RemoteProofSchema, proofFromOutput: (output: z.output<typeof Output>) => output.receipt,
      proofFromPresentProbe: (verdict: { proof: z.output<typeof I9RemoteProofSchema> }) => verdict.proof,
      outputFromProof: (proof: z.output<typeof I9RemoteProofSchema>) => ({ receipt: proof }) },
    idempotency: { probe: { taskId: TaskIdSchema.parse("i9/match-remote-record"), effect: "read" },
      key: i9RemoteKey,
      recoveryAbsence: { kind: "operator-only", reason: "I-9 save propagation has no verified negative-recovery window; an uncertain submit requires operator resolution" } },
  }, example: { receipt: I9_REMOTE_PROOF_EXAMPLE },
});
