import { defineTask } from "../../../../workflow-kit/task.js";
import { UcpathVerifyPendingTerminationsCleared } from "../../../../models/systems/ucpath/verify-pending-terminations-cleared.js";
import { directIdentifierDisplay } from "../../../../rules/redaction/redaction.js";
import { ucpathDriver } from "../driver-declaration.js";
import { firstDisagreeingName, ucpathPendingSweepVerdict } from "../termination-verdict.js";


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
