import { failureCodeFromTaskCode, operatorFailureSentence } from "../../../../models/failures/error-catalog.js";
import { UcpathSubmitPayPathWorkStudy } from "../../../../models/systems/ucpath/submit-paypath-work-study.js";
import { UcpathPayPathSubmitRefusedError } from "../../../../models/ui/ucpath-paypath.js";
import { directIdentifierDisplay } from "../../../../rules/redaction/redaction.js";
import { defineTask } from "../../../../workflow-kit/task.js";
import { ucpathDriver } from "../driver-declaration.js";
import { workStudySavedVerdict } from "../../../../rules/work-study/transaction-verdict.js";
import { readWorkStudyVerdict } from "../work-study-findings.js";

// Everything here runs after the fence: a refusal or an unproven read-back parks the write as UNKNOWN and is never clicked again.
export const submitPayPathWorkStudyTask = defineTask(ucpathDriver, UcpathSubmitPayPathWorkStudy, {
  sessions: [{ system: "ucpath", access: "transaction", session: "reuse-worker" }],
  async run({ input, ctx }) {
    await ctx.driver.submitPayPathWorkStudy(input, ctx.mutation).catch((error: unknown) => {
      if (!(error instanceof UcpathPayPathSubmitRefusedError)) throw error;
      ctx.recordData({ direction: "read", field: "alertText", value: error.alertText });
      return ctx.fail("paypath-submit-refused", operatorFailureSentence(failureCodeFromTaskCode("paypath-submit-refused")), { subject: input.emplId, cause: error });
    });
    const verdict = await readWorkStudyVerdict(ctx.driver, input, workStudySavedVerdict, (_code, message) => {
      throw new Error(`${message}. The Save already happened, so this parks.`);
    });
    if (verdict.state !== "present") {
      throw new Error(`PayPath Save and Submit was clicked for EID ${directIdentifierDisplay(input.emplId)} effective ${input.effectiveDate}, `
        + `and the post-submit read answered ${verdict.state}. The outcome is unknown; refusing to report success.`);
    }
    ctx.recordData({ direction: "read", field: "receipt", value: verdict.proof });
    return { receipt: verdict.proof };
  },
});
