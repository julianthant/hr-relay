import { defineTask } from "../../../workflow-kit/task.js";
import { ReadEmploymentCandidates } from "../../../models/workflows/i9-check/read-employment-candidates.js";
import { i9EmploymentCandidates } from "../../../rules/i9-check/retention.js";

export const readEmploymentCandidatesTask = defineTask(ReadEmploymentCandidates, {
  sessions: [], async run({ input, ctx }) {
    const output = i9EmploymentCandidates(input.search);
    ctx.recordData([{ direction: "read", field: "candidates", value: output.candidates }]);
    return output;
  },
});
