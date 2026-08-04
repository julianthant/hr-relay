import { defineTask } from "../../../base/task.js";
import { KualiSaveTimekeeperAnnotation } from "../../../domain/contracts/kuali/save-timekeeper-annotation.js";
import { KUALI_RRSS_SAVE_BUTTON } from "../../../domain/ui/kuali-rrss-document.js";
import { kualiDriver } from "../declaration.js";

/**
 * Beat ⑤ — the only external write in this tree.
 *
 * `ctx.mutation` exists on a commit context and nowhere else, and the driver
 * refuses a capability the fenced write sequencer did not mint, so this task
 * cannot click outside an open fence even if it were mis-authored.
 *
 * It reports what it clicked, NOT that the save landed. Kuali is UI-silent, so
 * there is nothing on this page for it to observe; the reload read-back at
 * beat ⑥ is the only thing that may say `done`.
 */
export const saveTimekeeperAnnotationTask = defineTask(kualiDriver, KualiSaveTimekeeperAnnotation, {
  sessions: [{ system: "kuali", access: "transaction", session: "reuse-worker" }],
  async run({ input, ctx }) {
    const action = await ctx.driver.commit(KUALI_RRSS_SAVE_BUTTON, ctx.mutation);
    if (action.effect !== "external-commit" || !action.performed) {
      return ctx.fail(
        "save-refused",
        `Kuali Save on document ${input.documentNumber} did not report a performed external commit`,
        { subject: input.emplId },
      );
    }
    ctx.recordData([
      { direction: "write", field: "savedState.timekeeperName", value: input.timekeeperName },
      { direction: "write", field: "savedState.documentNumber", value: input.documentNumber },
    ]);
    return {
      savedState: {
        kind: "kuali-saved-timekeeper" as const,
        actionId: input.actionId,
        documentNumber: input.documentNumber,
        timekeeperName: input.timekeeperName,
        observedEid: input.emplId,
        source: "reload-read-back" as const,
      },
    };
  },
});
