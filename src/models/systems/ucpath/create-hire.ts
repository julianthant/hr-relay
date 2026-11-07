import { z } from "zod";
import { defineTaskContract } from "../../task/task-contract.js";
import { taskId, TaskIdSchema } from "../../../rules/identity/ids.js";
import { UcpathHireTargetSchema, UcpathHireProofSchema, UCPATH_HIRE_PROOF_EXAMPLE, ucpathHireKey } from "../../ui/ucpath-hire.js";
import { UCPATH_HIRE_SUBJECT_CONTRACT } from "./hire-contract.js";

const Output = z.strictObject({ receipt: UcpathHireProofSchema });
export const UcpathCreateHire = defineTaskContract({ id: taskId("ucpath/create-hire"), title: "Submit UCPath hire", effect: "commit",
  input: UcpathHireTargetSchema, output: Output, subject: UCPATH_HIRE_SUBJECT_CONTRACT, errorCodes: ["UCPATH_HIRE_REFUSED"], scenarios: ["onboarding/write-transactions"],
  writeSafety: {
    completion: { kind: "save-verify", verify: { taskId: TaskIdSchema.parse("ucpath/verify-hire"), effect: "read" }, proofSchema: UcpathHireProofSchema,
      proofFromOutput: (output: z.output<typeof Output>) => output.receipt,
      proofFromPresentProbe: (verdict: { proof: z.output<typeof UcpathHireProofSchema> }) => verdict.proof,
      outputFromProof: (proof: z.output<typeof UcpathHireProofSchema>) => ({ receipt: proof }) },
    idempotency: { probe: { taskId: TaskIdSchema.parse("ucpath/match-hire"), effect: "read" }, key: ucpathHireKey,
      recoveryAbsence: { kind: "operator-only", reason: "UCPath hire propagation has no verified negative-recovery window; uncertain submissions require operator resolution" } },
  }, example: { receipt: UCPATH_HIRE_PROOF_EXAMPLE } });
