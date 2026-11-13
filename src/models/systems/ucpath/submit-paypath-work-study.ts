/** The COMMIT arm: the PayPath `Save and Submit` click alone, keyed on the person and the effective date. */
import { z } from "zod";
import { ContractFieldPathSchema, defineTaskContract } from "../../task/task-contract.js";
import { TaskIdSchema, taskId } from "../../../rules/identity/ids.js";
import { UCPATH_PAYPATH_DISPLAYED_NAME, UcpathPayPathWorkStudyTargetSchema } from "../../ui/ucpath-paypath.js";
import {
  UcpathWorkStudyTransactionProofSchema, ucpathWorkStudyIdempotencyKey, workStudyProofExample, type UcpathWorkStudyTransactionProof,
} from "./match-paypath-work-study.js";

/** The commit's own read-back of the transaction it filed: a claim the mandatory verifier re-reads independently. */
export const UcpathSubmitPayPathWorkStudyOutputSchema = z.strictObject({ receipt: UcpathWorkStudyTransactionProofSchema });

export const UcpathSubmitPayPathWorkStudy = defineTaskContract({
  id: taskId("ucpath/submit-paypath-work-study"),
  title: "Submit PayPath work-study transaction",
  effect: "commit",
  input: UcpathPayPathWorkStudyTargetSchema,
  output: UcpathSubmitPayPathWorkStudyOutputSchema,
  errorCodes: ["paypath-submit-refused"],
  subject: {
    kind: "person",
    expected: { fromInput: ContractFieldPathSchema.parse("expectedName"), identity: "name" },
    observe: UCPATH_PAYPATH_DISPLAYED_NAME,
    match: "normalized-exact-name",
    requiredAt: "after-prepare-before-fence",
  },
  scenarios: ["work-study/planned-transaction", "work-study/verified-save", "work-study/unknown"],
  writeSafety: {
    completion: {
      kind: "save-verify",
      verify: { taskId: TaskIdSchema.parse("ucpath/verify-paypath-work-study"), effect: "read" },
      proofSchema: UcpathWorkStudyTransactionProofSchema,
      proofFromOutput: (output: z.output<typeof UcpathSubmitPayPathWorkStudyOutputSchema>) => output.receipt,
      proofFromPresentProbe: ({ proof }: { proof: UcpathWorkStudyTransactionProof }) => proof,
      outputFromProof: (proof: UcpathWorkStudyTransactionProof) => ({ receipt: proof }),
    },
    idempotency: {
      probe: { taskId: TaskIdSchema.parse("ucpath/match-paypath-work-study"), effect: "read" },
      key: ucpathWorkStudyIdempotencyKey,
      recoveryAbsence: {
        kind: "operator-only",
        reason: "PayPath Save and Submit propagation to SS Smart HR search has no measured window; post-fence absence requires operator resolution.",
      },
    },
  },
  example: { receipt: workStudyProofExample },
});
