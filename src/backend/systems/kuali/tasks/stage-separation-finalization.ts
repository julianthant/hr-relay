import { defineTask } from "../../../../workflow-kit/task.js";
import { KualiStageSeparationFinalization } from "../../../../models/systems/kuali/stage-separation-finalization.js";
import {
  KualiCommentsChangedError,
  KualiDepartmentOptionNotOfferedError,
  KualiFinalizationStageNotPersistedError,
} from "../../../../models/ui/kuali-separation-finalization.js";
import { kualiDriver } from "../driver-declaration.js";

/**
 * Beat ②. It opens the document, stages every finalization field in ONE pass
 * from the run's stored variables, and saves nothing.
 *
 * The EID check here is defence in depth, not the subject binding: the kernel
 * re-observes the subject itself at beat ③ on this exact page, and that is the
 * observation the fence is bound to. This one exists so a wrong document fails
 * before the kernel ever reaches the fence path.
 *
 * The three typed driver refusals below are TYPES rather than message matches,
 * so each maps to exactly one durable error code and nothing else can land on
 * it. Anything else the driver throws re-throws untouched — a page that crashed
 * is not a page that told us something.
 */
export const stageSeparationFinalizationTask = defineTask(
  kualiDriver,
  KualiStageSeparationFinalization,
  {
    sessions: [{ system: "kuali", access: "transaction", session: "reuse-worker" }],
    async run({ input, ctx }) {
      const staging = await ctx.driver.stageSeparationFinalization(input).catch((error: unknown) => {
        if (error instanceof KualiDepartmentOptionNotOfferedError) {
          // S55: legacy throws here too, and that refusal is the sound one —
          // what is new is that the run records the whole option list.
          return ctx.fail("department-option-not-offered", error.message, {
            subject: input.emplId,
            cause: error,
          });
        }
        if (error instanceof KualiCommentsChangedError) {
          // S56, strengthened: legacy refuses only when the READ throws.
          return ctx.fail("comments-changed-since-read", error.message, {
            subject: input.emplId,
            cause: error,
          });
        }
        if (error instanceof KualiFinalizationStageNotPersistedError) {
          return ctx.fail("stage-not-persisted", error.message, {
            subject: input.emplId,
            cause: error,
          });
        }
        throw error;
      });

      if (staging.observedEid !== input.emplId) {
        return ctx.fail(
          "subject-mismatch",
          `Kuali document ${input.documentNumber} displays a different EID than the run named; `
          + "refusing to leave a staged finalization on another person's document",
          { subject: input.emplId },
        );
      }
      if (staging.documentNumber !== input.documentNumber || staging.actionId !== input.actionId) {
        return ctx.fail(
          "unexpected-page-state",
          `the Kuali driver staged document ${staging.documentNumber} (${staging.actionId}) while the `
          + `task ran for ${input.documentNumber} (${input.actionId})`,
          { subject: input.emplId },
        );
      }

      ctx.recordData([
        { direction: "read", field: "stagedPageState", value: staging.stagedPageState },
        { direction: "read", field: "actionId", value: staging.actionId },
        { direction: "read", field: "documentNumber", value: staging.documentNumber },
        { direction: "read", field: "observedEid", value: staging.observedEid },
        { direction: "read", field: "previousFields", value: staging.previousFields },
        { direction: "write", field: "stagedFields", value: staging.stagedFields },
        {
          direction: "read",
          field: "observedDepartmentOptions",
          value: staging.observedDepartmentOptions,
        },
        { direction: "read", field: "observedAt", value: staging.observedAt },
      ]);
      return staging;
    },
  },
);
