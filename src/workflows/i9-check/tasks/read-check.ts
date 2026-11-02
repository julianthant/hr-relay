import { defineTask } from "../../../workflow-kit/task.js";
import { ReadSearchPlan, ReadMatchOutcome, ReadRetentionRow } from "../../../models/workflows/i9-check/check.js";
import { i9MatchOutcome, i9RetentionRow } from "../../../rules/i9-check/retention.js";
import { ERROR_CATALOG } from "../../../models/failures/error-catalog.js";

export const readSearchPlanTask = defineTask(ReadSearchPlan, {
  sessions: [], async run({ input, ctx }) {
    const useMatch = input.person.firstName !== undefined && input.person.lastName !== undefined
      && (input.person.dob !== undefined || input.person.ssn !== undefined);
    ctx.recordData({ direction: "read", field: "useMatch", value: useMatch });
    return { useMatch };
  },
});
export const readMatchOutcomeTask = defineTask(ReadMatchOutcome, {
  sessions: [], async run({ input, ctx }) {
    const identity = i9MatchOutcome(input.match), shouldLookup = identity.status !== "found";
    ctx.recordData([{ direction: "read", field: "identity", value: identity }, { direction: "read", field: "shouldLookup", value: shouldLookup }]);
    return { identity, shouldLookup };
  },
});
export const readRetentionRowTask = defineTask(ReadRetentionRow, {
  sessions: [], async run({ input, ctx }) {
    let output;
    try { output = i9RetentionRow(input); }
    catch (cause) { return ctx.fail("I9_CHECK_DATA_INVALID", ERROR_CATALOG.I9_CHECK_DATA_INVALID.text, { cause }); }
    ctx.recordData([{ direction: "read", field: "identity", value: output.identity }, { direction: "read", field: "row", value: output.row }]);
    return output;
  },
});
