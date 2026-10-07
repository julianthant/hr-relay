/**
 * `workflow:separations/verify-termination-receipt` — §4c's receipt PAIR, read
 * as a decision rather than carried as a value.
 *
 * §5 item 2: the UCPath termination's receipt is the pair
 * `(transactionNumber, approvalStatus)`, **never the number alone**, because a
 * **Denied** transaction carries a perfectly well-formed `T…` (D130, live
 * `T002204014`). §9.11 recorded that binding both belongs to the composition,
 * because the composition is the only graph that holds the termination's result
 * AND the Kuali write that consumes it.
 *
 * This node is the consequence: it stands between the two transactions and
 * refuses to hand the finalization a number that records a termination UCPath
 * did not put into effect, a number about a different person, or one about a
 * different effective date.
 */
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
