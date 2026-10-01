import { defineTask } from "../../../base/task.js";
import { UcpathVerifyTermination } from "../../../domain/contracts/ucpath/verify-termination.js";
import { directIdentifierDisplay } from "../../../domain/redaction.js";
import { ucpathDriver } from "../driver-declaration.js";
import { firstDisagreeingName, ucpathTerminationVerdict } from "../termination-verdict.js";

/**
 * Beat ⑥'s completion verifier. It re-reads the SS Smart HR surface after the
 * click and is the ONLY thing that may turn a submitted wizard into `done`.
 *
 * Every non-`present` verdict parks: `absent` means the submit did not take
 * (S50), `unknown` means we could not tell (S51/S52), and neither may report
 * success. Legacy's own best line — "PeopleSoft's outcome is unknown, refusing
 * to report success" — is this arm, kept as a kernel state rather than a throw.
 */
export const verifyTerminationTask = defineTask(ucpathDriver, UcpathVerifyTermination, {
  sessions: [{ system: "ucpath", access: "read", session: "reuse-worker" }],
  async run({ input, ctx }) {
    const scan = await ctx.driver.scanTerminationTransactions({ emplId: input.emplId });
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
