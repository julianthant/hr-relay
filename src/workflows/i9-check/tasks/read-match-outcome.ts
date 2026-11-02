import { defineTask } from "../../../workflow-kit/task.js";
import { ReadMatchOutcome } from "../../../models/workflows/i9-check/check.js";
import { i9MatchOutcome } from "../../../rules/i9-check/retention.js";

export const readMatchOutcomeTask = defineTask(ReadMatchOutcome, {
  sessions: [], async run({ input, ctx }) {
    const identity = i9MatchOutcome(input.match), shouldLookup = identity.status !== "found";
    ctx.recordData([{ direction: "read", field: "identity", value: identity }, { direction: "read", field: "shouldLookup", value: shouldLookup }]);
    return { identity, shouldLookup };
  },
});
