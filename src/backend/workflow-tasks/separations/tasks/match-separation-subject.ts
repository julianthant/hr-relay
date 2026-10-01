import { defineTask } from "../../../../base/task.js";
import {
  MatchSeparationSubjectOutputSchema,
  SeparationsMatchSeparationSubject,
} from "../../../../domain/contracts/separations/match-separation-subject.js";
import { resolveSeparationSubject } from "../../../../domain/separations/separation-subject.js";

/**
 * S18/S19's fork, executed. The refusals are the two states legacy resolves by
 * delegating to person-lookup and then proceeding on whatever comes back.
 */
export const matchSeparationSubjectTask = defineTask(SeparationsMatchSeparationSubject, {
  sessions: [],
  async run({ input, ctx }) {
    const resolution = resolveSeparationSubject({
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
