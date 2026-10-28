import { defineTask } from "../../../../workflow-kit/task.js";
import { UcpathVerifyTermination } from "../../../../models/systems/ucpath/verify-termination.js";
import { directIdentifierDisplay } from "../../../../rules/redaction/redaction.js";
import { ucpathDriver } from "../driver-declaration.js";
import { firstDisagreeingName, ucpathTerminationVerdict } from "../termination-verdict.js";

// Only the post-submit read can prove completion; every non-present verdict parks.
export const verifyTerminationTask = defineTask(ucpathDriver, UcpathVerifyTermination, {
  sessions: [{ system: "ucpath", access: "read", session: "reuse-worker" }],
  async run({ input, ctx }) {
    const scan = await ctx.driver.scanTerminationTransactions({ emplId: input.emplId, ...(input.transactionId === undefined ? {} : { transactionId: input.transactionId }) });
    const disagreeing = firstDisagreeingName(scan, input.expectedName);
    if (disagreeing !== undefined) {
      return ctx.fail(
        "subject-mismatch",
        `UCPath post-submit read-back returned a transaction for ${directIdentifierDisplay(disagreeing)} while `
        + `the run named ${directIdentifierDisplay(input.expectedName)}; refusing to accept it as proof of this `
        + "write",
        { subject: input.emplId },
      );
    }
    const verdict = ucpathTerminationVerdict(input, scan);
    ctx.recordData([
      { direction: "read", field: "state", value: verdict.state },
      { direction: "read", field: "emplId", value: input.emplId },
      { direction: "read", field: "effectiveDate", value: input.effectiveDate },
    ]);
    return verdict;
  },
});
