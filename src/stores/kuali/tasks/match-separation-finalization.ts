import { defineTask } from "../../../base/task.js";
import { KualiMatchSeparationFinalization } from "../../../domain/contracts/kuali/match-separation-finalization.js";
import { kualiDriver } from "../declaration.js";
import { kualiFinalizationVerdict } from "../finalization-verdict.js";

/**
 * Beat ①'s live probe: does this document ALREADY carry this finalization?
 *
 * It runs on its own read lease and may navigate freely, which is why the
 * driver re-opens the document rather than assuming any page state.
 *
 * A subject that does not match the expected EID is a `subject-mismatch`
 * failure, not an absence — reading the wrong person's document and reporting
 * "not there" is precisely how a duplicate write would be authorized.
 */
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
