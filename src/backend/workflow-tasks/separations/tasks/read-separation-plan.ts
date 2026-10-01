import { defineTask } from "../../../../base/task.js";
import {
  ReadSeparationPlanOutputSchema,
  SeparationsReadSeparationPlan,
} from "../../../../domain/contracts/separations/read-separation-plan.js";
import { planSeparation } from "../../../../domain/separations/separation-dates.js";

/**
 * The document's own facts, validated, executed. Nothing here decides anything
 * — the fold does — and every refusal reaches its own durable code, which is
 * what an operator queries on months later.
 */
export const readSeparationPlanTask = defineTask(SeparationsReadSeparationPlan, {
  sessions: [],
  async run({ input, ctx }) {
    const resolution = planSeparation({
      documentNumber: input.documentNumber,
      employeeName: input.employeeName,
      lastDayWorked: input.lastDayWorked,
      separationDate: input.separationDate,
      observedAt: input.observedAt,
    });
    if (resolution.state === "refused") {
      return ctx.fail(resolution.code, resolution.reason);
    }
    const output = ReadSeparationPlanOutputSchema.parse(resolution.plan);
    ctx.recordData([
      { direction: "read", field: "documentNumber", value: output.documentNumber },
      { direction: "read", field: "employeeName", value: output.employeeName },
      { direction: "read", field: "kualiLastDayWorked", value: output.kualiLastDayWorked },
      { direction: "read", field: "kualiSeparationDate", value: output.kualiSeparationDate },
      { direction: "read", field: "asOfDate", value: output.asOfDate },
      { direction: "read", field: "timecardWindow", value: output.timecardWindow },
    ]);
    return output;
  },
});
