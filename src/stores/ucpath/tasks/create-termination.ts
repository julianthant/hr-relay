import { defineTask } from "../../../base/task.js";
import { UcpathCreateTermination } from "../../../domain/contracts/ucpath/create-termination.js";
import {
  UCPATH_SMART_HR_SAVE_AND_SUBMIT_BUTTON,
  UcpathCommitRefusedError,
} from "../../../domain/ui/ucpath-smart-hr-termination.js";
import { ucpathDriver } from "../driver-declaration.js";
import { firstDisagreeingName, ucpathTerminationVerdict } from "../termination-verdict.js";

/**
 * Beat ⑤ — the click that files a real termination, and the second external
 * write in this tree.
 *
 * `ctx.mutation` exists on a commit context and nowhere else, and the driver
 * refuses a capability the fenced write sequencer did not mint, so this cannot
 * click outside an open fence even if it were mis-authored.
 *
 * ## Why it reads afterwards, and what that read is worth
 *
 * The submit renders no receipt: UCPath puts the `T…` on a different page
 * entirely. A commit that returned only "I clicked" could not distinguish
 * **S51** (submit timed out, no banner, no confirmation — outcome unknown) from
 * a landed transaction, so it re-reads the SS Smart HR surface for its own
 * receipt PAIR. That read is a CLAIM; beat ⑥'s independent verifier is what may
 * settle the run `done`.
 *
 * If the read cannot produce a `present` pair, this THROWS rather than
 * returning a shrug — post-fence uncertainty is exactly what the kernel's park
 * path is for (**S51/S52**), and legacy's own best line ("PeopleSoft's outcome
 * is unknown, refusing to report success") is this behaviour.
 */
export const createTerminationTask = defineTask(ucpathDriver, UcpathCreateTermination, {
  sessions: [{ system: "ucpath", access: "transaction", session: "reuse-worker" }],
  async run({ input, ctx }) {
    // S47/S50. The refusal arrives as a typed THROW rather than a
    // `performed: false` proof, because `UiActionProofSchema.performed` is
    // `z.literal(true)` — a proof is always a proof, so the old
    // `!action.performed` branch could never be taken and `submit-refused` had
    // no producer at all.
    const action = await ctx.driver
      .commit(UCPATH_SMART_HR_SAVE_AND_SUBMIT_BUTTON, ctx.mutation)
      .catch((error: unknown) => {
        if (!(error instanceof UcpathCommitRefusedError)) throw error;
        return ctx.fail(
          "submit-refused",
          `UCPath refused Save and Submit for EID ${input.emplId} and rendered `
          + `${JSON.stringify(error.refusal)}. The click happened, so this is post-fence and parks.`,
          { subject: input.emplId, cause: error },
        );
      });
    if (action.effect !== "external-commit") {
      return ctx.fail(
        "submit-refused",
        `UCPath Save and Submit for EID ${input.emplId} reported effect ${action.effect}, not an `
        + "external commit",
        { subject: input.emplId },
      );
    }
    const scan = await ctx.driver.scanTerminationTransactions({ emplId: input.emplId });
    const disagreeing = firstDisagreeingName(scan, input.expectedName);
    if (disagreeing !== undefined) {
      throw new Error(
        `UCPath post-submit read-back returned a transaction for ${JSON.stringify(disagreeing)} while `
        + `the run named ${JSON.stringify(input.expectedName)}. The submit has already happened, so `
        + "this is post-fence uncertainty and parks rather than failing.",
      );
    }
    const verdict = ucpathTerminationVerdict(input, scan);
    if (verdict.state !== "present") {
      throw new Error(
        `UCPath Save and Submit was clicked for EID ${input.emplId} effective ${input.effectiveDate}, `
        + `and the post-submit read answered ${verdict.state}. PeopleSoft's outcome is unknown; `
        + "refusing to report success. The write may have landed, so this parks for an operator "
        + "(docs/rebuild/09-write-safety.md §4.1).",
      );
    }
    ctx.recordData([
      { direction: "write", field: "receipt.emplId", value: verdict.proof.emplId },
      { direction: "write", field: "receipt.effectiveDate", value: verdict.proof.effectiveDate },
      { direction: "read", field: "receipt.transactionId", value: verdict.proof.transactionId },
      { direction: "read", field: "receipt.approvalStatus", value: verdict.proof.approvalStatus },
      { direction: "read", field: "receipt.displayedName", value: verdict.proof.displayedName },
      { direction: "read", field: "receipt.kind", value: verdict.proof.kind },
      { direction: "read", field: "receipt.source", value: verdict.proof.source },
    ]);
    return { receipt: verdict.proof };
  },
});
