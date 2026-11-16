import { defineTask } from "../../../workflow-kit/task.js";
import {
  MatchSeparationSubjectOutputSchema,
  SeparationsMatchSeparationSubject,
} from "../../../models/workflows/separations/match-separation-subject.js";
import { resolveSeparationSubject } from "../../../rules/separations/separation-subject.js";

// Without a document EID, refuse zero or multiple name-search matches.
export const matchSeparationSubjectTask = defineTask(SeparationsMatchSeparationSubject, {
  sessions: [],
  async run({ input, ctx }) {
    const resolution = resolveSeparationSubject({
      ...(input.operatorEmployeeId === undefined ? {} : { operatorEmployeeId: input.operatorEmployeeId }),
      documentNumber: input.documentNumber,
      employeeName: input.employeeName,
      documentEid: input.documentEid,
      nameSelection: input.nameSelection,
    });
    if (resolution.state === "refused") {
      return ctx.fail(resolution.code, resolution.reason);
    }
    const output = MatchSeparationSubjectOutputSchema.parse(resolution.subject);
    ctx.recordData([
      { direction: "read", field: "emplId", value: output.emplId },
      { direction: "read", field: "emplIdSource", value: output.emplIdSource },
      { direction: "read", field: "searchedName", value: output.searchedName },
      { direction: "read", field: "candidateCount", value: output.candidateCount },
    ]);
    return output;
  },
});
