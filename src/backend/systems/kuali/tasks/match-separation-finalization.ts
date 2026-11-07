import { defineTask } from "../../../../workflow-kit/task.js";
import { KualiMatchSeparationFinalization } from "../../../../models/systems/kuali/match-separation-finalization.js";
import { kualiDriver } from "../driver-declaration.js";
import { kualiFinalizationVerdict } from "../finalization-verdict.js";


export const matchSeparationFinalizationTask = defineTask(
  kualiDriver,
  KualiMatchSeparationFinalization,
  {
    sessions: [{ system: "kuali", access: "read", session: "reuse-worker" }],
    async run({ input, ctx }) {
      const readBack = await ctx.driver.readSavedSeparationFinalization(input);
      if (readBack.state !== "unknown") {
        if (readBack.state === "present"
          ? readBack.proof.observedEid !== input.emplId
          : readBack.observedEid !== input.emplId) {
          return ctx.fail(
            "subject-mismatch",
            `Kuali document ${input.documentNumber} displays a different EID than the run named; `
            + "an absence read off the wrong person's document is not evidence",
            { subject: input.emplId },
          );
        }
        const observedNumber = readBack.state === "present"
          ? readBack.proof.documentNumber
          : readBack.documentNumber;
        if (observedNumber !== input.documentNumber) {
          return ctx.fail(
            "unexpected-page-state",
            `the Kuali driver probed document ${observedNumber} while the task ran for `
            + `${input.documentNumber}`,
            { subject: input.emplId },
          );
        }
      }
      const verdict = kualiFinalizationVerdict(input, readBack);
      ctx.recordData([
        { direction: "read", field: "state", value: verdict.state },
        { direction: "read", field: "documentNumber", value: input.documentNumber },
        { direction: "read", field: "transactionNumber", value: input.variables.transactionNumber },
      ]);
      return verdict;
    },
  },
);
