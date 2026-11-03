import { defineTask } from "../../../workflow-kit/task.js";
import { ERROR_CATALOG } from "../../../models/failures/error-catalog.js";
import { ReadI9CheckPeople } from "../../../models/workflows/i9-check-start/read-people.js";
import { i9CheckApprovedPeople } from "../../../rules/i9-check/batch.js";

export const readI9CheckPeopleTask = defineTask(ReadI9CheckPeople, {
  sessions: [], async run({ input, ctx }) {
    let output;
    try { output = i9CheckApprovedPeople(input); }
    catch (cause) { return ctx.fail("I9_CHECK_DATA_INVALID", ERROR_CATALOG.I9_CHECK_DATA_INVALID.text, { cause }); }
    ctx.recordData(Object.entries(output).map(([field, value]) => ({ direction: "read" as const, field, value })));
    return output;
  },
});
