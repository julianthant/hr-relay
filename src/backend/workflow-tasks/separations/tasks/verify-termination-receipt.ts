import { defineTask } from "../../../../base/task.js";
import {
  SeparationsVerifyTerminationReceipt,
  VerifyTerminationReceiptOutputSchema,
} from "../../../../domain/contracts/separations/verify-termination-receipt.js";
import { verifyTerminationReceipt } from "../../../../domain/separations/termination-receipt.js";

/**
 * D130's finding, executed at the one place it decides anything: between the
 * UCPath termination and the Kuali write that records its number.
 */
export const verifyTerminationReceiptTask = defineTask(SeparationsVerifyTerminationReceipt, {
  sessions: [],
  async run({ input, ctx }) {
    const verification = verifyTerminationReceipt({
      proof: input.proof,
      disposition: input.disposition,
      approvedEmplId: input.approvedEmplId,
      expectedEffectiveDate: input.expectedEffectiveDate,
    });
    if (verification.state === "refused") {
      return ctx.fail(verification.code, verification.reason);
    }
    const output = VerifyTerminationReceiptOutputSchema.parse(verification.receipt);
    ctx.recordData([
      { direction: "read", field: "transactionNumber", value: output.transactionNumber },
      { direction: "read", field: "approvalStatus", value: output.approvalStatus },
      { direction: "read", field: "effectiveDate", value: output.effectiveDate },
      { direction: "read", field: "emplId", value: output.emplId },
      { direction: "read", field: "displayedName", value: output.displayedName },
      { direction: "read", field: "disposition", value: output.disposition },
    ]);
    return output;
  },
});
