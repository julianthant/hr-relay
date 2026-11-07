import { OnbasePrepareImport } from "../../../../models/systems/onbase/import-document.js";
import { defineTask } from "../../../../workflow-kit/task.js";
import { onbaseDriver } from "../driver-declaration.js";

export const prepareImportTask = defineTask(onbaseDriver, OnbasePrepareImport, {
  sessions: [{ system: "onbase", access: "transaction", session: "reuse-worker", exclusive: true }],
  async run({ input, ctx }) {
    const staged = await ctx.driver.prepareImport(input);
    if (staged.observedEid !== input.ucpathId || staged.pageSha256 !== input.pageSha256) return ctx.fail("ONBASE_IMPORT_UNPROVED", "The prepared import belongs to another subject or PDF page.");
    ctx.recordData(Object.entries(staged).map(([field, value]) => ({ direction: "read" as const, field, value })));
    return staged;
  },
});
