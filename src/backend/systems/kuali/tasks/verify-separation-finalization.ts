import { defineTask } from "../../../../base/task.js";
import { KualiVerifySeparationFinalization } from "../../../../domain/contracts/kuali/verify-separation-finalization.js";
import { kualiDriver } from "../driver-declaration.js";
import { kualiFinalizationVerdict } from "../finalization-verdict.js";

/**
 * Beat ⑥'s completion verifier — §4e's fourth beat, and the answer to the
 * behavior review's open question under **S59**.
 *
 * It runs on the RETAINED transaction page immediately after the click, and its
 * reload is the only thing that can turn a UI-silent Kuali save into landing
 * proof. Anything other than `present` parks the run: `absent` means the save
 * did not take (or took only partly, which is not a finalization), `unknown`
 * means we could not tell, and neither may report success.
 */
export const verifySeparationFinalizationTask = defineTask(
  kualiDriver,
  KualiVerifySeparationFinalization,
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
            `Kuali post-save read-back for document ${input.documentNumber} displays a different EID than `
            + "the run named; refusing to accept it as proof of this write",
            { subject: input.emplId },
          );
        }
        const observedNumber = readBack.state === "present"
          ? readBack.proof.documentNumber
          : readBack.documentNumber;
        if (observedNumber !== input.documentNumber) {
          return ctx.fail(
            "unexpected-page-state",
            `the Kuali post-save read-back returned document ${observedNumber} while the task ran for `
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
