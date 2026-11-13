import { UcpathMatchPayPathWorkStudy } from "../../../../models/systems/ucpath/match-paypath-work-study.js";
import { directIdentifierDisplay } from "../../../../rules/redaction/redaction.js";
import { workStudyTransactionVerdict } from "../../../../rules/work-study/transaction-verdict.js";
import { defineTask } from "../../../../workflow-kit/task.js";
import { ucpathDriver } from "../driver-declaration.js";
import { firstDisagreeingName } from "../termination-verdict.js";

export const matchPayPathWorkStudyTask = defineTask(ucpathDriver, UcpathMatchPayPathWorkStudy, {
  sessions: [{ system: "ucpath", access: "read", session: "reuse-worker" }],
  async run({ input, ctx }) {
    const findings = await ctx.driver.readTransactionFindings({ emplId: input.emplId });
    if (findings.state === "read" && findings.emplId !== input.emplId) {
      return ctx.fail("subject-mismatch", "UCPath transaction findings belong to another employee", { subject: input.emplId });
    }
    const disagreeing = firstDisagreeingName(findings, input.expectedName);
    if (disagreeing !== undefined) {
      return ctx.fail("subject-mismatch",
        `UCPath returned a transaction for ${directIdentifierDisplay(disagreeing)} while the run named ${directIdentifierDisplay(input.expectedName)}; `
        + "an absence read off the wrong person's transaction list is not evidence about this one", { subject: input.emplId });
    }
    const verdict = workStudyTransactionVerdict(input, findings);
    ctx.recordData([{ direction: "read", field: "state", value: verdict.state }]);
    return verdict;
  },
});
