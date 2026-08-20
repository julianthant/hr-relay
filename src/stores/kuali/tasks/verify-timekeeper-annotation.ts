import { defineTask } from "../../../base/task.js";
import { KualiVerifyTimekeeperAnnotation } from "../../../domain/contracts/kuali/verify-timekeeper-annotation.js";
import { kualiDriver } from "../declaration.js";
import { kualiTimekeeperVerdict } from "../timekeeper-verdict.js";

/**
 * Beat ⑥'s completion verifier. It runs on the RETAINED transaction page
 * immediately after the click, and its reload is the only thing that can turn
 * a UI-silent Kuali save into landing proof (ref write-safety §13 OQ1 (a)).
 *
 * Anything other than `present` parks the run: `absent` means the save did not
 * take, `unknown` means we could not tell, and neither may report success.
 */
export const verifyTimekeeperAnnotationTask = defineTask(kualiDriver, KualiVerifyTimekeeperAnnotation, {
  sessions: [{ system: "kuali", access: "read", session: "reuse-worker" }],
  async run({ input, ctx }) {
    const readBack = await ctx.driver.readSavedTimekeeper(input);
    const observedEid = readBack.state === "present"
      ? readBack.proof.observedEid
      : readBack.state === "absent" ? readBack.observedEid : undefined;
    if (observedEid !== undefined && observedEid !== input.emplId) {
      return ctx.fail(
        "subject-mismatch",
        `Kuali post-save read-back for document ${input.documentNumber} displays a different EID than `
        + "the run named; refusing to accept it as proof of this write",
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
