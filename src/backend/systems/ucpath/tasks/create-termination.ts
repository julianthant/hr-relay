import { defineTask } from "../../../../workflow-kit/task.js";
import { UcpathCreateTermination } from "../../../../models/systems/ucpath/create-termination.js";
import { directIdentifierDisplay } from "../../../../rules/redaction/redaction.js";
import {
  UCPATH_SMART_HR_SAVE_AND_SUBMIT_BUTTON,
  UcpathCommitRefusedError,
} from "../../../../models/ui/ucpath-smart-hr-termination.js";
import { ucpathDriver } from "../driver-declaration.js";
import { firstDisagreeingName, ucpathTerminationVerdict } from "../termination-verdict.js";


export const createTerminationTask = defineTask(ucpathDriver, UcpathCreateTermination, {
  sessions: [{ system: "ucpath", access: "transaction", session: "reuse-worker" }],
  async run({ input, ctx }) {
    // A refused submit throws; performed is literal true, so a false proof cannot represent refusal.
    const action = await ctx.driver
      .commit(UCPATH_SMART_HR_SAVE_AND_SUBMIT_BUTTON, ctx.mutation)
      .catch((error: unknown) => {
        if (!(error instanceof UcpathCommitRefusedError)) throw error;
        return ctx.fail(
          "submit-refused",
          `UCPath refused Save and Submit for EID ${directIdentifierDisplay(input.emplId)} and rendered `
          + `${JSON.stringify(error.refusal)}. The click happened, so this is post-fence and parks.`,
          { subject: input.emplId, cause: error },
        );
      });
    if (action.effect !== "external-commit") {
      return ctx.fail(
        "submit-refused",
        `UCPath Save and Submit for EID ${directIdentifierDisplay(input.emplId)} reported effect ${action.effect}, not an `
        + "external commit",
        { subject: input.emplId },
      );
    }
    const scan = await ctx.driver.scanTerminationTransactions({ emplId: input.emplId });
    const disagreeing = firstDisagreeingName(scan, input.expectedName);
    if (disagreeing !== undefined) {
      throw new Error(
        `UCPath post-submit read-back returned a transaction for ${directIdentifierDisplay(disagreeing)} while `
        + `the run named ${directIdentifierDisplay(input.expectedName)}. The submit has already happened, so `
        + "this is post-fence uncertainty and parks rather than failing.",
      );
    }
    const verdict = ucpathTerminationVerdict(input, scan);
    if (verdict.state !== "present") {
      throw new Error(
        `UCPath Save and Submit was clicked for EID ${directIdentifierDisplay(input.emplId)} effective ${input.effectiveDate}, `
        + `and the post-submit read answered ${verdict.state}. PeopleSoft's outcome is unknown; `
        + "refusing to report success. The write may have landed, so this parks for an operator "
        + "(docs/rebuild/reference/write-safety.md §4.1).",
      );
    }
    ctx.recordData([
      { direction: "write", field: "receipt.emplId", value: verdict.proof.emplId },
      { direction: "write", field: "receipt.effectiveDate", value: verdict.proof.effectiveDate },
      { direction: "read", field: "receipt.transactionId", value: verdict.proof.transactionId },
      { direction: "read", field: "receipt.approvalStatus", value: verdict.proof.approvalStatus },
      { direction: "read", field: "receipt.displayedName", value: verdict.proof.displayedName },
      { direction: "read", field: "receipt.kind", value: verdict.proof.kind },
      { direction: "read", field: "receipt.source", value: verdict.proof.source },
    ]);
    return { receipt: verdict.proof };
  },
});
