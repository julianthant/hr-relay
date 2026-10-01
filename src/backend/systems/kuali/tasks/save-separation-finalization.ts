import { defineTask } from "../../../../base/task.js";
import { KualiSaveSeparationFinalization } from "../../../../domain/contracts/kuali/save-separation-finalization.js";
import { KUALI_RRSS_SAVE_BUTTON } from "../../../../domain/ui/kuali-rrss-document.js";
import {
  KualiSaveRefusedError,
  kualiFinalizationFields,
} from "../../../../domain/ui/kuali-separation-finalization.js";
import { kualiDriver } from "../driver-declaration.js";

/**
 * Beat ⑤ — the ONE `Save` click that commits the finalization.
 *
 * `ctx.mutation` exists on a commit context and nowhere else, and the driver
 * refuses a capability the fenced write sequencer did not mint, so this task
 * cannot click outside an open fence even if it were mis-authored.
 *
 * It reports what it clicked, NOT that the save landed — **S59** is exactly the
 * mistake of doing otherwise, and D128 is this repository's own proof that a
 * Kuali save answers `200` and renders `Form saved` for a mutation that
 * persisted nothing. The reload read-back at beat ⑥ is the only thing that may
 * say `done`.
 *
 * The refusal arrives as a typed THROW rather than a `performed: false` proof,
 * because `UiActionProofSchema.performed` is `z.literal(true)`: a `!performed`
 * branch is a union member with no producer, which is the dead arm chunk 4's
 * audit caught.
 */
export const saveSeparationFinalizationTask = defineTask(
  kualiDriver,
  KualiSaveSeparationFinalization,
  {
    sessions: [{ system: "kuali", access: "transaction", session: "reuse-worker" }],
    async run({ input, ctx }) {
      const action = await ctx.driver
        .commit(KUALI_RRSS_SAVE_BUTTON, ctx.mutation)
        .catch((error: unknown) => {
          if (!(error instanceof KualiSaveRefusedError)) throw error;
          return ctx.fail(
            "save-refused",
            `Kuali refused the finalization save on document ${input.documentNumber}: ${error.refusal}. `
            + "The click happened, so this is post-fence and parks.",
            { subject: input.emplId, cause: error },
          );
        });
      if (action.effect !== "external-commit") {
        return ctx.fail(
          "save-refused",
          `Kuali Save on document ${input.documentNumber} reported effect ${action.effect}, not an `
          + "external commit",
          { subject: input.emplId },
        );
      }
      const fields = kualiFinalizationFields(input.variables);
      ctx.recordData([
        { direction: "write", field: "savedState.documentNumber", value: input.documentNumber },
        { direction: "write", field: "savedState.fields", value: fields },
      ]);
      return {
        savedState: {
          kind: "kuali-saved-finalization" as const,
          actionId: input.actionId,
          documentNumber: input.documentNumber,
          observedEid: input.emplId,
          fields,
          source: "reload-read-back" as const,
        },
      };
    },
  },
);
