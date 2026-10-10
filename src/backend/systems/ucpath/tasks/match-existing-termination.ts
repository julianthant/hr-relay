import { defineTask } from "../../../../workflow-kit/task.js";
import { UcpathMatchExistingTermination } from "../../../../models/systems/ucpath/match-existing-termination.js";
import { directIdentifierDisplay } from "../../../../rules/redaction/redaction.js";
import { ucpathDriver } from "../driver-declaration.js";
import { firstDisagreeingName, ucpathTerminationVerdict } from "../termination-verdict.js";


export const matchExistingTerminationTask = defineTask(ucpathDriver, UcpathMatchExistingTermination, {
  sessions: [{ system: "ucpath", access: "read", session: "reuse-worker" }],
  async run({ input, ctx }) {
    const scan = await ctx.driver.scanTerminationTransactions({ emplId: input.emplId });
    const disagreeing = firstDisagreeingName(scan, input.expectedName);
    if (disagreeing !== undefined) {
      return ctx.fail(
        "subject-mismatch",
        `UCPath returned a transaction for ${directIdentifierDisplay(disagreeing)} while the run named `
        + `${directIdentifierDisplay(input.expectedName)}; an absence read off the wrong person's transaction `
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
