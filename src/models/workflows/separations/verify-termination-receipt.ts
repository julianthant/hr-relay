/** Require a receipt proving effective termination for this subject and date. */
import { z } from "zod";
import { EidSchema, taskId } from "../../../rules/identity/ids.js";
import {
  TERMINATION_RECEIPT_REFUSAL_CODES,
  TerminationReceiptSchema,
} from "../../../rules/separations/termination-receipt.js";
import {
  UcpathTerminationProofSchema,
  UcpathUsDateSchema,
} from "../../ui/ucpath-smart-hr-termination.js";
import { defineTaskContract } from "../../task/task-contract.js";

export const VerifyTerminationReceiptOutputSchema = TerminationReceiptSchema;
export type VerifyTerminationReceiptOutput = z.infer<typeof VerifyTerminationReceiptOutputSchema>;

export const SeparationsVerifyTerminationReceipt = defineTaskContract({
  id: taskId("workflow:separations/verify-termination-receipt"),
  title: "Verify Termination Receipt",
  effect: "read",
  input: z.strictObject({
    /** The transaction node's landing proof, exactly as authority stored it. */
    proof: UcpathTerminationProofSchema,
    /** Whether this run filed it, or the probe found it already there. */
    disposition: z.enum(["committed", "already-present"]),
    /** The EID a human approved at the gate. */
    approvedEmplId: EidSchema,
    /** The effective date this run computed and filed. */
    expectedEffectiveDate: UcpathUsDateSchema,
  }),
  output: VerifyTerminationReceiptOutputSchema,
  errorCodes: TERMINATION_RECEIPT_REFUSAL_CODES,
  subject: {
    kind: "none",
    reason: "a pure fold over the termination proof this run's own transaction node settled",
  },
  freshness: { defaultMaxAgeMs: Number.POSITIVE_INFINITY, defaultOverride: "forbidden" },
  provenance: { default: "derived" },
  scenarios: ["separations/receipt-refusals"],
  example: {
    transactionNumber: "T002209631",
    approvalStatus: "Pending",
    effectiveDate: "06/20/2026",
    emplId: "10873698",
    displayedName: "Battistessa, Johnnie",
    disposition: "committed",
  },
});
