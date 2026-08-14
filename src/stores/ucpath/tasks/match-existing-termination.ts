import { defineTask } from "../../../base/task.js";
import { UcpathMatchExistingTermination } from "../../../domain/contracts/ucpath/match-existing-termination.js";
import { ucpathDriver } from "../driver-declaration.js";
import { firstDisagreeingName, ucpathTerminationVerdict } from "../termination-verdict.js";

/**
 * Beat ①'s live probe (S44): does this person already have a termination
 * effective this date?
 *
 * It runs on its own read lease and re-reads the search page rather than
 * assuming any page state. A row whose displayed name is not this person's is a
 * `subject-mismatch` FAILURE, not an absence — reading the wrong person's
 * transaction list and reporting "not there" is precisely how a duplicate
 * termination gets authorized.
 */
export const matchExistingTerminationTask = defineTask(ucpathDriver, UcpathMatchExistingTermination, {
  sessions: [{ system: "ucpath", access: "read", session: "reuse-worker" }],
  async run({ input, ctx }) {
    const scan = await ctx.driver.scanTerminationTransactions({ emplId: input.emplId });
    const disagreeing = firstDisagreeingName(scan, input.expectedName);
    if (disagreeing !== undefined) {
      return ctx.fail(
        "subject-mismatch",
        `UCPath returned a transaction for ${JSON.stringify(disagreeing)} while the run named `
        + `${JSON.stringify(input.expectedName)}; an absence read off the wrong person's transaction `
        + "list is not evidence about this one",
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
