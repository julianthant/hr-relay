import { defineTask } from "../../../../workflow-kit/task.js";
import { UcpathDeletePendingTerminations } from "../../../../models/systems/ucpath/delete-pending-terminations.js";
import { directIdentifierDisplay } from "../../../../rules/redaction/redaction.js";
import {
  UCPATH_SMART_HR_DELETE_SELECTED_BUTTON,
  UcpathCommitRefusedError,
} from "../../../../models/ui/ucpath-smart-hr-termination.js";
import { ucpathDriver } from "../driver-declaration.js";
import { firstDisagreeingName, ucpathPendingSweepVerdict } from "../termination-verdict.js";


export const deletePendingTerminationsTask = defineTask(
  ucpathDriver,
  UcpathDeletePendingTerminations,
  {
    sessions: [{ system: "ucpath", access: "transaction", session: "reuse-worker" }],
    async run({ input, ctx }) {
      // A refused delete throws; performed is literal true, so a false proof cannot represent refusal.
      const action = await ctx.driver
        .commit(UCPATH_SMART_HR_DELETE_SELECTED_BUTTON, ctx.mutation)
        .catch((error: unknown) => {
          if (!(error instanceof UcpathCommitRefusedError)) throw error;
          return ctx.fail(
            "delete-refused",
            `UCPath refused Delete Selected Transactions for EID ${directIdentifierDisplay(input.emplId)} and rendered `
            + `${JSON.stringify(error.refusal)}. The click happened, so this is post-fence and parks.`,
            { subject: input.emplId, cause: error },
          );
        });
      if (action.effect !== "external-commit") {
        return ctx.fail(
          "delete-refused",
          `UCPath Delete Selected Transactions for EID ${directIdentifierDisplay(input.emplId)} reported effect `
          + `${action.effect}, not an external commit`,
          { subject: input.emplId },
        );
      }
      const scan = await ctx.driver.scanTerminationTransactions({ emplId: input.emplId });
      const disagreeing = firstDisagreeingName(scan, input.expectedName);
      if (disagreeing !== undefined) {
        throw new Error(
          `UCPath post-delete read-back returned a transaction for ${directIdentifierDisplay(disagreeing)} `
          + `while the run named ${directIdentifierDisplay(input.expectedName)}. The delete has already `
          + "happened, so this is post-fence uncertainty and parks.",
        );
      }
      const verdict = ucpathPendingSweepVerdict(input, scan);
      if (verdict.state !== "present") {
        throw new Error(
          `UCPath Delete Selected Transactions was clicked for EID ${directIdentifierDisplay(input.emplId)} and the post-delete `
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
