import { defineTask } from "../../../base/task.js";
import { UcpathVerifyTerminationFilingPresent } from "../../../domain/contracts/ucpath/verify-termination-filing-present.js";
import { directIdentifierDisplay } from "../../../domain/redaction.js";
import { ucpathDriver } from "../driver-declaration.js";
import { ucpathTerminationFilingPresence } from "../termination-verdict.js";

/**
 * A fresh read immediately upstream of Kuali finalization. Missing, changed,
 * ambiguous, denied, or unreadable transaction authority fails here, before
 * the Kuali transaction can prepare, fence, or click.
 */
export const verifyTerminationFilingPresentTask = defineTask(
  ucpathDriver,
  UcpathVerifyTerminationFilingPresent,
  {
    sessions: [{ system: "ucpath", access: "read", session: "reuse-worker" }],
    async run({ input, ctx }) {
      const scan = await ctx.driver.scanTerminationTransactions({ emplId: input.emplId });
      const verdict = ucpathTerminationFilingPresence(input, scan);
      if (verdict.state !== "present") {
        return ctx.fail(
          verdict.state === "unknown" ? "unexpected-page-state" : "filing-not-current",
          `UCPath could not prove the current filing for ${directIdentifierDisplay(input.emplId)}: ${verdict.reason}`,
          { subject: input.emplId },
        );
      }
      ctx.recordData([
        { direction: "read", field: "kind", value: verdict.proof.kind },
        { direction: "read", field: "transactionId", value: verdict.proof.transactionId },
        { direction: "read", field: "emplId", value: verdict.proof.emplId },
        { direction: "read", field: "effectiveDate", value: verdict.proof.effectiveDate },
        { direction: "read", field: "approvalStatus", value: verdict.proof.approvalStatus },
        { direction: "read", field: "displayedName", value: verdict.proof.displayedName },
        { direction: "read", field: "observedAt", value: verdict.proof.observedAt },
        { direction: "read", field: "source", value: verdict.proof.source },
        { direction: "read", field: "receiptDisposition", value: verdict.proof.receiptDisposition },
        { direction: "read", field: "authority", value: verdict.proof.authority },
      ]);
      return verdict.proof;
    },
  },
);
