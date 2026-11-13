import { validateOnbaseImportVerdict } from "../../../../models/systems/onbase/import-document.js";
import { OnbaseMatchImport } from "../../../../models/systems/onbase/match-import.js";
import { defineTask } from "../../../../workflow-kit/task.js";
import { JsonValueSchema } from "../../../../rules/validation/canonical-json.js";
import { onbaseDriver } from "../driver-declaration.js";

export const matchImportTask = defineTask(onbaseDriver, OnbaseMatchImport, {
  sessions: [{ system: "onbase", access: "read", session: "reuse-worker", exclusive: true }],
  async run({ input, ctx }) {
    const verdict = validateOnbaseImportVerdict(input, await ctx.driver.readSavedImport(input));
    ctx.recordData(Object.entries(verdict).map(([field, value]) => ({ direction: "read" as const, field, value: JsonValueSchema.parse(value) })));
    return verdict;
  },
});
