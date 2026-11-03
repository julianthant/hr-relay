import { defineTask } from "../../../workflow-kit/task.js";
import { ERROR_CATALOG } from "../../../models/failures/error-catalog.js";
import { ReadI9CheckRows } from "../../../models/workflows/i9-check/batch.js";
import { i9CheckBatchRows } from "../../../rules/i9-check/batch.js";

export const readI9CheckRowsTask = defineTask(ReadI9CheckRows, {
  sessions: [], async run({ input, ctx }) {
    let output;
    try { output = i9CheckBatchRows(input); }
    catch (cause) { return ctx.fail("I9_CHECK_DATA_INVALID", ERROR_CATALOG.I9_CHECK_DATA_INVALID.text, { cause }); }
    ctx.recordData(Object.entries(output).map(([field, value]) => ({ direction: "read" as const, field, value })));
    return output;
  },
});
