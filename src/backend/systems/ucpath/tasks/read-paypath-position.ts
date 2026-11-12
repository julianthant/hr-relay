import { failureCodeFromTaskCode, operatorFailureSentence } from "../../../../models/failures/error-catalog.js";
import { UcpathReadPayPathPosition } from "../../../../models/systems/ucpath/read-paypath-position.js";
import { UcpathPayPathRefusedError } from "../../../../models/ui/ucpath-paypath.js";
import { defineTask } from "../../../../workflow-kit/task.js";
import { ucpathDriver } from "../driver-declaration.js";

export const readPayPathPositionTask = defineTask(ucpathDriver, UcpathReadPayPathPosition, {
  screenshots: "task",
  sessions: [{ system: "ucpath", access: "read", session: "reuse-worker" }],
  async run({ input, ctx }) {
    const read = await ctx.driver.readPayPathPosition({ emplId: input.emplId }).catch((error: unknown) => {
      if (ctx.signal.aborted || !(error instanceof UcpathPayPathRefusedError)) throw error;
      if (error.code === "paypath-alert-shown") ctx.recordData({ direction: "read", field: "alertText", value: error.alertText ?? "" });
      return ctx.fail(error.code, operatorFailureSentence(failureCodeFromTaskCode(error.code)), { cause: error });
    });
    if (read.emplId !== input.emplId) {
      return ctx.fail("subject-mismatch", operatorFailureSentence(failureCodeFromTaskCode("subject-mismatch")));
    }
    await ctx.captureScreenshot();
    ctx.recordData([
      { direction: "read", field: "pageStateId", value: read.pageStateId },
      { direction: "read", field: "emplId", value: read.emplId },
      { direction: "read", field: "displayedName", value: read.displayedName },
      { direction: "read", field: "position", value: read.position },
      { direction: "read", field: "observedAt", value: read.observedAt },
    ]);
    return read;
  },
});
