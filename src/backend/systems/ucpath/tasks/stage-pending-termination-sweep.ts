import { defineTask } from "../../../../workflow-kit/task.js";
import { UcpathStagePendingTerminationSweep } from "../../../../models/systems/ucpath/stage-pending-termination-sweep.js";
import { directIdentifierDisplay } from "../../../../rules/redaction/redaction.js";
import { ucpathDriver } from "../driver-declaration.js";

/**
 * The sweep's beat ②: tick the Select checkbox on every in-progress
 * `Terminat*` row for this person, read back which rows were ticked, stop.
 *
 * Ticking a checkbox is page state and nothing more, so the whole selection
 * sits on the reversible side of the fence — the same property the termination
 * wizard has, for the same reason.
 */
export const stagePendingTerminationSweepTask = defineTask(
  ucpathDriver,
  UcpathStagePendingTerminationSweep,
  {
    sessions: [{ system: "ucpath", access: "transaction", session: "reuse-worker" }],
    async run({ input, ctx }) {
      const staging = await ctx.driver.stagePendingTerminationSweep(input);
      if (staging.emplId !== input.emplId) {
        return ctx.fail(
          "subject-mismatch",
          `UCPath selected in-progress rows for EID ${directIdentifierDisplay(staging.emplId)} while the run named `
          + `${directIdentifierDisplay(input.emplId)}`,
          { subject: input.emplId },
        );
      }
      ctx.recordData([
        { direction: "read", field: "observedName", value: staging.observedName },
        { direction: "write", field: "selected", value: staging.selected },
        { direction: "read", field: "emplId", value: staging.emplId },
        { direction: "read", field: "stagedPageState", value: staging.stagedPageState },
        { direction: "read", field: "observedAt", value: staging.observedAt },
      ]);
      return staging;
    },
  },
);
