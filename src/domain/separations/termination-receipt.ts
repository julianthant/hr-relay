/**
 * **D130's finding, enforced at the one place it matters** — the receipt PAIR
 * that decides whether a Kuali document may be finalized.
 *
 * §5 item 2's recorded answer is that the UCPath termination's completion arm is
 * `receipt`, and that the receipt is the pair `(transactionNumber,
 * approvalStatus)` — **never the number alone**, because the 2026-08-04 live
 * probe proved a **Denied** transaction carries a perfectly well-formed `T…`
 * (`T002204014`), and legacy's own `interpretPostSubmitTxnReadback` tests only
 * `/^T\d{6,}$/`.
 *
 * The commit contract already returns the pair. What nothing owned until the
 * composition existed is the CONSEQUENCE: writing a Denied `T…` into the Kuali
 * document's *Transaction Number* field records a termination that UCPath
 * refused, on the local record everyone reads afterwards. §9.11 named this as
 * chunk 6's ("the receipt pair still belongs to the composition"); this is it.
 *
 * ## Where the Denied receipt actually comes from
 *
 * Not from a fresh submit — a just-filed transaction reads `Pending`. It comes
 * from the `already-present` arm: `ucpathTerminationVerdict` matches on action
 * and effective date and returns whatever `approvalStatus` the row carried, so a
 * re-run over a person whose earlier termination was refused gets a `present`
 * verdict with a `Denied` receipt and **no click**. That is the probe working
 * exactly as designed, and it is precisely why the reading of its answer has to
 * be its own decision.
 *
 * ## The vocabulary, and why `Pending` passes
 *
 * `Approved` and `Manually Processed` are settled successes. `Pending` is the
 * ordinary state of a transaction this run just filed, and refusing it would
 * refuse every happy path. `Denied`, `Error` and `Pushed Back` all mean the
 * termination did NOT take effect while still carrying a receipt — the exact
 * shape D130 warns about — so they refuse by name.
 */
import { z } from "zod";
import { EidSchema } from "../ids.js";
import { KualiTransactionNumberSchema } from "../ui/kuali-separation-document.js";
import type { UcpathTerminationProof } from "../ui/ucpath-smart-hr-termination.js";
import { UcpathUsDateSchema } from "../ui/ucpath-smart-hr-termination.js";
import { UcpathApprovalStatusSchema } from "../ui/ucpath-ss-smart-hr.js";

export const TERMINATION_RECEIPT_REFUSAL_CODES = [
  /** The receipt names a different person than the operator approved. */
  "termination-receipt-subject-mismatch",
  /** The receipt names a different effective date than this run filed. */
  "termination-receipt-date-mismatch",
  /** `Denied` / `Error` / `Pushed Back` — a receipt for a termination that did not take effect. */
  "termination-not-in-effect",
  /** A `T…` UCPath accepts that the Kuali *Transaction Number* control cannot hold. */
  "termination-receipt-unusable",
] as const;
export const TerminationReceiptRefusalCodeSchema = z.enum(TERMINATION_RECEIPT_REFUSAL_CODES);
export type TerminationReceiptRefusalCode = z.infer<typeof TerminationReceiptRefusalCodeSchema>;

/**
 * The statuses a termination may carry and still be written onto the Kuali
 * document. `Pending` is here because a transaction this run just filed is
 * always `Pending`; the three failure statuses are deliberately absent.
 */
export const TERMINATION_RECEIPT_ACCEPTED_STATUSES = [
  "Approved",
  "Manually Processed",
  "Pending",
] as const;

export const TerminationReceiptSchema = z.strictObject({
  /** The number the Kuali finalization stages, already proved storable there. */
  transactionNumber: KualiTransactionNumberSchema,
  approvalStatus: UcpathApprovalStatusSchema,
  effectiveDate: UcpathUsDateSchema,
  emplId: EidSchema,
  /** The name UCPath's own detail page showed for this transaction's subject. */
  displayedName: z.string().min(1),
  /** Whether this run filed it, or found it already there (doc 09 §5). */
  disposition: z.enum(["committed", "already-present"]),
});
export type TerminationReceipt = z.infer<typeof TerminationReceiptSchema>;

export const TerminationReceiptVerificationSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("accepted"), receipt: TerminationReceiptSchema }),
  z.strictObject({
    state: z.literal("refused"),
    code: TerminationReceiptRefusalCodeSchema,
    reason: z.string().min(1),
  }),
]);
export type TerminationReceiptVerification = z.infer<typeof TerminationReceiptVerificationSchema>;

export function verifyTerminationReceipt(input: Readonly<{
  proof: UcpathTerminationProof;
  disposition: "committed" | "already-present";
  /** The EID a human approved at the gate. */
  approvedEmplId: string;
  /** The effective date this run computed and filed. */
  expectedEffectiveDate: string;
}>): TerminationReceiptVerification {
  if (input.proof.emplId !== input.approvedEmplId) {
    return TerminationReceiptVerificationSchema.parse({
      state: "refused",
      code: "termination-receipt-subject-mismatch",
      reason: `the UCPath transaction ${input.proof.transactionId} names EID ${input.proof.emplId} `
        + `(${input.proof.displayedName}), and the identity gate approved ${input.approvedEmplId}. A `
        + "receipt about a different person is not this run's receipt, and writing it onto the Kuali "
        + "document would record somebody else's termination against this separation.",
    });
  }
  if (input.proof.effectiveDate !== input.expectedEffectiveDate) {
    return TerminationReceiptVerificationSchema.parse({
      state: "refused",
      code: "termination-receipt-date-mismatch",
      reason: `the UCPath transaction ${input.proof.transactionId} is effective `
        + `${input.proof.effectiveDate}, and this run filed ${input.expectedEffectiveDate}. The effective `
        + "date is half the permanent key, so a receipt carrying a different one describes a different "
        + "external transaction.",
    });
  }
  if (!TERMINATION_RECEIPT_ACCEPTED_STATUSES.some((status) => status === input.proof.approvalStatus)) {
    return TerminationReceiptVerificationSchema.parse({
      state: "refused",
      code: "termination-not-in-effect",
      reason: `UCPath transaction ${input.proof.transactionId} carries approval status `
        + `${JSON.stringify(input.proof.approvalStatus)}, so the termination did not take effect — and it `
        + "still carries a perfectly well-formed T-number, which is the whole of D130's finding (live "
        + "Denied receipt T002204014, 2026-08-04). Writing it into the Kuali document's Transaction "
        + "Number field would record a termination UCPath refused.",
    });
  }
  const transactionNumber = KualiTransactionNumberSchema.safeParse(input.proof.transactionId);
  if (!transactionNumber.success) {
    return TerminationReceiptVerificationSchema.parse({
      state: "refused",
      code: "termination-receipt-unusable",
      reason: `UCPath issued transaction ${JSON.stringify(input.proof.transactionId)}, which the Kuali `
        + "Transaction Number control cannot hold (T followed by 6–12 digits): "
        + `${transactionNumber.error.issues.map((issue) => issue.message).join("; ")}. The two systems `
        + "genuinely disagree about the format, and inventing a truncation would file a number that "
        + "names no transaction.",
    });
  }
  return TerminationReceiptVerificationSchema.parse({
    state: "accepted",
    receipt: {
      transactionNumber: transactionNumber.data,
      approvalStatus: input.proof.approvalStatus,
      effectiveDate: input.proof.effectiveDate,
      emplId: input.proof.emplId,
      displayedName: input.proof.displayedName,
      disposition: input.disposition,
    },
  });
}
