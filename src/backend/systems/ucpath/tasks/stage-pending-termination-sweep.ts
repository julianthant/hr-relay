import { defineTask } from "../../../../workflow-kit/task.js";
import { UcpathStagePendingTerminationSweep } from "../../../../models/systems/ucpath/stage-pending-termination-sweep.js";
import { directIdentifierDisplay } from "../../../../rules/redaction/redaction.js";
import { ucpathDriver } from "../driver-declaration.js";


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
