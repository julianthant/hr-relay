import { defineTask } from "../../../workflow-kit/task.js";
import {
  MatchSeparationSubjectOutputSchema,
  SeparationsMatchSeparationSubject,
} from "../../../models/workflows/separations/match-separation-subject.js";
import { resolveSeparationSubject } from "../../../rules/separations/separation-subject.js";

export const matchSeparationSubjectTask = defineTask(SeparationsMatchSeparationSubject, {
  sessions: [],
  async run({ input, ctx }) {
    if (input.documentEid.state === "present" && input.searchSelection !== undefined) {
      ctx.recordData([{ direction: "read", field: "searchedEmployeeId", value: input.documentEid.value }]);
    }
    const resolution = resolveSeparationSubject(input);
    if (resolution.state === "refused") {
      return ctx.fail(resolution.code, resolution.reason);
    }
    const output = MatchSeparationSubjectOutputSchema.parse(resolution.subject);
    ctx.recordData([
      { direction: "read", field: "emplId", value: output.emplId },
      { direction: "read", field: "emplIdSource", value: output.emplIdSource },
      { direction: "read", field: "candidateCount", value: output.candidateCount },
    ]);
    return output;
  },
});
