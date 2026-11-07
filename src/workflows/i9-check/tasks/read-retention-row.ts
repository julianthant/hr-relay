import { defineTask } from "../../../workflow-kit/task.js";
import { ReadRetentionRow } from "../../../models/workflows/i9-check/check.js";
import { i9RetentionRow } from "../../../rules/i9-check/retention.js";
import { ERROR_CATALOG } from "../../../models/failures/error-catalog.js";

export const readRetentionRowTask = defineTask(ReadRetentionRow, {
  sessions: [], async run({ input, ctx }) {
    let output;
    try { output = i9RetentionRow(input); }
    catch (cause) { return ctx.fail("I9_CHECK_DATA_INVALID", ERROR_CATALOG.I9_CHECK_DATA_INVALID.text, { cause }); }
    ctx.recordData([{ direction: "read", field: "identity", value: output.identity }, { direction: "read", field: "row", value: output.row }]);
    return output;
  },
});
