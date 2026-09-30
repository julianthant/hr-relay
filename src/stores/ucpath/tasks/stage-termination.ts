import { defineTask } from "../../../base/task.js";
import { UcpathStageTermination } from "../../../domain/contracts/ucpath/stage-termination.js";
import { directIdentifierDisplay } from "../../../domain/redaction.js";
import { UcpathEmplIdNotRecognizedError } from "../../../domain/ui/ucpath-smart-hr-termination.js";
import { ucpathDriver } from "../driver-declaration.js";

/**
 * Beat ②. It stages ALL THREE wizard pages and saves nothing.
 *
 * That is not a shortcut: the 2026-08-13 live check proved the Smart HR wizard
 * leaves **zero durable footprint** before an explicit Save — the *Transactions
 * in Progress* grid was byte-identical after every stage and `Transaction ID`
 * read the literal `"NEW"` throughout. So closing the page here leaves UCPath
 * untouched, which is what makes `dryRun:"stop-after-prepare"` a genuine
 * no-effect preview of a real termination.
 *
 * The name check here is defence in depth, not the subject binding: the kernel
 * re-observes the subject itself at beat ③ on this exact page, and that is the
 * observation the fence is bound to. This one exists so a wrong person fails
 * before the kernel ever reaches the fence path.
 */
export const stageTerminationTask = defineTask(ucpathDriver, UcpathStageTermination, {
  sessions: [{ system: "ucpath", access: "transaction", session: "reuse-worker" }],
  async run({ input, ctx }) {
    // **S48.** UCPath refusing the typed Empl ID has no staging value to return
    // — no subject, no employment record, no page — so the driver throws, and
    // the TYPE is what lets this become the contract's own `emplid-not-recognized`
    // rather than an untyped failure indistinguishable from a page crash. Any
    // other error re-throws untouched.
    const staging = await ctx.driver.stageTermination(input).catch((error: unknown) => {
      if (!(error instanceof UcpathEmplIdNotRecognizedError)) throw error;
      return ctx.fail("emplid-not-recognized", error.message, {
        subject: input.emplId,
        cause: error,
      });
    });
    if (staging.emplId !== input.emplId) {
      return ctx.fail(
        "subject-mismatch",
        `UCPath staged a termination for EID ${directIdentifierDisplay(staging.emplId)} while the run named ${directIdentifierDisplay(input.emplId)}`,
        { subject: input.emplId },
      );
    }
    if (staging.effectiveDate !== input.effectiveDate) {
      return ctx.fail(
        "stage-not-persisted",
        `UCPath read back effective date ${staging.effectiveDate}, not the ${input.effectiveDate} `
        + "this run staged; the effective date is half the permanent key, so a silent revert here "
        + "would file a termination the idempotency probe never asked about",
        { subject: input.emplId },
      );
    }
    if (staging.lastDateWorked !== input.lastDateWorked) {
      // S49, and it is the model the rest of this family follows: legacy already
      // treats an unverifiable Last Date Worked as FATAL before any submit.
      return ctx.fail(
        "last-date-worked-not-verified",
        `UCPath read back Last Date Worked ${staging.lastDateWorked}, not the ${input.lastDateWorked} `
        + "this run staged",
        { subject: input.emplId },
      );
    }
    if (!staging.observedReasonOptions.includes(staging.resolvedReasonOption)) {
      return ctx.fail(
        "reason-code-not-offered",
        `UCPath's Action Reason control does not offer `
        + `${JSON.stringify(staging.resolvedReasonOption)}; the ${String(staging.observedReasonOptions.length)} `
        + "options it did offer are recorded on this run. Refusing to file a reason code the control "
        + "never carried.",
        { subject: input.emplId },
      );
    }
    ctx.recordData([
      { direction: "read", field: "observedName", value: staging.observedName },
      { direction: "read", field: "observedEmplRecord", value: staging.observedEmplRecord },
      { direction: "read", field: "observedReasonOptions", value: staging.observedReasonOptions },
      { direction: "read", field: "transactionIdDisplay", value: staging.transactionIdDisplay },
      { direction: "write", field: "template", value: staging.template },
      { direction: "write", field: "transactionDate", value: staging.transactionDate },
      { direction: "write", field: "effectiveDate", value: staging.effectiveDate },
      { direction: "write", field: "resolvedReasonOption", value: staging.resolvedReasonOption },
      { direction: "write", field: "lastDateWorked", value: staging.lastDateWorked },
      { direction: "write", field: "lastDateWorkedOverridden", value: staging.lastDateWorkedOverridden },
      { direction: "read", field: "emplId", value: staging.emplId },
      { direction: "read", field: "stagedPageState", value: staging.stagedPageState },
      { direction: "read", field: "observedAt", value: staging.observedAt },
    ]);
    return staging;
  },
});
