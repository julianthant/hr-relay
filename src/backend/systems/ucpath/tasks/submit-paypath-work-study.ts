import { operatorFailureSentence } from "../../../../models/failures/error-catalog.js";
import { UcpathSubmitPayPathWorkStudy } from "../../../../models/systems/ucpath/submit-paypath-work-study.js";
import { UcpathPayPathSubmitRefusedError } from "../../../../models/ui/ucpath-paypath.js";
import { directIdentifierDisplay } from "../../../../rules/redaction/redaction.js";
import { workStudyTransactionVerdict } from "../../../../rules/work-study/transaction-verdict.js";
import { defineTask } from "../../../../workflow-kit/task.js";
import { ucpathDriver } from "../driver-declaration.js";
import { firstDisagreeingName } from "../termination-verdict.js";

// Everything here runs after the fence: a refusal or an unproven read-back parks the write as UNKNOWN and is never clicked again.
export const submitPayPathWorkStudyTask = defineTask(ucpathDriver, UcpathSubmitPayPathWorkStudy, {
  sessions: [{ system: "ucpath", access: "transaction", session: "reuse-worker" }],
  async run({ input, ctx }) {
    await ctx.driver.submitPayPathWorkStudy(input, ctx.mutation).catch((error: unknown) => {
      if (!(error instanceof UcpathPayPathSubmitRefusedError)) throw error;
      ctx.recordData({ direction: "read", field: "alertText", value: error.alertText });
      return ctx.fail("paypath-submit-refused", operatorFailureSentence("PAYPATH_SUBMIT_REFUSED"), { subject: input.emplId, cause: error });
    });
    const findings = await ctx.driver.readTransactionFindings({ emplId: input.emplId });
    const disagreeing = firstDisagreeingName(findings, input.expectedName);
    if (disagreeing !== undefined) {
      throw new Error(`UCPath post-submit read-back returned a transaction for ${directIdentifierDisplay(disagreeing)} while the run named `
        + `${directIdentifierDisplay(input.expectedName)}. The Save already happened, so this parks.`);
    }
    const verdict = workStudyTransactionVerdict(input, findings);
    if (verdict.state !== "present") {
      throw new Error(`PayPath Save and Submit was clicked for EID ${directIdentifierDisplay(input.emplId)} effective ${input.effectiveDate}, `
        + `and the post-submit read answered ${verdict.state}. The outcome is unknown; refusing to report success.`);
    }
    ctx.recordData({ direction: "read", field: "receipt", value: verdict.proof });
    return { receipt: verdict.proof };
  },
});
