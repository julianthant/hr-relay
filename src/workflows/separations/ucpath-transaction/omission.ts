/**
 * D307 — omitting the UCPath transaction step.
 *
 * Neither transaction runs and neither mints an outcome (D144: only the write
 * sequencer's row may say a write happened). The operator types the
 * transaction number and its approval status, and the step's pure receipt
 * fold is rebuilt from them over the identity approval and the reconciled
 * dates this run still holds — the same two facts a live receipt is checked
 * against. The receipt's `disposition` names the assertion.
 */
import { z } from "zod";
import { ReadSeparationDatesOutputSchema } from "../../../domain/contracts/separations/read-separation-dates.js";
import { VerifyIdentityApprovalOutputSchema } from "../../../domain/contracts/separations/verify-identity-approval.js";
import {
  TERMINATION_RECEIPT_ACCEPTED_STATUSES,
  assertTerminationReceipt,
} from "../../../domain/separations/termination-receipt.js";
import type { StepOmissionDeclaration } from "../../../domain/workflow/step-omission.js";
import { RECEIPT_NODE } from "./node-ids.js";
import { APPROVAL_NODE } from "../identity-check/node-ids.js";
import { DATES_NODE } from "../kronos-timecard/node-ids.js";

const FactsSchema = z.strictObject({
  transactionNumber: z.string().min(1),
  approvalStatus: z.string().min(1),
});

export const UCPATH_TRANSACTION_OMISSION: StepOmissionDeclaration = {
  form: {
    fields: [
      {
        key: "transactionNumber", label: "UCPath transaction number", kind: "text",
        help: "The T-number of the termination already filed in UCPath (T followed by 6–12 digits). This run files nothing in UCPath.",
      },
      {
        key: "approvalStatus", label: "Approval status", kind: "enum",
        values: [...TERMINATION_RECEIPT_ACCEPTED_STATUSES],
        help: "The transaction's approval status as UCPath shows it now. Only a status that means the termination took effect can be asserted.",
      },
    ],
  },
  produces: {
    [RECEIPT_NODE]: ({ facts, scope }) => {
      const typed = FactsSchema.parse(facts);
      const approval = VerifyIdentityApprovalOutputSchema.parse(scope.outputs[APPROVAL_NODE]);
      const dates = ReadSeparationDatesOutputSchema.parse(scope.outputs[DATES_NODE]);
      return assertTerminationReceipt({
        transactionNumber: typed.transactionNumber,
        approvalStatus: typed.approvalStatus,
        approvedEmplId: approval.approved.emplId,
        approvedName: approval.approved.ucpathName,
        expectedEffectiveDate: dates.terminationEffectiveDate,
      });
    },
  },
};
