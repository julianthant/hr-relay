import { defineTask } from "../../../../base/task.js";
import {
  MatchDepartmentOptionOutputSchema,
  SeparationsMatchDepartmentOption,
} from "../../../../domain/contracts/separations/match-department-option.js";
import { resolveKualiDepartmentOption } from "../../../../domain/separations/department-option.js";

/**
 * S55's upstream refusal, executed. Nothing here decides anything — the fold
 * does — and that is deliberate: this file's whole job is to turn the pure
 * resolution into a run outcome carrying the right durable code.
 */
export const matchDepartmentOptionTask = defineTask(SeparationsMatchDepartmentOption, {
  sessions: [],
  async run({ input, ctx }) {
    const resolution = resolveKualiDepartmentOption({
      deptId: input.deptId,
      department: input.department,
      observedOptions: input.observedOptions,
    });
    if (resolution.state === "refused") {
      return ctx.fail(
        resolution.code,
        `Kuali document ${input.documentNumber}: ${resolution.reason} Legacy would fall through to a `
        + "bidirectional substring match and then leave the required field BLANK for manual entry; "
        + "neither ports, and a Kuali separation cannot be saved with no department.",
      );
    }

    const output = MatchDepartmentOptionOutputSchema.parse({
      option: resolution.option,
      departmentCode: resolution.departmentCode,
      optionDescription: resolution.optionDescription,
      ucpathDepartment: resolution.ucpathDepartment,
      observedOptionCount: resolution.observedOptionCount,
    });
    ctx.recordData([
      { direction: "read", field: "option", value: output.option },
      { direction: "read", field: "departmentCode", value: output.departmentCode },
      { direction: "read", field: "optionDescription", value: output.optionDescription },
      { direction: "read", field: "ucpathDepartment", value: output.ucpathDepartment },
      { direction: "read", field: "observedOptionCount", value: output.observedOptionCount },
    ]);
    return output;
  },
});
