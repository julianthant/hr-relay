import { defineTask } from "../../../base/task.js";
import { UcpathDeletePendingTerminations } from "../../../domain/contracts/ucpath/delete-pending-terminations.js";
import { directIdentifierDigestReference } from "../../../domain/redaction.js";
import {
  UCPATH_SMART_HR_DELETE_SELECTED_BUTTON,
  UcpathCommitRefusedError,
} from "../../../domain/ui/ucpath-smart-hr-termination.js";
import { ucpathDriver } from "../driver-declaration.js";
import { firstDisagreeingName, ucpathPendingSweepVerdict } from "../termination-verdict.js";

/**
 * Beat ⑤ of the sweep: the `Delete Selected Transactions` click.
 *
 * It is a real external write and it deletes rows, which is why it is its own
 * transaction rather than a step inside the termination's prepare — legacy runs
 * the same delete as *the first mutation of the run* with no fence, no key and
 * no read-back (**S30/S31**).
 *
 * Like its sibling, an unreadable post-click state THROWS: rows may already be
 * gone, so "we could not check" parks for an operator instead of settling.
 */
export const deletePendingTerminationsTask = defineTask(
  ucpathDriver,
  UcpathDeletePendingTerminations,
  {
    sessions: [{ system: "ucpath", access: "transaction", session: "reuse-worker" }],
    async run({ input, ctx }) {
      // The refusal arrives as a typed THROW, not a `performed: false` proof —
      // `UiActionProofSchema.performed` is `z.literal(true)`, so the old
      // `!action.performed` branch was unreachable and `delete-refused` had no
      // producer. See `UcpathCommitRefusedError`.
      const action = await ctx.driver
        .commit(UCPATH_SMART_HR_DELETE_SELECTED_BUTTON, ctx.mutation)
        .catch((error: unknown) => {
          if (!(error instanceof UcpathCommitRefusedError)) throw error;
          return ctx.fail(
            "delete-refused",
            `UCPath refused Delete Selected Transactions for EID ${directIdentifierDigestReference(input.emplId)} and rendered `
            + `${JSON.stringify(error.refusal)}. The click happened, so this is post-fence and parks.`,
            { subject: input.emplId, cause: error },
          );
        });
      if (action.effect !== "external-commit") {
        return ctx.fail(
          "delete-refused",
          `UCPath Delete Selected Transactions for EID ${directIdentifierDigestReference(input.emplId)} reported effect `
          + `${action.effect}, not an external commit`,
          { subject: input.emplId },
        );
      }
      const scan = await ctx.driver.scanTerminationTransactions({ emplId: input.emplId });
      const disagreeing = firstDisagreeingName(scan, input.expectedName);
      if (disagreeing !== undefined) {
        throw new Error(
          `UCPath post-delete read-back returned a transaction for ${directIdentifierDigestReference(disagreeing)} `
          + `while the run named ${directIdentifierDigestReference(input.expectedName)}. The delete has already `
          + "happened, so this is post-fence uncertainty and parks.",
        );
      }
      const verdict = ucpathPendingSweepVerdict(input, scan);
      if (verdict.state !== "present") {
        throw new Error(
          `UCPath Delete Selected Transactions was clicked for EID ${directIdentifierDigestReference(input.emplId)} and the post-delete `
          + `read answered ${verdict.state}. Refusing to report the sweep complete; rows may already `
          + "be gone, so this parks for an operator (docs/rebuild/reference/write-safety.md §4.1).",
        );
      }
      ctx.recordData([
        { direction: "write", field: "cleared.emplId", value: verdict.proof.emplId },
        { direction: "read", field: "cleared.scannedRowCount", value: verdict.proof.scannedRowCount },
        { direction: "read", field: "cleared.observedAt", value: verdict.proof.observedAt },
        { direction: "read", field: "cleared.kind", value: verdict.proof.kind },
        { direction: "read", field: "cleared.source", value: verdict.proof.source },
      ]);
      return { cleared: verdict.proof };
    },
  },
);
