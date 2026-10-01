import { defineTask } from "../../../../base/task.js";
import {
  MatchActiveEmploymentOutputSchema,
  SeparationsMatchActiveEmployment,
} from "../../../../domain/contracts/separations/match-active-employment.js";
import { selectSeparationEmployment } from "../../../../domain/separations/employment-selection.js";

/**
 * S23/S24's refusal, executed. The gate still shows the operator every row —
 * `match-identity` carries the whole classification — so what this node decides
 * is only whether there is a single employment to file against.
 */
export const matchActiveEmploymentTask = defineTask(SeparationsMatchActiveEmployment, {
  sessions: [],
  async run({ input, ctx }) {
    const selection = selectSeparationEmployment(input.jobSummary.jobRows);
    if (selection.state === "refused") {
      return ctx.fail(
        selection.code,
        `Kuali document ${input.documentNumber}: ${selection.reason}`,
      );
    }
    const output = MatchActiveEmploymentOutputSchema.parse(selection.employment);
    ctx.recordData([
      { direction: "read", field: "rowIndex", value: output.rowIndex },
      { direction: "read", field: "emplRecord", value: output.emplRecord },
      { direction: "read", field: "hrStatus", value: output.hrStatus },
      { direction: "read", field: "businessUnit", value: output.businessUnit },
      { direction: "read", field: "deptId", value: output.deptId },
      { direction: "read", field: "department", value: output.department },
      { direction: "read", field: "payrollTitleCode", value: output.payrollTitleCode },
      { direction: "read", field: "payrollTitle", value: output.payrollTitle },
      { direction: "read", field: "effectiveDate", value: output.effectiveDate },
      { direction: "read", field: "rowCount", value: output.rowCount },
    ]);
    return output;
  },
});
