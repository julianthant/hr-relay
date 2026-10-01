import { defineTask } from "../../../base/task.js";
import { UcpathVerifyPendingTerminationsCleared } from "../../../domain/contracts/ucpath/verify-pending-terminations-cleared.js";
import { directIdentifierDisplay } from "../../../domain/redaction.js";
import { ucpathDriver } from "../driver-declaration.js";
import { firstDisagreeingName, ucpathPendingSweepVerdict } from "../termination-verdict.js";

/**
 * The sweep's beat-⑥ read-back: the grid, read again after the Delete, shows no
 * in-progress termination rows for this person.
 *
 * Anything else parks. "We could not check whether the rows are gone" and "the
 * rows are gone" are the two answers a delete verifier must never merge.
 */
export const verifyPendingTerminationsClearedTask = defineTask(
  ucpathDriver,
  UcpathVerifyPendingTerminationsCleared,
  {
    sessions: [{ system: "ucpath", access: "read", session: "reuse-worker" }],
    async run({ input, ctx }) {
      const scan = await ctx.driver.scanTerminationTransactions({ emplId: input.emplId });
      const disagreeing = firstDisagreeingName(scan, input.expectedName);
      if (disagreeing !== undefined) {
        return ctx.fail(
          "subject-mismatch",
          `UCPath post-delete read-back returned a transaction for ${directIdentifierDisplay(disagreeing)} `
          + `while the run named ${directIdentifierDisplay(input.expectedName)}`,
          { subject: input.emplId },
        );
      }
      const verdict = ucpathPendingSweepVerdict(input, scan);
      ctx.recordData([
        { direction: "read", field: "state", value: verdict.state },
        { direction: "read", field: "emplId", value: input.emplId },
      ]);
      return verdict;
    },
  },
);
