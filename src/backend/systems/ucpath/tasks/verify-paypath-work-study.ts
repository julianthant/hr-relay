import { UcpathVerifyPayPathWorkStudy } from "../../../../models/systems/ucpath/verify-paypath-work-study.js";
import { directIdentifierDisplay } from "../../../../rules/redaction/redaction.js";
import { workStudyTransactionVerdict } from "../../../../rules/work-study/transaction-verdict.js";
import { defineTask } from "../../../../workflow-kit/task.js";
import { ucpathDriver } from "../driver-declaration.js";
import { firstDisagreeingName } from "../termination-verdict.js";

// Only this independent read-back after Save and Submit can prove completion; every verdict other than present parks.
export const verifyPayPathWorkStudyTask = defineTask(ucpathDriver, UcpathVerifyPayPathWorkStudy, {
  sessions: [{ system: "ucpath", access: "read", session: "reuse-worker" }],
  async run({ input, ctx }) {
    const findings = await ctx.driver.readTransactionFindings({ emplId: input.emplId });
    if (findings.state === "read" && findings.emplId !== input.emplId) {
      return ctx.fail("subject-mismatch", "UCPath transaction findings belong to another employee", { subject: input.emplId });
    }
    const disagreeing = firstDisagreeingName(findings, input.expectedName);
    if (disagreeing !== undefined) {
      return ctx.fail("subject-mismatch",
        `UCPath post-submit read-back returned a transaction for ${directIdentifierDisplay(disagreeing)} while the run named `
        + `${directIdentifierDisplay(input.expectedName)}; refusing to accept it as proof of this write`, { subject: input.emplId });
    }
    const verdict = workStudyTransactionVerdict(input, findings);
    ctx.recordData([{ direction: "read", field: "state", value: verdict.state }]);
    return verdict;
  },
});
