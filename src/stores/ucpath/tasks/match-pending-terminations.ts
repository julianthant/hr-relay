import { defineTask } from "../../../base/task.js";
import { UcpathMatchPendingTerminations } from "../../../domain/contracts/ucpath/match-pending-terminations.js";
import { ucpathDriver } from "../driver-declaration.js";
import { firstDisagreeingName, ucpathPendingSweepVerdict } from "../termination-verdict.js";

/**
 * Doc 09 §5's second probe kind, on the same rich read: does this person have
 * ANY in-progress termination?
 *
 * Its polarity is the thing to keep straight — `present` means "there is
 * nothing to sweep", so the sweep settles `already-present` and clicks nothing.
 * That is the common case and it is why the sweep is cheap in practice.
 */
export const matchPendingTerminationsTask = defineTask(
  ucpathDriver,
  UcpathMatchPendingTerminations,
  {
    sessions: [{ system: "ucpath", access: "read", session: "reuse-worker" }],
    async run({ input, ctx }) {
      const scan = await ctx.driver.scanTerminationTransactions({ emplId: input.emplId });
      const disagreeing = firstDisagreeingName(scan, input.expectedName);
      if (disagreeing !== undefined) {
        return ctx.fail(
          "subject-mismatch",
          `UCPath returned a transaction for ${JSON.stringify(disagreeing)} while the run named `
          + `${JSON.stringify(input.expectedName)}; a sweep is a DELETE keyed only by a person, so a `
          + "grid read off the wrong person has no downstream control at all",
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
