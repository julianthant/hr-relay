/** The receipt PAIR — `(transactionNumber, approvalStatus)`, NEVER the number alone — that decides whether a Kuali document may be finalized. */
import { z } from "zod";
import { EidSchema } from "../identity/ids.js";
import { directIdentifierDisplay } from "../redaction/redaction.js";
import { KualiTransactionNumberSchema } from "../../models/ui/kuali-separation-document.js";
import type { UcpathTerminationProof } from "../../models/ui/ucpath-smart-hr-termination.js";
import { UcpathUsDateSchema } from "../../models/ui/ucpath-smart-hr-termination.js";
import { UcpathApprovalStatusSchema } from "../../models/ui/ucpath-ss-smart-hr.js";

export const TERMINATION_RECEIPT_REFUSAL_CODES = [
  /** The receipt names a different person than identity authority established. */
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

/** The statuses a termination may carry and still be written onto the Kuali document; `Pending` is here because a transaction this run just filed is always `Pending`. */
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
    /* Whether this run filed it, found it already there — or never touched UCPath and carries the number the operator typed when omitting that step. */
  disposition: z.enum(["committed", "already-present", "operator-asserted"]),
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

/** The two field checks a receipt's number and status must pass whether they were READ or TYPED: one implementation, two callers, so the accepted-status list cannot drift. */
function receiptFields(transactionId: string, approvalStatus: string):
  | Readonly<{ state: "accepted"; transactionNumber: z.infer<typeof KualiTransactionNumberSchema>; approvalStatus: z.infer<typeof UcpathApprovalStatusSchema> }>
  | Readonly<{ state: "refused"; code: TerminationReceiptRefusalCode; reason: string }> {
  const status = UcpathApprovalStatusSchema.safeParse(approvalStatus);
  if (!status.success || !TERMINATION_RECEIPT_ACCEPTED_STATUSES.some((accepted) => accepted === status.data)) {
    return {
      state: "refused",
      code: "termination-not-in-effect",
      reason: `UCPath transaction ${transactionId} carries approval status `
        + `${JSON.stringify(approvalStatus)}, so the termination did not take effect — and it `
        + "still carries a well-formed T-number. "
        + "Writing it into the Kuali document's Transaction "
        + "Number field would record a termination UCPath refused.",
    };
  }
  const transactionNumber = KualiTransactionNumberSchema.safeParse(transactionId);
  if (!transactionNumber.success) {
    return {
      state: "refused",
      code: "termination-receipt-unusable",
      reason: `UCPath issued transaction ${JSON.stringify(transactionId)}, which the Kuali `
        + "Transaction Number control cannot hold (T followed by 6–12 digits): "
        + `${transactionNumber.error.issues.map((issue) => issue.message).join("; ")}. The two systems `
        + "genuinely disagree about the format, and inventing a truncation would file a number that "
        + "names no transaction.",
    };
  }
  return { state: "accepted", transactionNumber: transactionNumber.data, approvalStatus: status.data };
}

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
      reason: `the UCPath transaction ${input.proof.transactionId} names EID ${directIdentifierDisplay(input.proof.emplId)} `
        + `(name ${directIdentifierDisplay(input.proof.displayedName)}), and the identity gate approved ${directIdentifierDisplay(input.approvedEmplId)}. A `
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
  const fields = receiptFields(input.proof.transactionId, input.proof.approvalStatus);
  if (fields.state === "refused") {
    return TerminationReceiptVerificationSchema.parse({ state: "refused", code: fields.code, reason: fields.reason });
  }
  return TerminationReceiptVerificationSchema.parse({
    state: "accepted",
    receipt: {
      transactionNumber: fields.transactionNumber,
      approvalStatus: fields.approvalStatus,
      effectiveDate: input.proof.effectiveDate,
      emplId: input.proof.emplId,
      displayedName: input.proof.displayedName,
      disposition: input.disposition,
    },
  });
}

/** Typed receipts still bind subject/date to the run and require an accepted status. */
export function assertTerminationReceipt(input: Readonly<{
  transactionNumber: string;
  approvalStatus: string;
  approvedEmplId: string;
  approvedName: string;
  expectedEffectiveDate: string;
}>): TerminationReceipt {
  const fields = receiptFields(input.transactionNumber, input.approvalStatus);
  if (fields.state === "refused") {
    throw new Error(`asserted UCPath receipt refused (${fields.code}): ${fields.reason}`);
  }
  return TerminationReceiptSchema.parse({
    transactionNumber: fields.transactionNumber,
    approvalStatus: fields.approvalStatus,
    effectiveDate: input.expectedEffectiveDate,
    emplId: input.approvedEmplId,
    displayedName: input.approvedName,
    disposition: "operator-asserted",
  });
}
