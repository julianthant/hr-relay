import { defineTask } from "../../../../workflow-kit/task.js";
import { UcpathMatchPendingTerminations } from "../../../../models/systems/ucpath/match-pending-terminations.js";
import { directIdentifierDisplay } from "../../../../rules/redaction/redaction.js";
import { ucpathDriver } from "../driver-declaration.js";
import { firstDisagreeingName, ucpathPendingSweepVerdict } from "../termination-verdict.js";


export const matchPendingTerminationsTask = defineTask(
  ucpathDriver,
  UcpathMatchPendingTerminations,
  {
    sessions: [{ system: "ucpath", access: "read", session: "reuse-worker" }],
    async run({ input, ctx }) {
      const scan = await ctx.driver.scanTerminationTransactions({ emplId: input.emplId });
      if (scan.state === "unreadable") {
        // Instrumentation only: preserve the page observation before the fold
        // returns the unchanged `unknown` checkpoint shape.
        ctx.recordData({ direction: "read", field: "diagnostic", value: scan.diagnostic });
      }
      const disagreeing = firstDisagreeingName(scan, input.expectedName);
      if (disagreeing !== undefined) {
        return ctx.fail(
          "subject-mismatch",
          `UCPath returned a transaction for ${directIdentifierDisplay(disagreeing)} while the run named `
          + `${directIdentifierDisplay(input.expectedName)}; a sweep is a DELETE keyed only by a person, so a `
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
