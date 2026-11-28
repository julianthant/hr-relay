import { defineTask } from "../../../workflow-kit/task.js";
import { ERROR_CATALOG } from "../../../models/failures/error-catalog.js";
import { ReadI9CheckReferenceConflicts, ReadI9CheckRequests } from "../../../models/workflows/i9-check-start/read-requests.js";
import { i9CheckPersonRequests, resolveI9WorksheetRows } from "../../../rules/i9-check/batch.js";

export const readI9CheckReferenceConflictsTask = defineTask(ReadI9CheckReferenceConflicts, {
  sessions: [], async run({ input, ctx }) {
    let needsChoice;
    try { needsChoice = resolveI9WorksheetRows(input).some(({ resolution }) => resolution.state === "ambiguous"); }
    catch (cause) { return ctx.fail("I9_CHECK_DATA_INVALID", ERROR_CATALOG.I9_CHECK_DATA_INVALID.text, { cause }); }
    ctx.recordData([{ direction: "read", field: "needsChoice", value: needsChoice }]);
    return { needsChoice };
  },
});

export const readI9CheckRequestsTask = defineTask(ReadI9CheckRequests, {
  sessions: [], async run({ input, ctx }) {
    let output;
    try { output = i9CheckPersonRequests(input); }
    catch (cause) { return ctx.fail("I9_CHECK_DATA_INVALID", ERROR_CATALOG.I9_CHECK_DATA_INVALID.text, { cause }); }
    ctx.recordData(Object.entries(output).map(([field, value]) => ({ direction: "read" as const, field, value })));
    return output;
  },
});
