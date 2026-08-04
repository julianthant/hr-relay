import { defineTask } from "../../../base/task.js";
import { KualiReadTimekeeperAnnotation } from "../../../domain/contracts/kuali/read-timekeeper-annotation.js";
import { kualiDriver } from "../declaration.js";
import { kualiTimekeeperVerdict } from "../timekeeper-verdict.js";

/**
 * Beat ①'s live probe: does this document ALREADY carry this exact timekeeper
 * value? It runs on its own read lease and may navigate freely, which is why it
 * re-opens the document rather than assuming any page state.
 *
 * A subject that does not match the expected EID is a `subject-mismatch`
 * failure, not an absence — reading the wrong person's document and reporting
 * "not there" is precisely how a duplicate write would be authorized.
 */
export const readTimekeeperAnnotationTask = defineTask(kualiDriver, KualiReadTimekeeperAnnotation, {
  sessions: [{ system: "kuali", access: "read", session: "reuse-worker" }],
  async run({ input, ctx }) {
    const readBack = await ctx.driver.readSavedTimekeeper(input);
    const observedEid = readBack.state === "present"
      ? readBack.proof.observedEid
      : readBack.state === "absent" ? readBack.observedEid : undefined;
    if (observedEid !== undefined && observedEid !== input.emplId) {
      return ctx.fail(
        "subject-mismatch",
        `Kuali document ${input.documentNumber} displays a different EID than the run named; `
        + "an absence read off the wrong person's document is not evidence",
        { subject: input.emplId },
      );
    }
    const verdict = kualiTimekeeperVerdict(input, readBack);
    ctx.recordData([
      { direction: "read", field: "state", value: verdict.state },
      { direction: "read", field: "documentNumber", value: input.documentNumber },
    ]);
    return verdict;
  },
});
