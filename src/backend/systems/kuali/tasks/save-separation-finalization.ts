import { defineTask } from "../../../../workflow-kit/task.js";
import { KualiSaveSeparationFinalization } from "../../../../models/systems/kuali/save-separation-finalization.js";
import { KUALI_RRSS_SAVE_BUTTON } from "../../../../models/ui/kuali-rrss-document.js";
import {
  KualiSaveRefusedError,
  kualiFinalizationFields,
} from "../../../../models/ui/kuali-separation-finalization.js";
import { kualiDriver } from "../driver-declaration.js";


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
