import { validateOnbaseImportVerdict } from "../../../../models/systems/onbase/import-document.js";
import { OnbaseCommitImport } from "../../../../models/systems/onbase/upload-import.js";
import { defineTask } from "../../../../workflow-kit/task.js";
import { onbaseDriver } from "../driver-declaration.js";

export const commitImportTask = defineTask(onbaseDriver, OnbaseCommitImport, {
  sessions: [{ system: "onbase", access: "transaction", session: "reuse-worker", exclusive: true }],
  async run({ input, ctx }) {
    const action = await ctx.driver.commitImport(input, ctx.mutation);
    if (action.effect !== "external-commit") return ctx.fail("ONBASE_IMPORT_UNPROVED", "OnBase did not record the fenced Import action.");
    const verdict = validateOnbaseImportVerdict(input, await ctx.driver.readSavedImport(input));
    if (verdict.state !== "present") return ctx.fail("ONBASE_IMPORT_UNPROVED", "The imported PDF is unproved; preserve this write for reconciliation.");
    ctx.recordData([{ direction: "write", field: "savedDocument", value: verdict.proof }]);
    return { savedDocument: verdict.proof };
  },
});
