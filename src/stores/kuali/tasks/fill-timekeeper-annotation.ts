import { defineTask } from "../../../base/task.js";
import { KualiFillTimekeeperAnnotation } from "../../../domain/contracts/kuali/fill-timekeeper-annotation.js";
import { kualiDriver } from "../declaration.js";

/**
 * Beat ②. It opens the document, stages the value, and proves the field read it
 * back. It saves nothing: closing the page here leaves Kuali byte-identical,
 * which is what makes the dry-run preview a genuine no-effect operation.
 *
 * The EID check here is defence in depth, not the subject binding: the kernel
 * re-observes the subject itself at beat ③ on this exact page, and that is the
 * observation the fence is bound to. This one exists so a wrong document fails
 * before the kernel ever reaches the fence path.
 */
export const fillTimekeeperAnnotationTask = defineTask(kualiDriver, KualiFillTimekeeperAnnotation, {
  sessions: [{ system: "kuali", access: "transaction", session: "reuse-worker" }],
  async run({ input, ctx }) {
    const staging = await ctx.driver.stageTimekeeperName({
      actionId: input.actionId,
      documentNumber: input.documentNumber,
      timekeeperName: input.timekeeperName,
    });
    if (staging.observedEid !== input.emplId) {
      return ctx.fail(
        "subject-mismatch",
        `Kuali document ${input.documentNumber} displays a different EID than the run named; `
        + "refusing to leave a staged value on another person's document",
        { subject: input.emplId },
      );
    }
    if (staging.stagedTimekeeperName !== input.timekeeperName) {
      return ctx.fail(
        "fill-not-persisted",
        `Kuali document ${input.documentNumber} read back a different staged timekeeper value`,
        { subject: input.emplId },
      );
    }
    ctx.recordData([
      { direction: "write", field: "stagedTimekeeperName", value: staging.stagedTimekeeperName },
      { direction: "read", field: "previousTimekeeperName", value: staging.previousTimekeeperName },
      { direction: "read", field: "documentNumber", value: staging.documentNumber },
    ]);
    return {
      stagedPageState: staging.pageStateId,
      actionId: staging.actionId,
      documentNumber: staging.documentNumber,
      observedEid: staging.observedEid,
      previousTimekeeperName: staging.previousTimekeeperName,
      stagedTimekeeperName: staging.stagedTimekeeperName,
      observedAt: staging.observedAt,
    };
  },
});
