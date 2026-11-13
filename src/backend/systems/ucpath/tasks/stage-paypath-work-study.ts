import { failureCodeFromTaskCode, operatorFailureSentence } from "../../../../models/failures/error-catalog.js";
import { UcpathStagePayPathWorkStudy } from "../../../../models/systems/ucpath/stage-paypath-work-study.js";
import { UcpathPayPathRefusedError } from "../../../../models/ui/ucpath-paypath.js";
import { defineTask } from "../../../../workflow-kit/task.js";
import { ucpathDriver } from "../driver-declaration.js";

const refuse = (code: Parameters<typeof failureCodeFromTaskCode>[0]) => operatorFailureSentence(failureCodeFromTaskCode(code));

// Filling PayPath Actions leaves nothing in UCPath until Save and Submit; every value is read back from the page, not echoed.
export const stagePayPathWorkStudyTask = defineTask(ucpathDriver, UcpathStagePayPathWorkStudy, {
  sessions: [{ system: "ucpath", access: "transaction", session: "reuse-worker" }],
  async run({ input, ctx }) {
    const staged = await ctx.driver.stagePayPathWorkStudy(input).catch((error: unknown) => {
      if (ctx.signal.aborted || !(error instanceof UcpathPayPathRefusedError)) throw error;
      if (error.code === "paypath-alert-shown" && error.alertText !== undefined) ctx.recordData({ direction: "read", field: "alertText", value: error.alertText });
      return ctx.fail(error.code, refuse(error.code), { cause: error });
    });
    if (staged.emplId !== input.emplId) return ctx.fail("subject-mismatch", refuse("subject-mismatch"));
    const kept = staged.values;
    if (kept.effectiveDate !== input.effectiveDate || kept.positionChangeReason !== input.positionChangeReason || kept.positionPool !== input.positionPool
      || kept.jobDataComments !== input.comments || kept.initiatorComments !== input.comments) {
      return ctx.fail("staged-value-mismatch", refuse("staged-value-mismatch"));
    }
    await ctx.captureScreenshot();
    ctx.recordData([
      { direction: "read", field: "staged.pageStateId", value: staged.pageStateId },
      { direction: "read", field: "staged.emplId", value: staged.emplId },
      { direction: "read", field: "staged.displayedName", value: staged.displayedName },
      { direction: "write", field: "staged.values", value: staged.values },
      { direction: "read", field: "staged.observedAt", value: staged.observedAt },
    ]);
    return { staged, stagedPageState: staged.pageStateId };
  },
});
